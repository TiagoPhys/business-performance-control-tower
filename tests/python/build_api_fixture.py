"""Build ``api/test/fixtures/seed.sql`` by running the real pipeline on the synthetic data.

The API tests load this seed, so they exercise exactly what the pipeline produces.
Regenerate after changing the pipeline or the synthetic data:

    uv run python -m tests.python.build_api_fixture
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from analytics import calculate_kpis, export_seed_sql, generate_insights, prepare_data
from analytics.config import PROJECT_ROOT, setup_logging, write_csv
from tests.python.conftest import make_rows, write_raw

API_FIXTURE = PROJECT_ROOT / "api" / "test" / "fixtures" / "seed.sql"


def build(output: Path = API_FIXTURE) -> Path:
    """Run every pipeline stage on the synthetic rows and export the seed to ``output``."""
    with tempfile.TemporaryDirectory() as tmp:
        raw = write_raw(Path(tmp) / "raw" / "superstore.csv", make_rows())
        processed = Path(tmp) / "processed"
        prepare_data.write_outputs(prepare_data.prepare(raw), processed)
        tables = calculate_kpis.calculate(calculate_kpis.load_processed(processed))
        calculate_kpis.write_outputs(tables, processed)
        insights = generate_insights.generate(generate_insights.load_kpis(processed))
        write_csv(generate_insights.to_frame(insights), processed / "insights.csv")
        return export_seed_sql.export(processed, output)


if __name__ == "__main__":
    setup_logging()
    print(f"Wrote {build()}")
