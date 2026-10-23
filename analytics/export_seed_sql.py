"""Export the processed tables as a Cloudflare D1 load script (``generated/seed.sql``).

The column list and types for every table are read from the D1 migration itself
(``api/migrations/0001_schema.sql``), so the seed cannot drift from the schema: a
missing or unexpected column is an error. Rows are written as multi-row INSERTs
batched by both row count and byte size, to stay under D1's per-statement limit.

The script is idempotent (it deletes existing rows, children first) and uses no
``BEGIN``/``COMMIT``, which D1 does not accept in SQL files. Before writing, the
seed is loaded into an in-memory SQLite database with foreign keys enforced and the
row counts are compared with the source CSVs.

Note: deleted rows count toward D1's rows-written quota, so reloading a populated
database costs roughly twice as much as the first load.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import math
import sqlite3
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path

from analytics.config import (
    FLOAT_DECIMALS,
    PIPELINE_VERSION,
    PROCESSED_DIR,
    SCHEMA_FILE,
    SEED_FILE,
    ensure_not_raw_dir,
    setup_logging,
)

logger = logging.getLogger(__name__)

# D1 caps a single SQL statement at 100 KB; keep a safety margin.
MAX_STATEMENT_BYTES = 90_000
MAX_ROWS_PER_STATEMENT = 250

# Load order respects foreign keys; deletes run in reverse.
TABLE_ORDER: tuple[str, ...] = (
    "dataset_metadata",
    "customers",
    "products",
    "orders",
    "order_lines",
    "kpi_summary",
    "kpi_monthly",
    "subcategory_performance",
    "product_performance",
    "discount_band_performance",
    "shipping_performance",
    "insights",
    "data_quality_checks",
    "data_quality_issues",
)


class SchemaMismatchError(ValueError):
    """Raised when a processed CSV does not match the D1 table definition."""


@dataclass(frozen=True)
class Column:
    """A column name and its declared SQLite type."""

    name: str
    declared_type: str


@dataclass(frozen=True)
class TableData:
    """Rows for one table, already typed and in schema column order."""

    name: str
    columns: tuple[Column, ...]
    rows: tuple[tuple, ...]


# --------------------------------------------------------------------------- schema


def read_schema(schema_path: Path = SCHEMA_FILE) -> dict[str, tuple[Column, ...]]:
    """Return ``{table: columns}`` by executing the migration in an in-memory SQLite DB."""
    if not schema_path.exists():
        raise FileNotFoundError(f"D1 schema not found: {schema_path}")
    with sqlite3.connect(":memory:") as con:
        con.executescript(schema_path.read_text(encoding="utf-8"))
        tables = [
            name
            for (name,) in con.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
            )
        ]
        return {
            table: tuple(
                Column(row[1], row[2].upper())
                for row in con.execute(f"PRAGMA table_info({quote_identifier(table)})")
            )
            for table in tables
        }


def quote_identifier(name: str) -> str:
    """Quote an SQL identifier."""
    return '"' + name.replace('"', '""') + '"'


# --------------------------------------------------------------------------- values


def convert_value(raw: str | None, column: Column) -> object:
    """Convert CSV text to a Python value according to the column's declared type."""
    if raw is None or raw == "":
        return None
    if column.declared_type == "INTEGER":
        number = float(raw)
        if not number.is_integer():
            raise SchemaMismatchError(f"{column.name}: {raw!r} is not an integer")
        return int(number)
    if column.declared_type == "REAL":
        return float(raw)
    return raw


def sql_literal(value: object) -> str:
    """Render a Python value as an SQLite literal.

    Floats are rounded to ``FLOAT_DECIMALS`` and written with ``repr`` so the same
    value always produces the same text. Non-finite floats are rejected.
    """
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"Cannot export non-finite float {value!r}")
        rounded = round(value, FLOAT_DECIMALS)
        return repr(rounded + 0.0)  # + 0.0 turns -0.0 into 0.0
    text = str(value)
    if "\x00" in text:
        raise ValueError("NUL characters are not allowed in exported text")
    return "'" + text.replace("'", "''") + "'"


# --------------------------------------------------------------------------- loading


