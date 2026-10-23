"""Compute KPI tables from the prepared data with DuckDB and validate them with pandas.

Every table that supports filtering uses the ``ALL`` sentinel for "all members" of a
dimension, so the API can answer any filter combination with a primary-key lookup.
Distinct counts (orders, customers) and order-level averages (shipping days) are
computed per grouping set rather than summed, because they are not additive: one
order can contain several categories.

Outputs (in ``data/processed/``): ``kpi_summary.csv``, ``kpi_monthly.csv``,
``subcategory_performance.csv``, ``product_performance.csv``,
``discount_band_performance.csv`` and ``shipping_performance.csv``.
"""

from __future__ import annotations

import argparse
import itertools
import logging
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

from analytics.config import ALL, FLOAT_DECIMALS, PROCESSED_DIR, setup_logging, write_csv

logger = logging.getLogger(__name__)

TOLERANCE = 1e-6

PROCESSED_DTYPES: dict[str, dict[str, str]] = {
    "orders": {
        "order_id": "str",
        "customer_id": "str",
        "segment": "str",
        "region": "str",
        "ship_mode": "str",
        "postal_code": "str",
        "postal_code_raw": "str",
        "order_month": "str",
        "shipping_days": "Int64",
        "order_year": "Int64",
    },
    "order_lines": {
        "row_id": "Int64",
        "order_id": "str",
        "product_key": "Int64",
        "quantity": "Int64",
    },
    "products": {"product_key": "Int64", "product_id": "str", "product_name": "str"},
    "customers": {"customer_id": "str", "segment": "str"},
}

LINE_MEASURES = """
    sum(sales)                                        AS sales,
    sum(profit)                                       AS profit,
    CAST(sum(quantity) AS BIGINT)                     AS units,
    count(*)                                          AS line_count,
    count(DISTINCT order_id)                          AS orders,
    count(DISTINCT customer_id)                       AS customers,
    avg(discount)                                     AS avg_discount,
    avg(CASE WHEN profit < 0 THEN 1.0 ELSE 0.0 END)   AS loss_line_share
"""

# Discount bands: (label, sort order, SQL predicate on ``discount``).
DISCOUNT_BANDS: tuple[tuple[str, int, str], ...] = (
    ("No discount", 1, "discount = 0"),
    ("1-20%", 2, "discount > 0 AND discount <= 0.2"),
    ("21-40%", 3, "discount > 0.2 AND discount <= 0.4"),
    ("Over 40%", 4, "discount > 0.4"),
)


class AggregationError(AssertionError):
    """Raised when a KPI table does not reconcile with the line-level data."""


@dataclass
class KpiTables:
    """All KPI outputs, keyed by output table name."""

    tables: dict[str, pd.DataFrame]

    def __getitem__(self, name: str) -> pd.DataFrame:
        return self.tables[name]


# --------------------------------------------------------------------------- loading


def load_processed(processed_dir: Path = PROCESSED_DIR) -> dict[str, pd.DataFrame]:
    """Read the prepared tables with explicit dtypes (postal codes and IDs stay text)."""
    frames: dict[str, pd.DataFrame] = {}
    for name, dtypes in PROCESSED_DTYPES.items():
        path = processed_dir / f"{name}.csv"
        if not path.exists():
            raise FileNotFoundError(
                f"{path} not found. Run `python -m analytics.prepare_data` first."
            )
        frames[name] = pd.read_csv(path, dtype=dtypes, keep_default_na=False, na_values=[""])
    return frames


def connect(frames: dict[str, pd.DataFrame]) -> duckdb.DuckDBPyConnection:
    """Open an in-memory DuckDB with a denormalised ``lines`` view.

    A single thread keeps floating-point summation order, and therefore output,
    identical between runs.
    """
    con = duckdb.connect(":memory:")
    con.execute("SET threads = 1")
    for name, frame in frames.items():
        con.register(name, frame)
    band_case = " ".join(f"WHEN {pred} THEN '{label}'" for label, _, pred in DISCOUNT_BANDS)
    band_order = " ".join(f"WHEN {pred} THEN {order}" for _, order, pred in DISCOUNT_BANDS)
    con.execute(
        f"""
        CREATE VIEW lines AS
        SELECT
            l.row_id, l.order_id, l.product_key, l.sales, l.quantity, l.discount, l.profit,
            o.customer_id, o.segment, o.region, o.ship_mode, o.shipping_days,
            CAST(o.order_year AS VARCHAR) AS order_year,
            o.order_month,
            p.category, p.sub_category,
            CASE {band_case} END AS discount_band,
            CASE {band_order} END AS discount_band_order
        FROM order_lines l
        JOIN orders o USING (order_id)
        JOIN products p USING (product_key)
        """
    )
    return con


