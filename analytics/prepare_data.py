"""Load, validate and normalise the raw Superstore CSV into relational tables.

Outputs (in ``data/processed/``):

* ``orders.csv``              one row per Order ID
* ``order_lines.csv``         one row per Row ID
* ``products.csv``            one row per (Product ID, Product Name)
* ``customers.csv``           one row per Customer ID (no customer names)
* ``data_quality_checks.csv`` one row per check, with status pass / warn / fail
* ``data_quality_issues.csv`` row-level findings (row_id, column, raw value)
* ``dataset_metadata.json``   source hash, row counts and date range

Status semantics: ``pass`` = nothing found; ``warn`` = found and handled while
keeping the rows; ``fail`` = affected rows were excluded from the clean tables.

The raw file is opened read-only and never rewritten. Customer names are not
carried into any output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from analytics.config import (
    PIPELINE_VERSION,
    PROCESSED_DIR,
    RAW_FILE,
    ensure_not_raw_dir,
    setup_logging,
    write_csv,
)

logger = logging.getLogger(__name__)

# Normalised name -> original Superstore header.
EXPECTED_COLUMNS: dict[str, str] = {
    "row_id": "Row ID",
    "order_id": "Order ID",
    "order_date": "Order Date",
    "ship_date": "Ship Date",
    "ship_mode": "Ship Mode",
    "customer_id": "Customer ID",
    "customer_name": "Customer Name",
    "segment": "Segment",
    "country": "Country",
    "city": "City",
    "state": "State",
    "postal_code": "Postal Code",
    "region": "Region",
    "product_id": "Product ID",
    "category": "Category",
    "sub_category": "Sub-Category",
    "product_name": "Product Name",
    "sales": "Sales",
    "quantity": "Quantity",
    "discount": "Discount",
    "profit": "Profit",
}

# Export artefact added by csvbase.org; validated against Row ID, then dropped.
SOURCE_ROW_ID_COLUMN = "csvbase_row_id"

# Rows missing any of these cannot be placed in the relational model and are excluded.
CRITICAL_COLUMNS = (
    "row_id",
    "order_id",
    "order_date",
    "ship_date",
    "customer_id",
    "product_id",
    "sales",
    "quantity",
    "discount",
    "profit",
)

ORDER_ATTRIBUTES = (
    "order_date",
    "ship_date",
    "ship_mode",
    "customer_id",
    "segment",
    "country",
    "city",
    "state",
    "postal_code",
    "region",
)

# US Superstore exports use month/day/year; some re-exports (e.g. csvbase) use ISO.
# Each value must match one format exactly; anything else is reported as invalid.
DATE_FORMATS: tuple[tuple[str, str], ...] = (
    ("us", "%m/%d/%Y"),
    ("iso", "%Y-%m-%d"),
)
US_DATE_PATTERN = re.compile(r"^\d{1,2}/\d{1,2}/\d{4}$")
ISO_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MIN_PLAUSIBLE_DATE = pd.Timestamp("2000-01-01")
MAX_PLAUSIBLE_DATE = pd.Timestamp("2100-12-31")

POSTAL_CODE_LENGTH = 5
ISSUE_LOG_SAMPLE = 10


class MissingColumnsError(ValueError):
    """Raised when the raw file lacks one or more expected columns."""


class DataIntegrityError(RuntimeError):
    """Raised when a structural guarantee (unique keys, no orphans) is violated."""


@dataclass
class QualityLog:
    """Accumulates check results and row-level issues while the data is prepared."""

    checks: list[dict] = field(default_factory=list)
    issues: list[dict] = field(default_factory=list)

    def add_check(
        self,
        check_id: str,
        group: str,
        description: str,
        affected: int,
        status_if_found: str,
        details: str = "",
    ) -> None:
        """Record one check; status is ``pass`` when nothing was found."""
        status = "pass" if affected == 0 else status_if_found
        self.checks.append(
            {
                "check_id": check_id,
                "check_group": group,
                "description": description,
                "status": status,
                "affected_rows": int(affected),
                "details": details,
            }
        )
        log = logger.info if status == "pass" else logger.warning
        log("DQ %-38s %-4s affected=%d %s", check_id, status, affected, details)

    def add_issues(self, check_id: str, column: str, rows: pd.DataFrame, values: pd.Series) -> None:
        """Record row-level findings, identified by row_id only."""
        for row_id, value in zip(rows["row_id_raw"], values, strict=True):
            self.issues.append(
                {"check_id": check_id, "row_id": row_id, "column_name": column, "raw_value": value}
            )
        if len(rows):
            sample = ", ".join(rows["row_id_raw"].head(ISSUE_LOG_SAMPLE))
            logger.warning(
                "%s: %d rows in %s (row_id sample: %s)", check_id, len(rows), column, sample
            )


@dataclass
class PreparedData:
    """Clean relational tables plus data quality results."""

    orders: pd.DataFrame
    order_lines: pd.DataFrame
    products: pd.DataFrame
    customers: pd.DataFrame
    quality_checks: pd.DataFrame
    quality_issues: pd.DataFrame
    metadata: dict


# --------------------------------------------------------------------------- loading


def file_sha256(path: Path) -> str:
    """Return the SHA-256 hex digest of a file, streamed in chunks."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_raw(path: Path) -> pd.DataFrame:
    """Read the raw CSV with every value as text, so nothing is coerced implicitly."""
    if not path.exists():
        raise FileNotFoundError(
            f"Raw data file not found: {path}\n"
            "Download the Sample Superstore CSV and save it as data/raw/superstore.csv."
        )
    if not path.is_file():
        raise FileNotFoundError(f"Raw data path is not a file: {path}")
    df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    logger.info("Loaded %d rows x %d columns from %s", len(df), df.shape[1], path.name)
    return df