def read_csv_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    """Read a processed CSV as text, preserving values exactly as written."""
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run the earlier pipeline stages first.")
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return list(reader.fieldnames or []), list(reader)


def load_table(name: str, columns: Sequence[Column], processed_dir: Path) -> TableData:
    """Load ``name`` from its CSV, checking it has exactly the schema's columns."""
    header, records = read_csv_rows(processed_dir / f"{name}.csv")
    expected = [c.name for c in columns]
    missing = sorted(set(expected) - set(header))
    extra = sorted(set(header) - set(expected))
    if missing or extra:
        raise SchemaMismatchError(f"{name}: missing columns {missing}, unexpected columns {extra}")
    rows = tuple(tuple(convert_value(rec[c.name], c) for c in columns) for rec in records)
    return TableData(name, tuple(columns), rows)


def load_metadata(columns: Sequence[Column], processed_dir: Path) -> TableData:
    """Turn ``dataset_metadata.json`` into key/value rows, sorted by key."""
    path = processed_dir / "dataset_metadata.json"
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run `python -m analytics.prepare_data` first.")
    metadata = json.loads(path.read_text(encoding="utf-8"))
    metadata["seed_pipeline_version"] = PIPELINE_VERSION
    rows = tuple((key, str(metadata[key])) for key in sorted(metadata))
    return TableData("dataset_metadata", tuple(columns), rows)


def load_all(schema: dict[str, tuple[Column, ...]], processed_dir: Path) -> list[TableData]:
    """Load every table in ``TABLE_ORDER``; the schema must define exactly those tables."""
    if set(schema) != set(TABLE_ORDER):
        raise SchemaMismatchError(
            f"Schema tables {sorted(schema)} differ from export tables {sorted(TABLE_ORDER)}"
        )
    return [
        load_metadata(schema[name], processed_dir)
        if name == "dataset_metadata"
        else load_table(name, schema[name], processed_dir)
        for name in TABLE_ORDER
    ]


# --------------------------------------------------------------------------- SQL generation


def insert_statements(
    table: TableData,
    max_bytes: int = MAX_STATEMENT_BYTES,
    max_rows: int = MAX_ROWS_PER_STATEMENT,
) -> Iterator[str]:
    """Yield multi-row INSERT statements no larger than ``max_bytes`` / ``max_rows``."""
    column_list = ", ".join(quote_identifier(c.name) for c in table.columns)
    prefix = f"INSERT INTO {quote_identifier(table.name)} ({column_list}) VALUES\n"
    prefix_bytes = len(prefix.encode("utf-8"))
    batch: list[str] = []
    size = prefix_bytes + 1  # trailing ';'
    for row in table.rows:
        values = "(" + ", ".join(sql_literal(v) for v in row) + ")"
        value_bytes = len(values.encode("utf-8")) + 2  # ',\n' separator
        if prefix_bytes + value_bytes + 1 > max_bytes:
            raise ValueError(f"A single {table.name} row exceeds {max_bytes} bytes")
        if batch and (size + value_bytes > max_bytes or len(batch) >= max_rows):
            yield prefix + ",\n".join(batch) + ";"
            batch, size = [], prefix_bytes + 1
        batch.append(values)
        size += value_bytes
    if batch:
        yield prefix + ",\n".join(batch) + ";"


def build_seed_sql(tables: Sequence[TableData], source_sha256: str) -> str:
    """Assemble the full, deterministic seed script."""
    lines = [
        "-- Generated by analytics/export_seed_sql.py. Do not edit by hand.",
        f"-- Pipeline version: {PIPELINE_VERSION}",
        f"-- Source sha256: {source_sha256}",
        "-- Load: wrangler d1 execute <DB_NAME> --file generated/seed.sql [--local | --remote]",
        "",
        "-- Remove existing rows, children before parents.",
    ]
    lines += [f"DELETE FROM {quote_identifier(t.name)};" for t in reversed(tables)]
    for table in tables:
        lines += ["", f"-- {table.name}: {len(table.rows)} rows"]
        lines += list(insert_statements(table))
    return "\n".join(lines) + "\n"


