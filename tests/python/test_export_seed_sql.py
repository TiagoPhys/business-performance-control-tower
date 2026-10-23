"""Tests for the D1 seed export: literals, batching, schema conformance and loading."""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

import pytest

from analytics import export_seed_sql as seed
from analytics import generate_insights as gi
from analytics.config import SCHEMA_FILE, write_csv


@pytest.fixture
def full_processed_dir(processed_dir: Path) -> Path:
    """Processed dir including insights, i.e. everything the seed needs."""
    write_csv(gi.to_frame(gi.generate(gi.load_kpis(processed_dir))), processed_dir / "insights.csv")
    return processed_dir


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, "NULL"),
        (3, "3"),
        (True, "1"),
        (261.96, "261.96"),
        (0.1 + 0.2, "0.3"),
        (-0.0, "0.0"),
        ("O'Brien", "'O''Brien'"),
        ("Robert'); DROP TABLE orders;--", "'Robert''); DROP TABLE orders;--'"),
    ],
)
def test_sql_literal(value: object, expected: str) -> None:
    assert seed.sql_literal(value) == expected


@pytest.mark.parametrize("value", [float("nan"), float("inf"), "a\x00b"])
def test_sql_literal_rejects_unsafe_values(value: object) -> None:
    with pytest.raises(ValueError):
        seed.sql_literal(value)


def test_convert_value_follows_declared_type() -> None:
    assert seed.convert_value("3.000000", seed.Column("n", "INTEGER")) == 3
    assert seed.convert_value("1.5", seed.Column("x", "REAL")) == 1.5
    assert seed.convert_value("02134", seed.Column("zip", "TEXT")) == "02134"
    assert seed.convert_value("", seed.Column("zip", "TEXT")) is None
    with pytest.raises(seed.SchemaMismatchError):
        seed.convert_value("3.5", seed.Column("n", "INTEGER"))


def test_insert_batches_respect_limits() -> None:
    columns = (seed.Column("id", "INTEGER"), seed.Column("label", "TEXT"))
    rows = tuple((i, "x" * 50) for i in range(1, 101))
    table = seed.TableData("demo", columns, rows)
    statements = list(seed.insert_statements(table, max_bytes=1_000, max_rows=30))
    assert len(statements) > 1
    assert all(len(s.encode("utf-8")) <= 1_000 for s in statements)
    assert all(s.count("\n(") <= 30 for s in statements)
    with sqlite3.connect(":memory:") as con:
        con.execute("CREATE TABLE demo (id INTEGER PRIMARY KEY, label TEXT)")
        for statement in statements:
            con.execute(statement)
        assert con.execute("SELECT count(*), sum(id) FROM demo").fetchone() == (100, 5050)


def test_oversized_row_is_rejected() -> None:
    table = seed.TableData("demo", (seed.Column("t", "TEXT"),), (("x" * 2_000,),))
    with pytest.raises(ValueError, match="exceeds"):
        list(seed.insert_statements(table, max_bytes=1_000))


def test_schema_is_read_from_migration() -> None:
    schema = seed.read_schema(SCHEMA_FILE)
    assert set(schema) == set(seed.TABLE_ORDER)
    order_cols = [c.name for c in schema["orders"]]
    assert order_cols[:3] == ["order_id", "order_date", "ship_date"]
    assert "customer_name" not in order_cols


def test_csv_with_unexpected_column_is_rejected(full_processed_dir: Path) -> None:
    path = full_processed_dir / "customers.csv"
    path.write_text(
        path.read_text(encoding="utf-8").replace("segment", "segment_x", 1), encoding="utf-8"
    )
    with pytest.raises(seed.SchemaMismatchError, match="customers"):
        seed.export(full_processed_dir, full_processed_dir / "seed.sql")


def test_export_loads_into_sqlite_and_matches_kpis(
    full_processed_dir: Path, tmp_path: Path
) -> None:
    output = seed.export(full_processed_dir, tmp_path / "seed.sql")
    sql = output.read_text(encoding="utf-8")
    assert "BEGIN" not in sql and "COMMIT" not in sql
    assert "Alice" not in sql  # customer names never reach D1
    with sqlite3.connect(":memory:") as con:
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(SCHEMA_FILE.read_text(encoding="utf-8"))
        con.executescript(sql)
        # The same aggregate computed in SQL from row-level tables and read from the KPI table.
        from_lines = con.execute(
            "SELECT round(sum(sales), 6), count(DISTINCT order_id) FROM order_lines"
        ).fetchone()
        from_kpi = con.execute(
            "SELECT sales, orders FROM kpi_summary WHERE order_year = 'ALL' AND region = 'ALL' "
            "AND segment = 'ALL' AND category = 'ALL'"
        ).fetchone()
        assert from_lines == pytest.approx(from_kpi)
        assert from_kpi == pytest.approx((800, 3))
        postal = con.execute("SELECT postal_code FROM orders WHERE order_id = 'O-3'").fetchone()
        assert postal == ("05401",)
        assert con.execute("SELECT count(*) FROM insights").fetchone()[0] >= 3


def test_export_is_deterministic(full_processed_dir: Path, tmp_path: Path) -> None:
    first = seed.export(full_processed_dir, tmp_path / "a.sql").read_bytes()
    second = seed.export(full_processed_dir, tmp_path / "b.sql").read_bytes()
    assert first == second


def test_rows_written_estimate() -> None:
    columns = (seed.Column("id", "INTEGER"),)
    tables = [
        seed.TableData("order_lines", columns, ((1,), (2,))),
        seed.TableData("kpi_summary", columns, ((1,),)),
    ]
    assert seed.estimate_rows_written(tables) == 5


def test_export_only_selected_tables(full_processed_dir: Path, tmp_path: Path) -> None:
    sql = seed.export(full_processed_dir, tmp_path / "insights.sql", only=["insights"]).read_text(
        encoding="utf-8"
    )
    assert 'DELETE FROM "insights";' in sql
    assert 'INSERT INTO "insights"' in sql
    tables_touched = set(re.findall(r'(?:DELETE FROM|INSERT INTO) "(\w+)"', sql))
    assert tables_touched == {"insights"}
    with pytest.raises(seed.SchemaMismatchError, match="Unknown tables"):
        seed.export(full_processed_dir, tmp_path / "x.sql", only=["nope"])