# --------------------------------------------------------------------------- aggregation


def grouping_sets(optional: Sequence[str]) -> Iterable[tuple[str, ...]]:
    """All subsets of ``optional`` dimensions, from the full set down to the empty set."""
    for size in range(len(optional), -1, -1):
        yield from itertools.combinations(optional, size)


def aggregate(
    con: duckdb.DuckDBPyConnection,
    measures_sql: str,
    fixed: Sequence[str] = (),
    optional: Sequence[str] = (),
    source: str = "lines",
) -> pd.DataFrame:
    """Aggregate ``source`` for ``fixed`` dims plus every subset of ``optional`` dims.

    Dimensions left out of a grouping set are reported as ``ALL``.
    """
    parts = []
    for subset in grouping_sets(optional):
        active = [*fixed, *subset]
        select_dims = [f"CAST({d} AS VARCHAR) AS {d}" for d in active] + [
            f"'{ALL}' AS {d}" for d in optional if d not in subset
        ]
        group_by = f"GROUP BY {', '.join(active)}" if active else ""
        sql = f"SELECT {', '.join(select_dims + [measures_sql])} FROM {source} {group_by}"
        parts.append(con.execute(sql).df())
    columns = [*fixed, *optional]
    result = pd.concat(parts, ignore_index=True)
    return result.sort_values(columns, kind="stable").reset_index(drop=True)[
        columns + [c for c in result.columns if c not in columns]
    ]


def order_level_shipping(
    con: duckdb.DuckDBPyConnection, fixed: Sequence[str] = (), optional: Sequence[str] = ()
) -> pd.DataFrame:
    """Shipping-day statistics counted once per order within each grouping set."""
    parts = []
    for subset in grouping_sets(optional):
        active = [*fixed, *subset]
        dims = ", ".join(active)
        inner = f"SELECT DISTINCT order_id, shipping_days{', ' + dims if dims else ''} FROM lines"
        sub = aggregate(
            con,
            """
            count(*)                     AS shipped_orders,
            avg(shipping_days)           AS avg_shipping_days,
            median(shipping_days)        AS median_shipping_days,
            min(shipping_days)           AS min_shipping_days,
            max(shipping_days)           AS max_shipping_days
            """,
            fixed=active,
            source=f"({inner})",
        )
        for d in optional:
            if d not in subset:
                sub[d] = ALL
        parts.append(sub)
    columns = [*fixed, *optional]
    result = pd.concat(parts, ignore_index=True)
    return result.sort_values(columns, kind="stable").reset_index(drop=True)[
        columns + [c for c in result.columns if c not in columns]
    ]


def add_ratios(df: pd.DataFrame) -> pd.DataFrame:
    """Add profit margin and average order value where the denominators allow it."""
    out = df.copy()
    out["profit_margin"] = safe_divide(out["profit"], out["sales"])
    if "orders" in out:
        out["average_order_value"] = safe_divide(out["sales"], out["orders"])
    return out


