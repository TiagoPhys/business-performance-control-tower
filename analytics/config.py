"""Shared paths, constants and logging setup for the analytics pipeline."""

from __future__ import annotations

import logging
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = PROJECT_ROOT / "data" / "raw"
RAW_FILE = RAW_DIR / "superstore.csv"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
GENERATED_DIR = PROJECT_ROOT / "generated"
SCHEMA_FILE = PROJECT_ROOT / "api" / "migrations" / "0001_schema.sql"
SEED_FILE = GENERATED_DIR / "seed.sql"

PIPELINE_VERSION = "0.1.0"

# Sentinel used for "all members" of a dimension in pre-aggregated tables.
ALL = "ALL"

# Decimal places used when writing floats, so outputs are byte-for-byte reproducible.
FLOAT_DECIMALS = 6

LOG_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"


def setup_logging(level: int = logging.INFO) -> None:
    """Configure root logging once for command-line runs."""
    logging.basicConfig(level=level, format=LOG_FORMAT)


def ensure_not_raw_dir(path: Path) -> None:
    """Refuse to write anywhere inside ``data/raw`` so the source file is never modified."""
    resolved = path.resolve()
    raw = RAW_DIR.resolve()
    if resolved == raw or raw in resolved.parents:
        raise PermissionError(f"Refusing to write inside the raw data directory: {resolved}")


def write_csv(df, path: Path) -> None:
    """Write a DataFrame as a deterministic CSV (fixed float precision, no index)."""
    ensure_not_raw_dir(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, float_format=f"%.{FLOAT_DECIMALS}f", lineterminator="\n")
