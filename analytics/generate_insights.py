"""Generate deterministic, rule-based insights from the KPI tables.

Rules cover regional performance, sub-categories with negative profit, high-sales
products that lose money, and the observed relationship between discount and
profit. Every insight is produced from fixed thresholds and stable ordering, so the
same input always yields byte-identical output. Wording describes associations
only; a guard rejects causal phrasing.

Output: ``data/processed/insights.csv``.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from analytics.calculate_kpis import PROCESSED_DTYPES
from analytics.config import ALL, PROCESSED_DIR, setup_logging, write_csv

logger = logging.getLogger(__name__)

REGION_MARGIN_GAP_WARNING = 0.03  # 3 percentage points below the overall margin
HIGH_SALES_QUANTILE = 0.75  # "high sales" = top quartile of product sales
HIGH_DISCOUNT_THRESHOLD = 0.2  # bands above 20% are compared with undiscounted lines
HIGH_DISCOUNT_BANDS = ("21-40%", "Over 40%")  # see calculate_kpis.DISCOUNT_BANDS
MAX_EVIDENCE_ITEMS = 10

REGIONAL_CAVEAT = (
    "Regional results combine differences in product mix, discount levels and customer "
    "segments. They describe what happened in the period, not why one region differs."
)
SUBCATEGORY_CAVEAT = (
    "Totals cover the full period and every region. They show where losses were recorded, "
    "not their cause; losses may be concentrated in a few orders or discount levels."
)
PRODUCT_CAVEAT = (
    "Most products have only a handful of orders, so one large discounted order can turn "
    "a product's total negative. Review the product's order lines before acting."
)

ASSOCIATION_CAVEAT = (
    "This is an observed association, not a measured effect: discount levels also vary "
    "with product, region and order mix, so the data alone cannot show how profit would "
    "change if discounts changed. A controlled pricing test would be needed for that."
)

# Affirmative causal phrasing is not allowed in generated text.
CAUSAL_PATTERN = re.compile(
    r"\b(cause[sd]?|causing|because of|due to|leads? to|led to|results? in|resulted in|"
    r"drive[sn]?|driving|thanks to)\b",
    re.IGNORECASE,
)

SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}


class CausalLanguageError(ValueError):
    """Raised when generated insight text makes a causal claim."""


@dataclass(frozen=True)
class Insight:
    """One generated insight; ``evidence`` holds the numbers behind the text."""

    insight_id: str
    section: str
    topic: str
    severity: str
    title: str
    body: str
    metric_name: str
    metric_value: float
    evidence: dict
    caveat: str = ""


# --------------------------------------------------------------------------- formatting


def money(value: float) -> str:
    """Format a currency amount, e.g. ``-17725.48`` -> ``'-$17,725'``."""
    sign = "-" if value < 0 else ""
    return f"{sign}${abs(value):,.0f}"


def pct(value: float, decimals: int = 1) -> str:
    """Format a ratio as a percentage, e.g. ``0.1247`` -> ``'12.5%'``."""
    return f"{value * 100:.{decimals}f}%"


def slug(text: str) -> str:
    """Stable identifier fragment, e.g. ``'Office Supplies'`` -> ``'office-supplies'``."""
    return re.sub(r"[^0-9a-z]+", "-", text.lower()).strip("-")


def rounded(value: float, decimals: int = 6) -> float:
    """Round for evidence payloads so JSON output is stable."""
    return float(round(float(value), decimals))


# --------------------------------------------------------------------------- loading


def load_kpis(processed_dir: Path = PROCESSED_DIR) -> dict[str, pd.DataFrame]:
    """Read the KPI tables and the product/line tables needed by the rules."""
    names = [
        "kpi_summary",
        "subcategory_performance",
        "product_performance",
        "discount_band_performance",
    ]
    frames: dict[str, pd.DataFrame] = {}
    for name in names:
        path = processed_dir / f"{name}.csv"
        if not path.exists():
            raise FileNotFoundError(
                f"{path} not found. Run `python -m analytics.calculate_kpis` first."
            )
        frames[name] = pd.read_csv(
            path, dtype={"order_year": "str"}, keep_default_na=False, na_values=[""]
        )
    for name in ("products", "order_lines"):
        frames[name] = pd.read_csv(processed_dir / f"{name}.csv", dtype=PROCESSED_DTYPES[name])
    return frames


def filter_all(df: pd.DataFrame, **fixed: str) -> pd.DataFrame:
    """Select rows where each given dimension equals the given value (usually ``ALL``)."""
    mask = pd.Series(True, index=df.index)
    for column, value in fixed.items():
        mask &= df[column] == value
    return df[mask]


# --------------------------------------------------------------------------- rules


def regional_insights(summary: pd.DataFrame) -> list[Insight]:
    """Highest-profit region and lowest-margin region, against the overall margin."""
    scope = filter_all(summary, order_year=ALL, segment=ALL, category=ALL)
    total = scope[scope["region"] == ALL].iloc[0]
    regions = scope[scope["region"] != ALL].copy()
    regions["sales_share"] = regions["sales"] / total["sales"]
    regions["profit_share"] = regions["profit"] / total["profit"]
    evidence = {
        "overall_margin": rounded(total["profit_margin"]),
        "regions": [
            {
                "region": r.region,
                "sales": rounded(r.sales, 2),
                "profit": rounded(r.profit, 2),
                "profit_margin": rounded(r.profit_margin),
                "sales_share": rounded(r.sales_share),
                "profit_share": rounded(r.profit_share),
            }
            for r in regions.sort_values("region").itertuples()
        ],
    }

    best = regions.sort_values(["profit", "region"], ascending=[False, True]).iloc[0]
    worst = regions.sort_values(["profit_margin", "region"]).iloc[0]
    gap = total["profit_margin"] - worst["profit_margin"]
    return [
        Insight(
            insight_id=f"region-top-profit-{slug(best['region'])}",
            section="drivers",
            topic="regional_performance",
            severity="info",
            title=f"{best['region']} contributes the most profit",
            body=(
                f"{best['region']} generated {money(best['profit'])} of profit, "
                f"{pct(best['profit_share'])} of the total, from {pct(best['sales_share'])} "
                f"of sales, at a {pct(best['profit_margin'])} margin "
                f"(overall {pct(total['profit_margin'])})."
            ),
            metric_name="profit",
            metric_value=rounded(best["profit"], 2),
            caveat=REGIONAL_CAVEAT,
            evidence=evidence,
        ),
        Insight(
            insight_id=f"region-lowest-margin-{slug(worst['region'])}",
            section="drivers",
            topic="regional_performance",
            severity="warning" if gap >= REGION_MARGIN_GAP_WARNING else "info",
            title=f"{worst['region']} has the lowest profit margin",
            body=(
                f"{worst['region']} earned a {pct(worst['profit_margin'])} margin, "
                f"{gap * 100:.1f} percentage points below the overall "
                f"{pct(total['profit_margin'])}. "
                f"It accounts for {pct(worst['sales_share'])} of sales but "
                f"{pct(worst['profit_share'])} of profit."
            ),
            metric_name="profit_margin",
            metric_value=rounded(worst["profit_margin"]),
            caveat=REGIONAL_CAVEAT,
            evidence=evidence,
        ),
    ]


def negative_subcategory_insights(subcategories: pd.DataFrame) -> list[Insight]:
    """One insight per sub-category with negative total profit, largest loss first."""
    scope = filter_all(subcategories, order_year=ALL)
    losing = scope[scope["profit"] < 0].sort_values(["profit", "sub_category"])
    insights = []
    for row in losing.itertuples():
        yearly = subcategories[
            (subcategories["sub_category"] == row.sub_category)
            & (subcategories["order_year"] != ALL)
        ].sort_values("order_year")
        loss_years = int((yearly["profit"] < 0).sum())
        insights.append(
            Insight(
                insight_id=f"subcategory-negative-profit-{slug(row.sub_category)}",
                section="products",
                topic="negative_profit_subcategory",
                severity="critical",
                title=f"{row.sub_category} lost money overall",
                body=(
                    f"{row.sub_category} ({row.category}) recorded {money(row.profit)} of "
                    f"profit on {money(row.sales)} of sales, a {pct(row.profit_margin)} margin, "
                    f"with "
                    f"{pct(row.loss_line_share)} of its order lines at a loss. Profit was negative "
                    f"in {loss_years} of {len(yearly)} years. Its average line discount was "
                    f"{pct(row.avg_discount)}."
                ),
                metric_name="profit",
                metric_value=rounded(row.profit, 2),
                caveat=SUBCATEGORY_CAVEAT,
                evidence={
                    "category": row.category,
                    "sales": rounded(row.sales, 2),
                    "profit": rounded(row.profit, 2),
                    "profit_margin": rounded(row.profit_margin),
                    "avg_discount": rounded(row.avg_discount),
                    "loss_line_share": rounded(row.loss_line_share),
                    "yearly_profit": {
                        y: rounded(p, 2)
                        for y, p in zip(yearly["order_year"], yearly["profit"], strict=True)
                    },
                },
            )
        )
    return insights


def high_sales_loss_products(
    products_kpi: pd.DataFrame, products: pd.DataFrame
) -> tuple[pd.DataFrame, float]:
    """Products in the top sales quartile (all years) whose total profit is negative."""
    scope = filter_all(products_kpi, order_year=ALL).merge(
        products, on="product_key", how="left", validate="one_to_one"
    )
    threshold = float(np.quantile(scope["sales"], HIGH_SALES_QUANTILE))
    flagged = scope[(scope["sales"] >= threshold) & (scope["profit"] < 0)]
    return flagged.sort_values(["sales", "product_key"], ascending=[False, True]), threshold


def high_sales_negative_profit_insight(
    products_kpi: pd.DataFrame, products: pd.DataFrame
) -> list[Insight]:
    """Summarise high-sales products that lose money."""
    flagged, threshold = high_sales_loss_products(products_kpi, products)
    if flagged.empty:
        return []
    top = flagged.iloc[0]
    return [
        Insight(
            insight_id="products-high-sales-negative-profit",
            section="products",
            topic="high_sales_negative_profit",
            severity="critical",
            title=f"{len(flagged)} high-sales products lose money",
            body=(
                f"{len(flagged)} products in the top quartile of sales (at least "
                f"{money(threshold)} each) had negative profit, together "
                f"{money(flagged['profit'].sum())} "
                f"on {money(flagged['sales'].sum())} of sales. The largest by sales is "
                f'"{top["product_name"]}" ({top["sub_category"]}): {money(top["sales"])} of sales '
                f"and {money(top['profit'])} of profit."
            ),
            metric_name="products_flagged",
            metric_value=float(len(flagged)),
            caveat=PRODUCT_CAVEAT,
            evidence={
                "sales_threshold": rounded(threshold, 2),
                "quantile": HIGH_SALES_QUANTILE,
                "total_sales": rounded(flagged["sales"].sum(), 2),
                "total_profit": rounded(flagged["profit"].sum(), 2),
                "top_products": [
                    {
                        "product_key": int(r.product_key),
                        "product_id": r.product_id,
                        "product_name": r.product_name,
                        "sub_category": r.sub_category,
                        "sales": rounded(r.sales, 2),
                        "profit": rounded(r.profit, 2),
                        "avg_discount": rounded(r.avg_discount),
                    }
                    for r in flagged.head(MAX_EVIDENCE_ITEMS).itertuples()
                ],
            },
        )
    ]


def spearman(x: pd.Series, y: pd.Series) -> float:
    """Spearman rank correlation: Pearson correlation of average ranks (ties averaged)."""
    return float(x.rank(method="average").corr(y.rank(method="average"), method="pearson"))


def combined_margin(bands: pd.DataFrame) -> float:
    """Profit / sales across a set of discount-band rows."""
    sales = bands["sales"].sum()
    return float(bands["profit"].sum() / sales) if sales else float("nan")


def discount_comparison(bands: pd.DataFrame) -> tuple[float, float]:
    """Margin of undiscounted lines and of lines discounted above the threshold."""
    none = bands[bands["discount_band"] == "No discount"]
    high = bands[bands["discount_band"].isin(HIGH_DISCOUNT_BANDS)]
    return combined_margin(none), combined_margin(high)


def discount_profit_insight(bands_kpi: pd.DataFrame, lines: pd.DataFrame) -> list[Insight]:
    """Describe how margin varies with discount, overall and within each category."""
    overall = filter_all(bands_kpi, order_year=ALL, category=ALL).sort_values("band_order")
    none_margin, high_margin = discount_comparison(overall)
    rho = spearman(lines["discount"], lines["profit"] / lines["sales"])

    per_category = {}
    for category, group in filter_all(bands_kpi, order_year=ALL).groupby("category", sort=True):
        if category == ALL:
            continue
        cat_none, cat_high = discount_comparison(group)
        if math.isnan(cat_none) or math.isnan(cat_high):
            continue  # category lacks one side of the comparison
        per_category[category] = {
            "no_discount_margin": rounded(cat_none),
            "high_discount_margin": rounded(cat_high),
        }
    holds = sum(
        1 for v in per_category.values() if v["high_discount_margin"] < v["no_discount_margin"]
    )
    direction = "lower" if high_margin < none_margin else "higher"
    return [
        Insight(
            insight_id="discount-profit-association",
            section="drivers",
            topic="discount_profit_pattern",
            severity="warning" if high_margin < 0 else "info",
            title=f"Margins are {direction} on heavily discounted lines",
            body=(
                f"Order lines with discounts above {pct(HIGH_DISCOUNT_THRESHOLD, 0)} have a "
                f"combined margin of {pct(high_margin)}, against {pct(none_margin)} for "
                f"undiscounted lines. "
                f"Across all lines, the rank correlation between discount and line margin is "
                f"{rho:.2f} (Spearman). The same direction appears within {holds} of "
                f"{len(per_category)} categories with both undiscounted and heavily "
                f"discounted lines."
            ),
            metric_name="spearman_discount_margin",
            metric_value=rounded(rho),
            evidence={
                "threshold": HIGH_DISCOUNT_THRESHOLD,
                "no_discount_margin": rounded(none_margin),
                "high_discount_margin": rounded(high_margin),
                "spearman_rho": rounded(rho),
                "bands": [
                    {
                        "discount_band": r.discount_band,
                        "line_count": int(r.line_count),
                        "sales": rounded(r.sales, 2),
                        "profit": rounded(r.profit, 2),
                        "profit_margin": rounded(r.profit_margin),
                        "loss_line_share": rounded(r.loss_line_share),
                    }
                    for r in overall.itertuples()
                ],
                "by_category": per_category,
            },
            caveat=ASSOCIATION_CAVEAT,
        )
    ]


# --------------------------------------------------------------------------- pipeline


def assert_no_causal_language(insight: Insight) -> None:
    """Reject titles or bodies that state a causal relationship."""
    for text in (insight.title, insight.body):
        match = CAUSAL_PATTERN.search(text)
        if match:
            raise CausalLanguageError(f"{insight.insight_id}: causal phrase {match.group(0)!r}")


def generate(frames: dict[str, pd.DataFrame]) -> list[Insight]:
    """Run every rule and return insights in a stable order."""
    insights = [
        *regional_insights(frames["kpi_summary"]),
        *negative_subcategory_insights(frames["subcategory_performance"]),
        *high_sales_negative_profit_insight(frames["product_performance"], frames["products"]),
        *discount_profit_insight(frames["discount_band_performance"], frames["order_lines"]),
    ]
    ids = [i.insight_id for i in insights]
    if len(ids) != len(set(ids)):
        raise ValueError(f"Duplicate insight ids: {ids}")
    for insight in insights:
        assert_no_causal_language(insight)
    # Severity first; within a severity, keep rule order (each rule sorts its own output).
    return [
        insight
        for _, insight in sorted(
            enumerate(insights), key=lambda pair: (SEVERITY_ORDER[pair[1].severity], pair[0])
        )
    ]


def to_frame(insights: list[Insight]) -> pd.DataFrame:
    """Flatten insights into a table with a ``display_order`` and JSON ``evidence``."""
    rows = []
    for position, insight in enumerate(insights, start=1):
        row = asdict(insight)
        row["evidence_json"] = json.dumps(row.pop("evidence"), sort_keys=True, ensure_ascii=False)
        rows.append({"display_order": position, **row})
    columns = [
        "insight_id",
        "display_order",
        "section",
        "topic",
        "severity",
        "title",
        "body",
        "metric_name",
        "metric_value",
        "caveat",
        "evidence_json",
    ]
    return pd.DataFrame(rows, columns=columns)


def main(argv: list[str] | None = None) -> None:
    """Command-line entry point."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--processed-dir", type=Path, default=PROCESSED_DIR)
    args = parser.parse_args(argv)
    setup_logging()
    insights = generate(load_kpis(args.processed_dir))
    for insight in insights:
        logger.info("[%s] %s", insight.severity, insight.title)
    write_csv(to_frame(insights), args.processed_dir / "insights.csv")
    logger.info("Wrote %d insights", len(insights))


if __name__ == "__main__":
    main()