def safe_divide(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    """Element-wise division returning NaN where the denominator is zero."""
    denominator = denominator.astype(float)
    return numerator.astype(float) / denominator.where(denominator != 0, np.nan)


def add_year_over_year(df: pd.DataFrame, dims: Sequence[str]) -> pd.DataFrame:
    """Join the previous year's sales and profit for the same filter combination."""
    dated = df[df["order_year"] != ALL].copy()
    prior = dated[["order_year", *dims, "sales", "profit"]].copy()
    prior["order_year"] = (prior["order_year"].astype(int) + 1).astype(str)
    prior = prior.rename(columns={"sales": "prior_sales", "profit": "prior_profit"})
    out = df.merge(prior, on=["order_year", *dims], how="left", validate="one_to_one")
    out["sales_yoy"] = safe_divide(out["sales"] - out["prior_sales"], out["prior_sales"])
    # Profit can be negative, so growth is relative to the absolute prior value.
    out["profit_yoy"] = safe_divide(out["profit"] - out["prior_profit"], out["prior_profit"].abs())
    return out


def round_floats(df: pd.DataFrame) -> pd.DataFrame:
    """Round float columns to ``FLOAT_DECIMALS`` for stable, comparable output."""
    out = df.copy()
    floats = out.select_dtypes(include="float").columns
    out[floats] = out[floats].round(FLOAT_DECIMALS)
    return out


def kpi_summary(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Headline KPIs for every year x region x segment x category combination."""
    dims = ["order_year", "region", "segment", "category"]
    lines = aggregate(con, LINE_MEASURES, optional=dims)
    shipping = order_level_shipping(con, optional=dims)[[*dims, "avg_shipping_days"]]
    summary = lines.merge(shipping, on=dims, how="left", validate="one_to_one")
    return add_year_over_year(add_ratios(summary), dims[1:])


def kpi_monthly(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Monthly trend for every region x segment x category combination."""
    measures = (
        "sum(sales) AS sales, sum(profit) AS profit, CAST(sum(quantity) AS BIGINT) AS units, "
    )
    measures += "count(DISTINCT order_id) AS orders"
    monthly = aggregate(
        con, measures, fixed=["order_month"], optional=["region", "segment", "category"]
    )
    return add_ratios(monthly)


def reorder(df: pd.DataFrame, keys: Sequence[str]) -> pd.DataFrame:
    """Put ``keys`` first and sort by them, so every table has a stable layout and order."""
    keys = list(keys)
    columns = keys + [c for c in df.columns if c not in keys]
    return df[columns].sort_values(keys, kind="stable", ignore_index=True)


def subcategory_performance(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Sub-category KPIs by year (including ``ALL``)."""
    table = aggregate(
        con, LINE_MEASURES, fixed=["category", "sub_category"], optional=["order_year"]
    )
    return reorder(add_ratios(table), ["order_year", "category", "sub_category"])


def product_performance(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Product KPIs by year (including ``ALL``)."""
    measures = (
        "sum(sales) AS sales, sum(profit) AS profit, CAST(sum(quantity) AS BIGINT) AS units, "
        "count(*) AS line_count, count(DISTINCT order_id) AS orders, avg(discount) AS avg_discount"
    )
    table = aggregate(con, measures, fixed=["product_key"], optional=["order_year"])
    table["product_key"] = table["product_key"].astype(int)
    table = add_ratios(table).drop(columns="average_order_value")
    return reorder(table, ["order_year", "product_key"])


def discount_band_performance(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Margin and loss share per discount band, by year and category (including ``ALL``)."""
    measures = (
        "min(discount_band_order) AS band_order, sum(sales) AS sales, sum(profit) AS profit, "
        "count(*) AS line_count, avg(discount) AS avg_discount, "
        "avg(CASE WHEN profit < 0 THEN 1.0 ELSE 0.0 END) AS loss_line_share"
    )
    table = aggregate(con, measures, fixed=["discount_band"], optional=["order_year", "category"])
    table = add_ratios(table)
    table["band_order"] = table["band_order"].astype(int)
    table = reorder(table, ["order_year", "category", "band_order"])
    return table[
        [
            "order_year",
            "category",
            "discount_band",
            "band_order",
            *[
                c
                for c in table.columns
                if c not in ("order_year", "category", "discount_band", "band_order")
            ],
        ]
    ]


def shipping_performance(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Order-level shipping-day statistics by ship mode, year and region."""
    table = order_level_shipping(con, fixed=["ship_mode"], optional=["order_year", "region"])
    for column in ("min_shipping_days", "max_shipping_days", "shipped_orders"):
        table[column] = table[column].astype(int)
    return reorder(table, ["order_year", "region", "ship_mode"])


# --------------------------------------------------------------------------- validation


def assert_close(label: str, actual: float, expected: float) -> None:
    """Raise ``AggregationError`` unless two totals agree within ``TOLERANCE``."""
    if not np.isclose(actual, expected, rtol=TOLERANCE, atol=TOLERANCE):
        raise AggregationError(f"{label}: got {actual!r}, expected {expected!r}")


def all_rows(df: pd.DataFrame, dims: Sequence[str], keep: str | None = None) -> pd.DataFrame:
    """Rows where every dimension except ``keep`` equals ``ALL`` (and ``keep`` does not)."""
    mask = pd.Series(True, index=df.index)
    for d in dims:
        mask &= (df[d] != ALL) if d == keep else (df[d] == ALL)
    return df[mask]


def validate(tables: KpiTables, frames: dict[str, pd.DataFrame]) -> None:
    """Reconcile every KPI table against totals computed independently with pandas."""
    lines, orders = frames["order_lines"], frames["orders"]
    totals = {
        "sales": float(lines["sales"].sum()),
        "profit": float(lines["profit"].sum()),
        "units": float(lines["quantity"].sum()),
        "line_count": float(len(lines)),
    }
    dims = ["order_year", "region", "segment", "category"]
    summary = tables["kpi_summary"]
    grand = all_rows(summary, dims)
    if len(grand) != 1:
        raise AggregationError(f"kpi_summary has {len(grand)} grand-total rows, expected 1")
    grand = grand.iloc[0]
    for measure, expected in totals.items():
        assert_close(f"kpi_summary total {measure}", grand[measure], expected)
    assert_close("kpi_summary total orders", grand["orders"], orders["order_id"].nunique())
    assert_close("kpi_summary total customers", grand["customers"], orders["customer_id"].nunique())
    assert_close(
        "kpi_summary avg_shipping_days", grand["avg_shipping_days"], orders["shipping_days"].mean()
    )

    for dim in dims:
        members = all_rows(summary, dims, keep=dim)
        for measure in ("sales", "profit", "units", "line_count"):
            assert_close(
                f"kpi_summary {dim} sum {measure}", members[measure].sum(), totals[measure]
            )
        if dim != "category":
            # Each order belongs to exactly one year, region and segment.
            assert_close(f"kpi_summary {dim} sum orders", members["orders"].sum(), len(orders))
        elif members["orders"].sum() < len(orders):
            raise AggregationError("Category order counts cannot sum to fewer than total orders")

    single_set_checks = {
        "kpi_monthly": all_rows(tables["kpi_monthly"], ["region", "segment", "category"]),
        "subcategory_performance": all_rows(tables["subcategory_performance"], ["order_year"]),
        "product_performance": all_rows(tables["product_performance"], ["order_year"]),
        "discount_band_performance": all_rows(
            tables["discount_band_performance"], ["order_year", "category"]
        ),
    }
    for name, table in single_set_checks.items():
        for measure in ("sales", "profit"):
            assert_close(f"{name} sum {measure}", table[measure].sum(), totals[measure])

    shipping = all_rows(tables["shipping_performance"], ["order_year", "region"])
    assert_close("shipping_performance orders", shipping["shipped_orders"].sum(), len(orders))
    logger.info("All KPI tables reconcile with line-level totals")


# --------------------------------------------------------------------------- pipeline


def calculate(frames: dict[str, pd.DataFrame]) -> KpiTables:
    """Build and validate every KPI table from the prepared frames."""
    con = connect(frames)
    try:
        builders = {
            "kpi_summary": kpi_summary,
            "kpi_monthly": kpi_monthly,
            "subcategory_performance": subcategory_performance,
            "product_performance": product_performance,
            "discount_band_performance": discount_band_performance,
            "shipping_performance": shipping_performance,
        }
        tables = KpiTables({name: round_floats(build(con)) for name, build in builders.items()})
    finally:
        con.close()
    for name, table in tables.tables.items():
        logger.info("Built %-26s %6d rows", name, len(table))
    validate(tables, frames)
    return tables


def write_outputs(tables: KpiTables, out_dir: Path = PROCESSED_DIR) -> None:
    """Write each KPI table as a CSV."""
    for name, table in tables.tables.items():
        write_csv(table, out_dir / f"{name}.csv")
    logger.info("Wrote %d KPI tables to %s", len(tables.tables), out_dir)


def main(argv: list[str] | None = None) -> None:
    """Command-line entry point."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--processed-dir", type=Path, default=PROCESSED_DIR)
    args = parser.parse_args(argv)
    setup_logging()
    write_outputs(calculate(load_processed(args.processed_dir)), args.processed_dir)


if __name__ == "__main__":
    main()
