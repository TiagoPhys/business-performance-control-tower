"""Tests for loading, typing, data quality checks and the relational split."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from analytics import prepare_data as pdx
from analytics.config import ensure_not_raw_dir
from tests.python.conftest import write_raw


def check(prepared: pdx.PreparedData, check_id: str) -> pd.Series:
    """Return one data quality check row by id."""
    checks = prepared.quality_checks.set_index("check_id")
    return checks.loc[check_id]


# --------------------------------------------------------------------------- loading


def test_missing_file_gives_clear_error(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="data/raw/superstore.csv"):
        pdx.prepare(tmp_path / "nope.csv")


def test_missing_columns_are_listed(tmp_path: Path, raw_rows: list[dict[str, str]]) -> None:
    for row in raw_rows:
        del row["Profit"]
        del row["Ship Date"]
    path = write_raw(tmp_path / "raw.csv", raw_rows, csvbase_style=False)
    with pytest.raises(pdx.MissingColumnsError, match=r"\['Ship Date', 'Profit'\]"):
        pdx.prepare(path)


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("﻿Row ID", "row_id"),
        ("Sub-Category", "sub_category"),
        ("  Product Name ", "product_name"),
        ("csvbase_row_id", "csvbase_row_id"),
    ],
)
def test_normalize_column_name(header: str, expected: str) -> None:
    assert pdx.normalize_column_name(header) == expected


def test_plain_and_csvbase_exports_give_same_result(
    tmp_path: Path, raw_rows: list[dict[str, str]]
) -> None:
    plain = pdx.prepare(write_raw(tmp_path / "a.csv", raw_rows, csvbase_style=False))
    csvbase = pdx.prepare(write_raw(tmp_path / "b.csv", raw_rows, csvbase_style=True))
    pd.testing.assert_frame_equal(plain.order_lines, csvbase.order_lines)
    pd.testing.assert_frame_equal(plain.orders, csvbase.orders)


# --------------------------------------------------------------------------- parsing


def test_parse_dates_accepts_us_and_iso_strictly() -> None:
    raw = pd.Series(
        [
            "11/8/2016",
            "02/03/2016",
            "2016-11-08",
            "2016-02-30",
            "13/45/2016",
            "08-11-2016",
            "",
            "1899-01-01",
        ],
        dtype="str",
    )
    parsed, fmt = pdx.parse_dates(raw)
    assert parsed[0] == pd.Timestamp("2016-11-08")
    assert parsed[1] == pd.Timestamp("2016-02-03")  # US: month first, never day first
    assert parsed[2] == pd.Timestamp("2016-11-08")
    assert parsed[3:].isna().all()  # impossible, wrong order, other format, blank, implausible
    assert list(fmt[:3]) == ["us", "us", "iso"]


def test_us_format_file_is_parsed(tmp_path: Path, raw_rows: list[dict[str, str]]) -> None:
    for row in raw_rows:
        for col in ("Order Date", "Ship Date"):
            y, m, d = row[col].split("-")
            row[col] = f"{int(m)}/{int(d)}/{y}"
    prepared = pdx.prepare(write_raw(tmp_path / "us.csv", raw_rows))
    assert prepared.orders.set_index("order_id").loc["O-2", "order_date"] == pd.Timestamp(
        "2016-02-05"
    )
    assert "us=5" in check(prepared, "invalid_order_date")["details"]


def test_invalid_date_is_reported_not_converted(
    tmp_path: Path, raw_rows: list[dict[str, str]]
) -> None:
    raw_rows[2]["Order Date"] = "2016-02-31"
    prepared = pdx.prepare(write_raw(tmp_path / "bad.csv", raw_rows))
    result = check(prepared, "invalid_order_date")
    assert (result["status"], result["affected_rows"]) == ("fail", 1)
    issue = prepared.quality_issues.iloc[0]
    assert (issue["row_id"], issue["column_name"], issue["raw_value"]) == (
        "3",
        "order_date",
        "2016-02-31",
    )
    assert 3 not in prepared.order_lines["row_id"].tolist()
    assert "O-2" not in prepared.orders["order_id"].tolist()


def test_numeric_columns_are_converted(tmp_path: Path, raw_file: Path) -> None:
    lines = pdx.prepare(raw_file).order_lines
    assert lines["sales"].dtype == "float64"
    assert lines["profit"].dtype == "float64"
    assert lines["discount"].dtype == "float64"
    assert str(lines["quantity"].dtype) == "Int64"
    assert lines["sales"].sum() == pytest.approx(800)


@pytest.mark.parametrize(("column", "value"), [("Sales", "abc"), ("Quantity", "2.5")])
def test_invalid_numbers_are_excluded(
    tmp_path: Path, raw_rows: list[dict[str, str]], column: str, value: str
) -> None:
    raw_rows[0][column] = value
    prepared = pdx.prepare(write_raw(tmp_path / "bad.csv", raw_rows))
    assert check(prepared, f"invalid_numeric_{column.lower()}")["status"] == "fail"
    assert prepared.order_lines["row_id"].tolist() == [2, 3, 4, 5]


def test_postal_code_zero_restored_and_original_kept(raw_file: Path) -> None:
    prepared = pdx.prepare(raw_file)
    order = prepared.orders.set_index("order_id").loc["O-3"]
    assert (order["postal_code"], order["postal_code_raw"]) == ("05401", "5401")
    # Counted per line: order O-3 has two lines.
    assert check(prepared, "postal_code_leading_zero_restored")["affected_rows"] == 2


# --------------------------------------------------------------------------- split


def test_orders_and_lines_have_unique_keys(raw_file: Path) -> None:
    prepared = pdx.prepare(raw_file)
    assert prepared.orders["order_id"].tolist() == ["O-1", "O-2", "O-3"]
    assert prepared.order_lines["row_id"].is_unique
    assert len(prepared.order_lines) == 5


def test_shipping_days_is_ship_minus_order_date(raw_file: Path) -> None:
    orders = pdx.prepare(raw_file).orders.set_index("order_id")
    assert orders["shipping_days"].to_dict() == {"O-1": 3, "O-2": 5, "O-3": 0}
    assert "promised" not in " ".join(orders.columns)


def test_customer_names_are_not_kept(tmp_path: Path, raw_file: Path) -> None:
    out = tmp_path / "out"
    pdx.write_outputs(pdx.prepare(raw_file), out)
    for path in out.iterdir():
        assert "Alice" not in path.read_text(encoding="utf-8"), path.name


def test_product_id_reused_for_other_name_gets_own_key(
    tmp_path: Path, raw_rows: list[dict[str, str]]
) -> None:
    raw_rows[4]["Product Name"] = "Chair A (2nd edition)"
    prepared = pdx.prepare(write_raw(tmp_path / "p.csv", raw_rows))
    assert len(prepared.products) == 4
    assert check(prepared, "product_id_multiple_names")["affected_rows"] == 1
    keys = prepared.order_lines.set_index("row_id")["product_key"]
    assert keys[1] != keys[5]


# --------------------------------------------------------------------------- quality checks


def test_clean_fixture_passes_all_blocking_checks(raw_file: Path) -> None:
    checks = pdx.prepare(raw_file).quality_checks
    assert set(checks["status"]) <= {"pass", "warn"}
    expected = {
        "duplicate_row_id",
        "duplicate_line_content",
        "missing_critical_values",
        "missing_descriptive_values",
        "orphan_line_order",
        "orphan_line_product",
        "orphan_order_customer",
        "invalid_order_date",
        "invalid_ship_date",
        "discount_out_of_range",
        "order_attribute_inconsistency",
    }
    assert expected <= set(checks["check_id"])


def test_duplicate_row_id_keeps_first(tmp_path: Path, raw_rows: list[dict[str, str]]) -> None:
    raw_rows.append(dict(raw_rows[0], Sales="999"))
    prepared = pdx.prepare(write_raw(tmp_path / "d.csv", raw_rows))
    assert check(prepared, "duplicate_row_id")["affected_rows"] == 1
    assert prepared.order_lines.set_index("row_id").loc[1, "sales"] == 100


def test_duplicate_content_is_flagged_but_kept(
    tmp_path: Path, raw_rows: list[dict[str, str]]
) -> None:
    raw_rows.append(dict(raw_rows[0], **{"Row ID": "6"}))
    prepared = pdx.prepare(write_raw(tmp_path / "d.csv", raw_rows))
    result = check(prepared, "duplicate_line_content")
    assert (result["status"], result["affected_rows"]) == ("warn", 1)
    assert len(prepared.order_lines) == 6


def test_missing_values(tmp_path: Path, raw_rows: list[dict[str, str]]) -> None:
    raw_rows[0]["City"] = ""
    raw_rows[1]["Customer ID"] = " "
    prepared = pdx.prepare(write_raw(tmp_path / "m.csv", raw_rows))
    assert check(prepared, "missing_descriptive_values")["affected_rows"] == 1
    assert check(prepared, "missing_critical_values")["affected_rows"] == 1
    assert 2 not in prepared.order_lines["row_id"].tolist()
    assert 1 in prepared.order_lines["row_id"].tolist()


@pytest.mark.parametrize("discount", ["1.5", "-0.1"])
def test_discount_out_of_range(
    tmp_path: Path, raw_rows: list[dict[str, str]], discount: str
) -> None:
    raw_rows[0]["Discount"] = discount
    prepared = pdx.prepare(write_raw(tmp_path / "x.csv", raw_rows))
    assert check(prepared, "discount_out_of_range")["status"] == "fail"
    assert 1 not in prepared.order_lines["row_id"].tolist()


def test_ship_before_order_is_excluded(tmp_path: Path, raw_rows: list[dict[str, str]]) -> None:
    raw_rows[2]["Ship Date"] = "2016-02-01"
    prepared = pdx.prepare(write_raw(tmp_path / "s.csv", raw_rows))
    assert check(prepared, "ship_before_order")["affected_rows"] == 1
    assert (prepared.orders["shipping_days"] >= 0).all()


def test_order_attribute_inconsistency_uses_lowest_row_id(
    tmp_path: Path, raw_rows: list[dict[str, str]]
) -> None:
    raw_rows[1]["Ship Mode"] = "First Class"  # row 2 disagrees with row 1 on order O-1
    prepared = pdx.prepare(write_raw(tmp_path / "i.csv", raw_rows))
    result = check(prepared, "order_attribute_inconsistency")
    assert (result["status"], result["affected_rows"]) == ("warn", 1)
    assert "ship_mode=1" in result["details"]
    assert prepared.orders.set_index("order_id").loc["O-1", "ship_mode"] == "Second Class"


def test_orphaned_keys_raise(raw_file: Path) -> None:
    prepared = pdx.prepare(raw_file)
    prepared.order_lines.loc[0, "order_id"] = "O-404"
    with pytest.raises(pdx.DataIntegrityError, match="orphan_line_order"):
        pdx.check_integrity(prepared, pdx.QualityLog())


# --------------------------------------------------------------------------- raw file safety


def test_raw_file_is_not_modified(tmp_path: Path, raw_file: Path) -> None:
    before = pdx.file_sha256(raw_file)
    pdx.write_outputs(pdx.prepare(raw_file), tmp_path / "out")
    assert pdx.file_sha256(raw_file) == before


def test_writing_into_raw_dir_is_refused() -> None:
    from analytics.config import RAW_DIR

    with pytest.raises(PermissionError):
        ensure_not_raw_dir(RAW_DIR / "orders.csv")


def test_metadata_is_deterministic(raw_file: Path) -> None:
    first, second = pdx.prepare(raw_file).metadata, pdx.prepare(raw_file).metadata
    assert first == second
    assert first["source_rows"] == 5 and first["orders"] == 3
    assert not any("time" in key for key in first)