def statements(sql: str) -> Iterable[str]:
    """Split the generated script into statements (safe for our own output only)."""
    buffer: list[str] = []
    for line in sql.splitlines():
        if not buffer and (line.startswith("--") or not line.strip()):
            continue
        buffer.append(line)
        if line.endswith(";") and sqlite3.complete_statement("\n".join(buffer)):
            yield "\n".join(buffer)
            buffer = []


# --------------------------------------------------------------------------- validation


def validate_seed(sql: str, tables: Sequence[TableData], schema_path: Path = SCHEMA_FILE) -> None:
    """Load schema + seed into SQLite with FK enforcement and compare row counts.

    The seed is loaded twice to prove it is idempotent.
    """
    for statement in statements(sql):
        size = len(statement.encode("utf-8"))
        if size > MAX_STATEMENT_BYTES:
            raise ValueError(f"Statement of {size} bytes exceeds {MAX_STATEMENT_BYTES}")
    with sqlite3.connect(":memory:") as con:
        con.execute("PRAGMA foreign_keys = ON")
        con.executescript(schema_path.read_text(encoding="utf-8"))
        con.executescript(sql)
        con.executescript(sql)
        violations = con.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise ValueError(f"Foreign key violations after load: {violations[:5]}")
        for table in tables:
            (count,) = con.execute(
                f"SELECT count(*) FROM {quote_identifier(table.name)}"
            ).fetchone()
            if count != len(table.rows):
                raise ValueError(f"{table.name}: loaded {count} rows, expected {len(table.rows)}")
    logger.info("Seed validated in SQLite: schema, constraints, foreign keys and row counts")


def estimate_rows_written(tables: Sequence[TableData]) -> int:
    """Approximate D1 rows written by a load into an empty DB (rows + index entries).

    Each secondary index costs one extra write per row: ``order_lines(order_id)``,
    ``products(product_id, product_name)`` and the API's covering index on ``orders``
    (``api/migrations/0002_api_indexes.sql``).
    """
    extra_index_writes = {"order_lines": 1, "products": 1, "orders": 1}
    return sum(len(t.rows) * (1 + extra_index_writes.get(t.name, 0)) for t in tables)


# --------------------------------------------------------------------------- pipeline


def export(
    processed_dir: Path = PROCESSED_DIR,
    output: Path = SEED_FILE,
    schema_path: Path = SCHEMA_FILE,
    only: Sequence[str] | None = None,
) -> Path:
    """Build, validate and write the seed file; return its path.

    ``only`` restricts the script to some tables (e.g. ``["insights"]``) so a small
    change can be reloaded without rewriting every row; their rows are replaced.
    """
    ensure_not_raw_dir(output)
    tables = load_all(read_schema(schema_path), processed_dir)
    metadata = dict(next(t for t in tables if t.name == "dataset_metadata").rows)
    if only:
        unknown = sorted(set(only) - set(TABLE_ORDER))
        if unknown:
            raise SchemaMismatchError(f"Unknown tables for --only: {unknown}")
        tables = [t for t in tables if t.name in set(only)]
    sql = build_seed_sql(tables, metadata.get("source_sha256", "unknown"))
    validate_seed(sql, tables, schema_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(sql.encode("utf-8"))
    for table in tables:
        logger.info("%-26s %6d rows", table.name, len(table.rows))
    logger.info(
        "Wrote %s (%.0f KB, ~%d D1 rows written on an empty DB)",
        output,
        len(sql.encode("utf-8")) / 1024,
        estimate_rows_written(tables),
    )
    return output


def main(argv: list[str] | None = None) -> None:
    """Command-line entry point."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--processed-dir", type=Path, default=PROCESSED_DIR)
    parser.add_argument("--output", type=Path, default=SEED_FILE)
    parser.add_argument("--schema", type=Path, default=SCHEMA_FILE)
    parser.add_argument(
        "--only",
        help="Comma-separated tables to export (e.g. insights); default: all tables",
    )
    args = parser.parse_args(argv)
    setup_logging()
    only = [name.strip() for name in args.only.split(",")] if args.only else None
    export(args.processed_dir, args.output, args.schema, only)


if __name__ == "__main__":
    main()
