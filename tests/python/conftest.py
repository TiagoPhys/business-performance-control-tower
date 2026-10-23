"""Shared fixtures: a tiny synthetic Superstore file with hand-checkable numbers.

Orders (3), lines (5), customers (2):

    row order  date        ship        cust region product           cat    sales  qty disc profit
    1   O-1    2016-01-10  2016-01-13  C-1  East   P-1 Chair A       Furn    100    2  0.0    20
    2   O-1    2016-01-10  2016-01-13  C-1  East   P-2 Pen B         Off      50    5  0.2    -5
    3   O-2    2016-02-05  2016-02-10  C-2  West   P-1 Chair A       Furn    200    1  0.5   -40
    4   O-3    2017-03-01  2017-03-01  C-1  East   P-3 Table C       Furn    300    3  0.3   -30
    5   O-3    2017-03-01  2017-03-01  C-1  East   P-1 Chair A       Furn    150    1  0.0    75

Totals: sales 800, profit 20, units 12; shipping days per order 3, 5, 0.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

from analytics import calculate_kpis, prepare_data

HEADER = [
    "Row ID",
    "Order ID",
    "Order Date",
    "Ship Date",
    "Ship Mode",
    "Customer ID",
    "Customer Name",
    "Segment",
    "Country",
    "City",
    "State",
    "Postal Code",
    "Region",
    "Product ID",
    "Category",
    "Sub-Category",
    "Product Name",
    "Sales",
    "Quantity",
    "Discount",
    "Profit",
]

ORDER_ATTRS = {
    "O-1": (
        "2016-01-10",
        "2016-01-13",
        "Second Class",
        "C-1",
        "Alice Example",
        "Consumer",
        "New York City",
        "New York",
        "10024",
        "East",
    ),
    "O-2": (
        "2016-02-05",
        "2016-02-10",
        "Standard Class",
        "C-2",
        "Bob Example",
        "Corporate",
        "Los Angeles",
        "California",
        "90036",
        "West",
    ),
    "O-3": (
        "2017-03-01",
        "2017-03-01",
        "Same Day",
        "C-1",
        "Alice Example",
        "Consumer",
        "Burlington",
        "Vermont",
        "5401",
        "East",
    ),
}

PRODUCTS = {
    "P-1": ("Furniture", "Chairs", "Chair A"),
    "P-2": ("Office Supplies", "Art", "Pen B"),
    "P-3": ("Furniture", "Tables", "Table C"),
}

LINES = [
    (1, "O-1", "P-1", "100.000000", "2", "0.000000", "20.000000"),
    (2, "O-1", "P-2", "50.000000", "5", "0.200000", "-5.000000"),
    (3, "O-2", "P-1", "200.000000", "1", "0.500000", "-40.000000"),
    (4, "O-3", "P-3", "300.000000", "3", "0.300000", "-30.000000"),
    (5, "O-3", "P-1", "150.000000", "1", "0.000000", "75.000000"),
]


def make_rows() -> list[dict[str, str]]:
    """Build the synthetic raw rows as text, keyed by the original headers."""
    rows = []
    for row_id, order_id, product_id, sales, qty, disc, profit in LINES:
        (odate, sdate, mode, cust, name, seg, city, state, postal, region) = ORDER_ATTRS[order_id]
        category, sub_category, product_name = PRODUCTS[product_id]
        rows.append(
            {
                "Row ID": str(row_id),
                "Order ID": order_id,
                "Order Date": odate,
                "Ship Date": sdate,
                "Ship Mode": mode,
                "Customer ID": cust,
                "Customer Name": name,
                "Segment": seg,
                "Country": "United States",
                "City": city,
                "State": state,
                "Postal Code": postal,
                "Region": region,
                "Product ID": product_id,
                "Category": category,
                "Sub-Category": sub_category,
                "Product Name": product_name,
                "Sales": sales,
                "Quantity": qty,
                "Discount": disc,
                "Profit": profit,
            }
        )
    return rows


def write_raw(path: Path, rows: list[dict[str, str]], csvbase_style: bool = True) -> Path:
    """Write rows as a raw CSV; csvbase style adds its id column and a BOM in 'Row ID'."""
    path.parent.mkdir(parents=True, exist_ok=True)
    header = list(rows[0].keys()) if rows else HEADER
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        if csvbase_style:
            writer.writerow(["csvbase_row_id", *["﻿" + h if h == "Row ID" else h for h in header]])
            for row in rows:
                writer.writerow([row.get("Row ID", ""), *[row[h] for h in header]])
        else:
            writer.writerow(header)
            for row in rows:
                writer.writerow([row[h] for h in header])
    return path


@pytest.fixture
def raw_rows() -> list[dict[str, str]]:
    """Fresh, mutable copy of the synthetic rows."""
    return make_rows()


@pytest.fixture
def raw_file(tmp_path: Path, raw_rows: list[dict[str, str]]) -> Path:
    """The synthetic rows written as a csvbase-style raw file."""
    return write_raw(tmp_path / "raw" / "superstore.csv", raw_rows)


@pytest.fixture
def processed_dir(tmp_path: Path, raw_file: Path) -> Path:
    """Run prepare + KPI stages on the synthetic file; return the output directory."""
    out = tmp_path / "processed"
    prepare_data.write_outputs(prepare_data.prepare(raw_file), out)
    frames = calculate_kpis.load_processed(out)
    calculate_kpis.write_outputs(calculate_kpis.calculate(frames), out)
    return out
