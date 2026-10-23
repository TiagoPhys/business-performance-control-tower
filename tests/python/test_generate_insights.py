"""Tests for rule-based insight generation."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from analytics import generate_insights as gi
from analytics.config import ALL


@pytest.fixture
def frames(processed_dir: Path) -> dict[str, pd.DataFrame]:
    return gi.load_kpis(processed_dir)


def by_id(insights: list[gi.Insight]) -> dict[str, gi.Insight]:
    return {i.insight_id: i for i in insights}


def test_regional_insights(frames: dict[str, pd.DataFrame]) -> None:
    insights = by_id(gi.regional_insights(frames["kpi_summary"]))
    top = insights["region-top-profit-east"]
    assert "East generated $60 of profit" in top.body
    low = insights["region-lowest-margin-west"]
    # West margin -20% vs overall 2.5%: a 22.5 pp gap, above the warning threshold.
    assert low.severity == "warning"
    assert "22.5 percentage points" in low.body
    assert low.metric_value == pytest.approx(-0.2)


def test_negative_subcategories_sorted_by_loss(frames: dict[str, pd.DataFrame]) -> None:
    insights = gi.negative_subcategory_insights(frames["subcategory_performance"])
    assert [i.insight_id for i in insights] == [
        "subcategory-negative-profit-tables",
        "subcategory-negative-profit-art",
    ]
    assert insights[0].evidence["profit"] == pytest.approx(-30)
    assert "negative in 1 of 1 years" in insights[0].body


def test_high_sales_negative_profit_products() -> None:
    products_kpi = pd.DataFrame(
        {
            "order_year": [ALL] * 4 + ["2016"],
            "product_key": [1, 2, 3, 4, 1],
            "sales": [1000.0, 900.0, 100.0, 50.0, 1000.0],
            "profit": [-50.0, 30.0, -5.0, 2.0, -50.0],
            "avg_discount": [0.4, 0.0, 0.2, 0.0, 0.4],
        }
    )
    products = pd.DataFrame(
        {
            "product_key": [1, 2, 3, 4],
            "product_id": ["A", "B", "C", "D"],
            "product_name": ["Big Loser", "Big Winner", "Small Loser", "Small Winner"],
            "category": ["X"] * 4,
            "sub_category": ["Y"] * 4,
        }
    )
    flagged, threshold = gi.high_sales_loss_products(products_kpi, products)
    assert threshold == pytest.approx(925)  # 75th percentile of [50, 100, 900, 1000]
    assert flagged["product_name"].tolist() == ["Big Loser"]  # Small Loser is not high-sales

    [insight] = gi.high_sales_negative_profit_insight(products_kpi, products)
    assert insight.metric_value == 1
    assert insight.evidence["top_products"][0]["product_id"] == "A"


def test_no_high_sales_losses_gives_no_insight(frames: dict[str, pd.DataFrame]) -> None:
    # In the fixture the only top-quartile product (Chair A) is profitable.
    assert (
        gi.high_sales_negative_profit_insight(frames["product_performance"], frames["products"])
        == []
    )


def test_discount_insight_reports_association_with_caveat(frames: dict[str, pd.DataFrame]) -> None:
    [insight] = gi.discount_profit_insight(
        frames["discount_band_performance"], frames["order_lines"]
    )
    assert insight.evidence["no_discount_margin"] == pytest.approx(95 / 250)
    assert insight.evidence["high_discount_margin"] == pytest.approx(-70 / 500)
    assert insight.title == "Margins are lower on heavily discounted lines"
    # Office Supplies has no undiscounted lines, so only Furniture can be compared.
    assert "within 1 of 1 categories" in insight.body
    assert "association" in insight.caveat and "not a measured effect" in insight.caveat


def test_spearman_matches_rank_definition() -> None:
    x = pd.Series([0.0, 0.1, 0.2, 0.2, 0.5])
    assert gi.spearman(x, -x * 3) == pytest.approx(-1.0)
    assert gi.spearman(x, x**2) == pytest.approx(1.0)


@pytest.mark.parametrize(
    "text", ["Discounts drive losses", "Losses are due to discounts", "Discounting causes losses"]
)
def test_causal_language_is_rejected(text: str) -> None:
    insight = gi.Insight("x", "drivers", "t", "info", "Title", text, "m", 0.0, {})
    with pytest.raises(gi.CausalLanguageError):
        gi.assert_no_causal_language(insight)


def test_generated_text_has_no_causal_claims(frames: dict[str, pd.DataFrame]) -> None:
    for insight in gi.generate(frames):
        gi.assert_no_causal_language(insight)


def test_generate_orders_by_severity_and_is_deterministic(frames: dict[str, pd.DataFrame]) -> None:
    first = gi.to_frame(gi.generate(frames))
    second = gi.to_frame(gi.generate(frames))
    pd.testing.assert_frame_equal(first, second)
    severities = first["severity"].map(gi.SEVERITY_ORDER)
    assert severities.is_monotonic_increasing
    assert first["display_order"].tolist() == list(range(1, len(first) + 1))
    assert first["insight_id"].is_unique


@pytest.mark.parametrize(
    ("value", "expected"), [(-17725.48, "-$17,725"), (1234.5, "$1,234"), (0.0, "$0")]
)
def test_money_format(value: float, expected: str) -> None:
    assert gi.money(value) == expected


def test_pct_and_slug() -> None:
    assert gi.pct(0.12467) == "12.5%"
    assert gi.slug("Office Supplies") == "office-supplies"