def normalize_column_name(name: str) -> str:
    """Convert a header such as ``'\\ufeffSub-Category '`` to ``'sub_category'``."""
    cleaned = name.replace("﻿", "").strip().lower()
    return re.sub(r"[^0-9a-z]+", "_", cleaned).strip("_")


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Rename headers to snake_case and verify all expected columns are present."""
    renamed = df.rename(columns={c: normalize_column_name(c) for c in df.columns})
    duplicated = sorted({c for c in renamed.columns if list(renamed.columns).count(c) > 1})
    if duplicated:
        raise MissingColumnsError(f"Columns collide after normalisation: {duplicated}")
    missing = [EXPECTED_COLUMNS[c] for c in EXPECTED_COLUMNS if c not in renamed.columns]
    if missing:
        raise MissingColumnsError(
            f"Raw file is missing expected columns: {missing}. Found columns: {list(df.columns)}"
        )
    extra = sorted(set(renamed.columns) - set(EXPECTED_COLUMNS) - {SOURCE_ROW_ID_COLUMN})
    if extra:
        logger.info("Ignoring unexpected columns: %s", extra)
    return renamed


# --------------------------------------------------------------------------- parsing


def is_blank(series: pd.Series) -> pd.Series:
    """True where a text value is empty or whitespace only."""
    return series.str.strip().eq("")


def parse_dates(raw: pd.Series) -> tuple[pd.Series, pd.Series]:
    """Parse dates strictly against ``DATE_FORMATS``.

    Returns the parsed timestamps (NaT when blank or invalid) and the label of the
    format each value matched (empty when none matched). Values are never guessed:
    a string that is not exactly US ``m/d/YYYY`` or ISO ``YYYY-MM-DD``, or that is an
    impossible calendar date, or falls outside the plausible range, stays NaT.
    """
    text = raw.str.strip()
    parsed = pd.Series(pd.NaT, index=raw.index, dtype="datetime64[ns]")
    fmt_used = pd.Series("", index=raw.index, dtype=object)
    patterns = {"us": US_DATE_PATTERN, "iso": ISO_DATE_PATTERN}
    for label, fmt in DATE_FORMATS:
        candidates = parsed.isna() & text.str.match(patterns[label].pattern)
        if not candidates.any():
            continue
        converted = pd.to_datetime(text[candidates], format=fmt, errors="coerce")
        ok = converted.notna()
        parsed.loc[converted.index[ok]] = converted[ok]
        fmt_used.loc[converted.index[ok]] = label
    implausible = parsed.notna() & ((parsed < MIN_PLAUSIBLE_DATE) | (parsed > MAX_PLAUSIBLE_DATE))
    parsed[implausible] = pd.NaT
    fmt_used[implausible] = ""
    return parsed, fmt_used


def parse_numeric(raw: pd.Series) -> pd.Series:
    """Convert text to float, leaving NaN for blank or non-numeric values."""
    return pd.to_numeric(raw.str.strip(), errors="coerce")


def normalize_postal_code(raw: pd.Series) -> pd.Series:
    """Restore leading zeros lost by spreadsheet exports (e.g. ``'5401'`` -> ``'05401'``)."""
    text = raw.str.strip()
    numeric_short = text.str.fullmatch(r"\d{1,4}")
    return text.where(~numeric_short, text.str.zfill(POSTAL_CODE_LENGTH))


def parse_types(df: pd.DataFrame, qlog: QualityLog) -> pd.DataFrame:
    """Add typed columns next to the original text and record parse failures.

    Original text values are kept in ``*_raw`` columns for traceability; typed
    columns replace the text under the normalised name.
    """
    out = df.copy()
    out["row_id_raw"] = out["row_id"]
    out["row_id"] = parse_numeric(out["row_id"])
    out["postal_code_raw"] = out["postal_code"]
    out["postal_code"] = normalize_postal_code(out["postal_code"])

    for column in ("order_date", "ship_date"):
        parsed, fmt_used = parse_dates(out[column])
        invalid = parsed.isna() & ~is_blank(out[column])
        qlog.add_check(
            f"invalid_{column}",
            "dates",
            f"{EXPECTED_COLUMNS[column]} is not a valid US (m/d/YYYY) or ISO date",
            int(invalid.sum()),
            "fail",
            formats_detected(fmt_used),
        )
        qlog.add_issues(f"invalid_{column}", column, out[invalid], out.loc[invalid, column])
        out[column] = parsed

    for column in ("sales", "profit", "discount", "quantity"):
        values = parse_numeric(out[column])
        invalid = values.isna() & ~is_blank(out[column])
        if column == "quantity":
            non_integer = values.notna() & (values % 1 != 0)
            invalid |= non_integer
            values = values.where(~non_integer)
        qlog.add_check(
            f"invalid_numeric_{column}",
            "types",
            f"{EXPECTED_COLUMNS[column]} cannot be converted to a number",
            int(invalid.sum()),
            "fail",
        )
        qlog.add_issues(f"invalid_numeric_{column}", column, out[invalid], out.loc[invalid, column])
        out[column] = values

    out["quantity"] = out["quantity"].astype("Int64")
    bad_row_id = out["row_id"].isna() | (out["row_id"] % 1 != 0)
    qlog.add_check(
        "invalid_row_id", "types", "Row ID is not an integer", int(bad_row_id.sum()), "fail"
    )
    out["row_id"] = out["row_id"].where(~bad_row_id).astype("Int64")
    return out


def formats_detected(fmt_used: pd.Series) -> str:
    """Summarise which date formats were matched, e.g. ``'iso=9994'``."""
    counts = fmt_used[fmt_used != ""].value_counts().sort_index()
    return ", ".join(f"{label}={count}" for label, count in counts.items())


# --------------------------------------------------------------------------- row checks


def check_missing_values(df: pd.DataFrame, qlog: QualityLog) -> pd.Series:
    """Report blank values per column; return a mask of rows missing a critical field."""
    blanks = {c: df[c].isna() | is_blank(df[c].astype(str)) for c in EXPECTED_COLUMNS}
    detail = "; ".join(f"{c}={int(m.sum())}" for c, m in blanks.items() if m.any())
    critical = pd.concat([blanks[c] for c in CRITICAL_COLUMNS], axis=1).any(axis=1)
    optional = pd.concat(
        [blanks[c] for c in EXPECTED_COLUMNS if c not in CRITICAL_COLUMNS], axis=1
    ).any(axis=1)
    qlog.add_check(
        "missing_critical_values",
        "missing",
        "Blank value in a key, date or measure column",
        int(critical.sum()),
        "fail",
        detail,
    )
    qlog.add_check(
        "missing_descriptive_values",
        "missing",
        "Blank value in a descriptive column (row kept)",
        int(optional.sum()),
        "warn",
        detail,
    )
    return critical


def check_source_row_id(raw: pd.DataFrame, qlog: QualityLog) -> None:
    """Verify the csvbase export id, when present, matches Row ID."""
    if SOURCE_ROW_ID_COLUMN not in raw.columns:
        return
    mismatch = raw[SOURCE_ROW_ID_COLUMN].str.strip() != raw["row_id"].str.strip()
    qlog.add_check(
        "source_row_id_mismatch",
        "consistency",
        "csvbase_row_id differs from Row ID (export column is dropped)",
        int(mismatch.sum()),
        "warn",
    )


def check_duplicates(df: pd.DataFrame, qlog: QualityLog) -> pd.Series:
    """Flag repeated Row IDs (extra copies excluded) and repeated line content (kept)."""
    dup_id = df["row_id"].notna() & df.duplicated("row_id", keep="first")
    qlog.add_check(
        "duplicate_row_id",
        "duplicates",
        "Row ID appears more than once (first occurrence kept)",
        int(dup_id.sum()),
        "fail",
    )
    qlog.add_issues("duplicate_row_id", "row_id", df[dup_id], df.loc[dup_id, "row_id_raw"])

    content_cols = [c for c in EXPECTED_COLUMNS if c != "row_id"]
    dup_content = df.duplicated(content_cols, keep="first") & ~dup_id
    qlog.add_check(
        "duplicate_line_content",
        "duplicates",
        "Identical line except Row ID (kept: may be a genuine repeat purchase)",
        int(dup_content.sum()),
        "warn",
    )
    qlog.add_issues(
        "duplicate_line_content", "row_id", df[dup_content], df.loc[dup_content, "row_id_raw"]
    )
    return dup_id


def check_value_ranges(df: pd.DataFrame, qlog: QualityLog) -> pd.Series:
    """Flag discounts outside [0, 1], non-positive sales/quantity and ship-before-order."""
    discount_bad = df["discount"].notna() & ~df["discount"].between(0, 1)
    qlog.add_check(
        "discount_out_of_range",
        "ranges",
        "Discount outside the 0-1 range",
        int(discount_bad.sum()),
        "fail",
    )
    qlog.add_issues(
        "discount_out_of_range", "discount", df[discount_bad], df.loc[discount_bad, "discount"]
    )

    non_positive = (df["sales"].notna() & (df["sales"] <= 0)) | (
        df["quantity"].notna() & (df["quantity"] <= 0)
    )
    qlog.add_check(
        "non_positive_sales_or_quantity",
        "ranges",
        "Sales or Quantity is zero or negative",
        int(non_positive.sum()),
        "fail",
    )
    qlog.add_issues(
        "non_positive_sales_or_quantity", "sales", df[non_positive], df.loc[non_positive, "sales"]
    )

    ship_before = (
        df["order_date"].notna() & df["ship_date"].notna() & (df["ship_date"] < df["order_date"])
    )
    qlog.add_check(
        "ship_before_order",
        "dates",
        "Ship Date earlier than Order Date",
        int(ship_before.sum()),
        "fail",
    )
    qlog.add_issues(
        "ship_before_order",
        "ship_date",
        df[ship_before],
        df.loc[ship_before, "ship_date"].dt.strftime("%Y-%m-%d"),
    )
    return discount_bad | non_positive | ship_before


def check_postal_codes(df: pd.DataFrame, qlog: QualityLog) -> None:
    """Report postal codes whose leading zero was restored."""
    restored = df["postal_code"] != df["postal_code_raw"].str.strip()
    qlog.add_check(
        "postal_code_leading_zero_restored",
        "format",
        "Postal Code shorter than 5 digits; zero-padded (original kept in postal_code_raw)",
        int(restored.sum()),
        "warn",
    )


def invalid_rows_mask(df: pd.DataFrame) -> pd.Series:
    """Rows whose typed critical values failed to parse."""
    typed = ["row_id", "order_date", "ship_date", "sales", "profit", "discount", "quantity"]
    return df[typed].isna().any(axis=1)


# --------------------------------------------------------------------------- splitting


def add_order_derivations(df: pd.DataFrame) -> pd.DataFrame:
    """Add shipping_days (Ship Date minus Order Date, in days) and calendar fields."""
    out = df.copy()
    out["shipping_days"] = (out["ship_date"] - out["order_date"]).dt.days.astype("Int64")
    out["order_year"] = out["order_date"].dt.year.astype("Int64")
    out["order_month"] = out["order_date"].dt.strftime("%Y-%m")
    return out


def count_inconsistent(df: pd.DataFrame, key: str, attributes: tuple[str, ...]) -> pd.Series:
    """Number of keys with more than one distinct value, per attribute."""
    nunique = df.groupby(key, sort=True)[list(attributes)].nunique(dropna=False)
    return (nunique > 1).sum()


def build_orders(clean: pd.DataFrame, qlog: QualityLog) -> pd.DataFrame:
    """One row per Order ID; attributes come from the lowest Row ID of the order."""
    per_attr = count_inconsistent(clean, "order_id", ORDER_ATTRIBUTES)
    inconsistent_orders = (
        clean.groupby("order_id")[list(ORDER_ATTRIBUTES)].nunique(dropna=False).gt(1).any(axis=1)
    )
    detail = "; ".join(f"{attr}={int(n)}" for attr, n in per_attr.items() if n)
    qlog.add_check(
        "order_attribute_inconsistency",
        "consistency",
        "Lines of the same order disagree on an order-level attribute (lowest Row ID wins)",
        int(inconsistent_orders.sum()),
        "warn",
        detail,
    )
    columns = [
        "order_id",
        "order_date",
        "ship_date",
        "ship_mode",
        "customer_id",
        "segment",
        "country",
        "city",
        "state",
        "postal_code",
        "postal_code_raw",
        "region",
        "shipping_days",
        "order_year",
        "order_month",
    ]
    orders = clean.sort_values("row_id").drop_duplicates("order_id", keep="first")[columns]
    return orders.sort_values("order_id").reset_index(drop=True)


def build_customers(clean: pd.DataFrame, qlog: QualityLog) -> pd.DataFrame:
    """One row per Customer ID with the segment of their earliest line; names are dropped."""
    per_attr = count_inconsistent(clean, "customer_id", ("customer_name", "segment"))
    affected = int(
        clean.groupby("customer_id")[["customer_name", "segment"]]
        .nunique(dropna=False)
        .gt(1)
        .any(axis=1)
        .sum()
    )
    detail = "; ".join(f"{attr}={int(n)}" for attr, n in per_attr.items() if n)
    qlog.add_check(
        "customer_attribute_inconsistency",
        "consistency",
        "Same Customer ID with different name or segment (lowest Row ID wins)",
        affected,
        "warn",
        detail,
    )
    customers = clean.sort_values("row_id").drop_duplicates("customer_id", keep="first")
    return customers[["customer_id", "segment"]].sort_values("customer_id").reset_index(drop=True)


def build_products(clean: pd.DataFrame, qlog: QualityLog) -> pd.DataFrame:
    """One row per (Product ID, Product Name) with a deterministic surrogate key.

    Superstore reuses some Product IDs for different product names, so the ID alone
    is not a valid key. ``product_key`` numbers the sorted natural keys from 1.
    """
    names_per_id = clean.groupby("product_id")["product_name"].nunique()
    qlog.add_check(
        "product_id_multiple_names",
        "consistency",
        "Product ID used for more than one Product Name (keyed by ID + name)",
        int((names_per_id > 1).sum()),
        "warn",
    )
    natural_key = ["product_id", "product_name"]
    attrs = clean.groupby(natural_key)[["category", "sub_category"]].nunique(dropna=False)
    qlog.add_check(
        "product_attribute_inconsistency",
        "consistency",
        "Same product with different category or sub-category (lowest Row ID wins)",
        int(attrs.gt(1).any(axis=1).sum()),
        "warn",
    )
    products = (
        clean.sort_values("row_id")
        .drop_duplicates(natural_key, keep="first")[natural_key + ["category", "sub_category"]]
        .sort_values(natural_key)
        .reset_index(drop=True)
    )
    products.insert(0, "product_key", range(1, len(products) + 1))
    return products


def build_order_lines(clean: pd.DataFrame, products: pd.DataFrame) -> pd.DataFrame:
    """One row per Row ID with measures and foreign keys to orders and products."""
    keyed = clean.merge(
        products[["product_key", "product_id", "product_name"]],
        on=["product_id", "product_name"],
        how="left",
        validate="many_to_one",
    )
    columns = ["row_id", "order_id", "product_key", "sales", "quantity", "discount", "profit"]
    return keyed[columns].sort_values("row_id").reset_index(drop=True)


def check_integrity(prepared: PreparedData, qlog: QualityLog) -> None:
    """Verify primary-key uniqueness and that every foreign key resolves."""
    orders, lines = prepared.orders, prepared.order_lines
    if orders["order_id"].duplicated().any():
        raise DataIntegrityError("orders.order_id is not unique")
    if lines["row_id"].duplicated().any():
        raise DataIntegrityError("order_lines.row_id is not unique")

    orphans = {
        "orphan_line_order": (
            ~lines["order_id"].isin(orders["order_id"]),
            "Order line references an order that does not exist",
        ),
        "orphan_line_product": (
            lines["product_key"].isna()
            | ~lines["product_key"].isin(prepared.products["product_key"]),
            "Order line references a product that does not exist",
        ),
        "orphan_order_customer": (
            ~orders["customer_id"].isin(prepared.customers["customer_id"]),
            "Order references a customer that does not exist",
        ),
    }
    for check_id, (mask, description) in orphans.items():
        qlog.add_check(check_id, "orphans", description, int(mask.sum()), "fail")
        if mask.any():
            raise DataIntegrityError(f"{check_id}: {int(mask.sum())} orphaned rows")
    orders_without_lines = ~orders["order_id"].isin(lines["order_id"])
    qlog.add_check(
        "order_without_lines",
        "orphans",
        "Order with no order lines",
        int(orders_without_lines.sum()),
        "fail",
    )


# --------------------------------------------------------------------------- pipeline


def build_metadata(source: Path, raw_rows: int, prepared: PreparedData) -> dict:
    """Summarise the run. No timestamps, so identical input gives identical output."""
    orders = prepared.orders
    return {
        "pipeline_version": PIPELINE_VERSION,
        "source_file": source.name,
        "source_sha256": file_sha256(source),
        "source_rows": raw_rows,
        "clean_rows": len(prepared.order_lines),
        "excluded_rows": raw_rows - len(prepared.order_lines),
        "orders": len(orders),
        "customers": len(prepared.customers),
        "products": len(prepared.products),
        "min_order_date": orders["order_date"].min().strftime("%Y-%m-%d"),
        "max_order_date": orders["order_date"].max().strftime("%Y-%m-%d"),
    }


def prepare(raw_path: Path = RAW_FILE) -> PreparedData:
    """Run loading, typing, checks and the relational split, in memory."""
    qlog = QualityLog()
    raw = normalize_columns(load_raw(raw_path))
    check_source_row_id(raw, qlog)
    typed = parse_types(raw[list(EXPECTED_COLUMNS)], qlog)
    missing_critical = check_missing_values(raw[list(EXPECTED_COLUMNS)], qlog)
    duplicate_ids = check_duplicates(typed, qlog)
    out_of_range = check_value_ranges(typed, qlog)
    check_postal_codes(typed, qlog)

    excluded = missing_critical | invalid_rows_mask(typed) | duplicate_ids | out_of_range
    logger.info("Excluding %d of %d rows; see data_quality_issues.csv", excluded.sum(), len(typed))
    clean = add_order_derivations(typed[~excluded])

    products = build_products(clean, qlog)
    prepared = PreparedData(
        orders=build_orders(clean, qlog),
        order_lines=build_order_lines(clean, products),
        products=products,
        customers=build_customers(clean, qlog),
        quality_checks=pd.DataFrame(),
        quality_issues=pd.DataFrame(),
        metadata={},
    )
    check_integrity(prepared, qlog)
    prepared.quality_checks = pd.DataFrame(qlog.checks)
    issues = pd.DataFrame(qlog.issues, columns=["check_id", "row_id", "column_name", "raw_value"])
    issues.insert(0, "issue_id", range(1, len(issues) + 1))
    prepared.quality_issues = issues
    prepared.metadata = build_metadata(raw_path, len(raw), prepared)
    return prepared


def format_dates(df: pd.DataFrame) -> pd.DataFrame:
    """Render datetime columns as ISO ``YYYY-MM-DD`` strings for CSV/SQL output."""
    out = df.copy()
    for column in out.select_dtypes(include="datetime").columns:
        out[column] = out[column].dt.strftime("%Y-%m-%d")
    return out


def write_outputs(prepared: PreparedData, out_dir: Path = PROCESSED_DIR) -> None:
    """Write all prepared tables to ``out_dir`` as deterministic CSV/JSON files."""
    ensure_not_raw_dir(out_dir)
    tables = {
        "orders": prepared.orders,
        "order_lines": prepared.order_lines,
        "products": prepared.products,
        "customers": prepared.customers,
        "data_quality_checks": prepared.quality_checks,
        "data_quality_issues": prepared.quality_issues,
    }
    for name, table in tables.items():
        write_csv(format_dates(table), out_dir / f"{name}.csv")
    metadata_path = out_dir / "dataset_metadata.json"
    metadata_path.write_text(json.dumps(prepared.metadata, indent=2, sort_keys=True) + "\n")
    logger.info("Wrote %d tables and metadata to %s", len(tables), out_dir)


def main(argv: list[str] | None = None) -> None:
    """Command-line entry point."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, default=RAW_FILE)
    parser.add_argument("--output-dir", type=Path, default=PROCESSED_DIR)
    args = parser.parse_args(argv)
    setup_logging()
    write_outputs(prepare(args.input), args.output_dir)


if __name__ == "__main__":
    main()
