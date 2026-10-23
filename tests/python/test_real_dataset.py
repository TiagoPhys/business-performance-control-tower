"""Checks against the real Superstore file; skipped when it is absent (e.g. in CI)."""

from __future__ import annotations

import pytest

from analytics import calculate_kpis, prepare_data
from analytics.config import ALL, RAW_FILE

pytestmark = pytest.mark.skipif(not RAW_FILE.exists(), reason="data/raw/superstore.csv not present")


@pytest.fixture(scope="module")
def prepared() -> prepare_data.PreparedData:
    return prepare_data.prepare(RAW_FILE)


def test_known_superstore_shape(prepared: prepare_data.PreparedData) -> None:
    assert len(prepared.order_lines) == 9994
    assert len(prepared.orders) == 5009
    assert len(prepared.customers) == 793
    assert prepared.order_lines["sales"].sum() == pytest.approx(2297200.8603, abs=0.01)
    assert prepared.order_lines["profit"].sum() == pytest.approx(286397.0217, abs=0.01)


def test_no_blocking_quality_failures(prepared: prepare_data.PreparedData) -> None:
    failed = prepared.quality_checks[prepared.quality_checks["status"] == "fail"]
    assert failed.empty, failed[["check_id", "affected_rows"]].to_dict("records")


def test_kpis_reconcile_on_real_data(prepared: prepare_data.PreparedData, tmp_path_factory) -> None:
    out = tmp_path_factory.mktemp("processed")
    prepare_data.write_outputs(prepared, out)
    tables = calculate_kpis.calculate(calculate_kpis.load_processed(out))  # validates internally
    summary = tables["kpi_summary"]
    grand = summary[(summary[["order_year", "region", "segment", "category"]] == ALL).all(axis=1)]
    assert int(grand["orders"].iloc[0]) == 5009
