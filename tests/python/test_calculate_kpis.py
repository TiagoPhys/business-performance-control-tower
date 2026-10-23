"""Tests for KPI definitions, grouping-set semantics and aggregation validation."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from analytics import calculate_kpis as kpi
from analytics.config import ALL


def load(processed_dir: Path, name: str) -> pd.DataFrame:
    """Read a KPI output with dimension columns as text."""
    return pd.read_csv(processed_dir / f"{name}.csv", dtype={"order_year": "str"})


def summary_row(df: pd.DataFrame, **dims: str) -> pd.Series:
    """Select one kpi_summary row; unspecified dimensions default to ``ALL``."""
    keys = {"order_year": ALL, "region": ALL, "segment": ALL, "category": ALL, **dims}
    mask = pd.Series(True, index=df.index)
    for column, value in keys.items():
        mask &= df[column] == value
    rows = df[mask]
    assert len(rows) == 1, keys
    return rows.iloc[0]


def test_grand_totals(processed_dir: Path) -> None:
    total = summary_row(load(processed_dir, "kpi_summary"))
    assert total["sales"] == pytest.approx(800)
    assert total["profit"] == pytest.approx(20)
    assert total["units"] == 12
    assert total["line_count"] == 5
    assert total["orders"] == 3
    assert total["customers"] == 2
    assert total["profit_margin"] == pytest.approx(20 / 800)
    assert total["average_order_value"] == pytest.approx(800 / 3)
    assert total["avg_discount"] == pytest.approx((0 + 0.2 + 0.5 + 0.3 + 0) / 5)
    assert total["loss_line_share"] == pytest.approx(3 / 5)


def test_shipping_days_averaged_per_order_not_per_line(processed_dir: Path) -> None:
    summary = load(processed_dir, "kpi_summary")
    # Orders ship in 3, 5 and 0 days; O-1 and O-3 have two lines each.
    assert summary_row(summary)["avg_shipping_days"] == pytest.approx(8 / 3)
    assert summary_row(summary, category="Office Supplies")["avg_shipping_days"] == pytest.approx(3)


def test_distinct_orders_are_not_additive_across_categories(processed_dir: Path) -> None:
    summary = load(processed_dir, "kpi_summary")
    furniture = summary_row(summary, category="Furniture")
    office = summary_row(summary, category="Office Supplies")
    assert (furniture["orders"], office["orders"]) == (3, 1)
    assert furniture["orders"] + office["orders"] > summary_row(summary)["orders"]


def test_filter_combinations(processed_dir: Path) -> None:
    summary = load(processed_dir, "kpi_summary")
    east_2017 = summary_row(summary, order_year="2017", region="East")
    assert east_2017["sales"] == pytest.approx(450)
    assert east_2017["profit"] == pytest.approx(45)
    assert len(summary) == len(
        summary.drop_duplicates(["order_year", "region", "segment", "category"])
    )


def test_year_over_year(processed_dir: Path) -> None:
    summary = load(processed_dir, "kpi_summary")
    y2017 = summary_row(summary, order_year="2017")
    assert y2017["prior_sales"] == pytest.approx(350)
    assert y2017["sales_yoy"] == pytest.approx(450 / 350 - 1, abs=1e-6)  # outputs are rounded
    # Profit went from -25 to 45: growth is measured against |prior|.
    assert y2017["profit_yoy"] == pytest.approx((45 - -25) / 25)
    assert pd.isna(summary_row(summary, order_year="2016")["sales_yoy"])
    assert pd.isna(summary_row(summary)["sales_yoy"])


def test_monthly_trend(processed_dir: Path) -> None:
    monthly = load(processed_dir, "kpi_monthly")
    overall = monthly[
        (monthly["region"] == ALL) & (monthly["segment"] == ALL) & (monthly["category"] == ALL)
    ]
    assert overall.set_index("order_month")["sales"].to_dict() == pytest.approx(
        {"2016-01": 150, "2016-02": 200, "2017-03": 450}
    )


def test_subcategory_and_product_tables(processed_dir: Path) -> None:
    subcats = load(processed_dir, "subcategory_performance")
    tables = subcats[(subcats["order_year"] == ALL) & (subcats["sub_category"] == "Tables")].iloc[0]
    assert tables["profit"] == pytest.approx(-30)
    assert tables["profit_margin"] == pytest.approx(-0.1)

    products = load(processed_dir, "product_performance")
    chair = products[(products["order_year"] == ALL) & (products["product_key"] == 1)].iloc[0]
    assert (chair["sales"], chair["profit"], chair["orders"]) == pytest.approx((450, 55, 3))


def test_discount_bands(processed_dir: Path) -> None:
    bands = load(processed_dir, "discount_band_performance")
    overall = bands[(bands["order_year"] == ALL) & (bands["category"] == ALL)].set_index(
        "discount_band"
    )
    assert list(overall.index) == ["No discount", "1-20%", "21-40%", "Over 40%"]
    assert overall.loc["No discount", "profit_margin"] == pytest.approx(95 / 250)
    assert overall.loc["1-20%", "line_count"] == 1  # 0.2 belongs to the 1-20% band
    assert overall.loc["Over 40%", "profit_margin"] == pytest.approx(-0.2)


def test_shipping_performance(processed_dir: Path) -> None:
    shipping = load(processed_dir, "shipping_performance")
    overall = shipping[(shipping["order_year"] == ALL) & (shipping["region"] == ALL)]
    assert overall.set_index("ship_mode")["avg_shipping_days"].to_dict() == {
        "Same Day": 0,
        "Second Class": 3,
        "Standard Class": 5,
    }
    assert overall["shipped_orders"].sum() == 3


def test_validation_catches_broken_aggregate(processed_dir: Path) -> None:
    frames = kpi.load_processed(processed_dir)
    tables = kpi.calculate(frames)
    summary = tables["kpi_summary"]
    summary.loc[summary["region"] == "East", "sales"] += 1
    with pytest.raises(kpi.AggregationError, match="region sum sales"):
        kpi.validate(tables, frames)


def test_calculation_is_deterministic(processed_dir: Path) -> None:
    frames = kpi.load_processed(processed_dir)
    first, second = kpi.calculate(frames), kpi.calculate(frames)
    for name in first.tables:
        pd.testing.assert_frame_equal(first[name], second[name])


def test_safe_divide_returns_nan_for_zero() -> None:
    result = kpi.safe_divide(pd.Series([1.0, 2.0]), pd.Series([0, 4]))
    assert pd.isna(result[0]) and result[1] == 0.5


def test_missing_processed_files_give_clear_error(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="prepare_data"):
        kpi.load_processed(tmp_path)
