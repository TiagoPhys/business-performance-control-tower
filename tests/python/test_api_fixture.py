"""The API test seed must match what the pipeline currently produces."""

from __future__ import annotations

from pathlib import Path

from tests.python.build_api_fixture import API_FIXTURE, build


def test_api_fixture_is_up_to_date(tmp_path: Path) -> None:
    fresh = build(tmp_path / "seed.sql").read_bytes()
    hint = "Run `uv run python -m tests.python.build_api_fixture`."
    assert API_FIXTURE.exists(), hint
    assert API_FIXTURE.read_bytes() == fresh, f"api/test/fixtures/seed.sql is stale. {hint}"
