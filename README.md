# Business Performance Control Tower

A portfolio analytics product built on the Sample Superstore Sales dataset.

| Layer | Stack |
|---|---|
| Data preparation & analysis | Python, pandas, DuckDB, pytest |
| API | Cloudflare Workers (TypeScript) + D1 (SQL) |
| Frontend | React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts on Cloudflare Pages |

Python prepares, validates and analyses the data and produces deterministic insights.
The API runs indexed SQL over pre-computed tables in D1, and React presents the results.

## Analytics pipeline

```
data/raw/superstore.csv  ->  prepare_data  ->  calculate_kpis  ->  generate_insights  ->  export_seed_sql
   (never modified)          data/processed/*.csv  (gitignored)                         generated/seed.sql
```

| Stage | What it does |
|---|---|
| `analytics/prepare_data.py` | Reads the CSV as text, normalises headers, parses dates (US `m/d/YYYY` or ISO, strictly), converts measures to numbers, runs data quality checks, and splits the data into `orders`, `order_lines`, `products` and `customers`. |
| `analytics/calculate_kpis.py` | Builds the KPI tables with DuckDB, then reconciles every table against totals computed independently with pandas. |
| `analytics/generate_insights.py` | Applies fixed rules to the KPI tables and writes ranked insights. |
| `analytics/export_seed_sql.py` | Writes a D1 load script whose columns are taken from `api/migrations/0001_schema.sql`, then test-loads it into SQLite. |

### Running it

Requirements: [uv](https://docs.astral.sh/uv/). It installs Python 3.13 and the dependencies from `uv.lock`.

1. Download the Sample Superstore CSV and save it as `data/raw/superstore.csv`. The `data/raw/` folder is gitignored; the file must not be committed or edited.
2. Install and run:

```bash
uv sync
uv run python -m analytics.prepare_data
uv run python -m analytics.calculate_kpis
uv run python -m analytics.generate_insights
uv run python -m analytics.export_seed_sql
```

3. Test and lint:

```bash
uv run pytest            # unit tests use a synthetic fixture; real-data checks run only if the CSV exists
uv run ruff check analytics tests
```

Each stage takes `--help`. Paths can be overridden, for example `prepare_data --input other.csv --output-dir /tmp/out`.
The pipeline refuses to write anywhere inside `data/raw/`.

### Loading into D1

```bash
cd api
npx wrangler d1 migrations apply <DB_NAME> --local           # or --remote
npx wrangler d1 execute <DB_NAME> --local --file ../generated/seed.sql
```

The seed can be re-run safely: it deletes existing rows (child tables first) and contains no `BEGIN`/`COMMIT`, which D1 rejects in SQL files.
INSERTs are batched to at most 250 rows and 90 KB per statement, under D1's 100 KB statement limit.

A load into an empty database writes about 41k rows. Deleted rows also count, so reloading a populated database costs about twice that.
The D1 free tier allows 100k rows written per day: **reload at most once a day.**

## KPI definitions

All KPIs come from order lines after data quality exclusions. `ALL` in a dimension column means "every member".

| KPI | Definition |
|---|---|
| Sales | Σ `sales` (Superstore sales are already net of discount) |
| Profit | Σ `profit` |
| Profit margin | Profit ÷ Sales |
| Orders | Count of distinct `order_id` |
| Customers | Count of distinct `customer_id` |
| Units | Σ `quantity` |
| Average order value | Sales ÷ Orders |
| Average discount | Mean of line `discount` (unweighted) |
| Loss line share | Share of order lines with `profit < 0` |
| Shipping days | `ship_date − order_date` in days, averaged **once per order**. No promised delivery date exists in the data, so none is assumed. |
| Sales / profit YoY | (current − prior year) ÷ prior year, for the same filters. Profit growth divides by \|prior\| because profit can be negative. |

Orders, customers and shipping days are computed separately for every filter combination, never summed.
One order can span several categories, so per-category order counts add up to more than the total.

**Discount bands:** No discount (0), 1–20%, 21–40%, Over 40%.

### KPI tables (all in D1)

| Table | Grain |
|---|---|
| `kpi_summary` | year × region × segment × category (each can be `ALL`), with prior-year values |
| `kpi_monthly` | month × region × segment × category |
| `subcategory_performance` | year × sub-category |
| `product_performance` | year × product |
| `discount_band_performance` | year × category × discount band |
| `shipping_performance` | year × region × ship mode (order-level statistics) |

Every table is checked before it is written:
- The grand total must match line-level sales, profit, units, orders and customers.
- Within each dimension, the members must add up to the total for additive measures.
- Orders must add up across year, region and segment, because each order belongs to exactly one of each.

## Data quality

Each check reports `pass`, `warn` (found and handled, rows kept) or `fail` (affected rows excluded). Findings are written to `data_quality_checks.csv`, and row-level detail goes to `data_quality_issues.csv`. Issues identify rows by Row ID only.

| Group | Checks |
|---|---|
| Duplicates | repeated Row ID; identical line content under a different Row ID |
| Missing values | blank key, date or measure (excluded); blank descriptive field (kept) |
| Dates | unparseable or impossible dates; ship date before order date |
| Types & ranges | non-numeric measures, non-integer quantity, discount outside 0–1, non-positive sales or quantity |
| Consistency | order-level attributes that differ within an order; customer segment; Product ID reused for different names |
| Orphans | lines without an order or product; orders without a customer; orders without lines |

Findings on the current file (csvbase export, 9,994 rows):
- No rows are excluded.
- One line duplicates another apart from its Row ID (Row ID 3407). It is kept, because it may be a genuine repeat purchase.
- 449 lines have 4-digit postal codes. Spreadsheet exports drop the leading zero of New England codes, so they are zero-padded; the original is kept in `postal_code_raw`.
- 32 Product IDs map to more than one product name, so products use a surrogate `product_key` over (Product ID, Product Name).
- The export adds a `csvbase_row_id` column and a byte-order mark inside the `Row ID` header. Both are handled.

**Privacy:** customer names are dropped during preparation and appear in no output, log or SQL file.

## Insights

The insights come from fixed rules and thresholds, with stable ordering and no timestamps, so the same input always produces the same output.

| Rule | Output |
|---|---|
| Regional performance | Region with the most profit. Region with the lowest margin: a warning when it is 3+ percentage points below the overall margin. |
| Negative-profit sub-categories | One insight per losing sub-category, largest loss first |
| High-sales / negative-profit products | Products in the top sales quartile with negative total profit |
| Discount vs profit | Margin of lines discounted above 20% vs undiscounted lines, Spearman correlation, and whether the pattern holds within each category |

Insights describe **associations, not causes**. The discount insight carries an explicit caveat.
A guard rejects any generated text containing causal phrases such as "causes", "due to" or "drives".

## Repository layout

```
analytics/        Python pipeline (config.py holds shared paths and constants)
tests/python/     pytest suite (synthetic fixture in conftest.py)
api/              Cloudflare Worker + D1 migrations
frontend/         React app
data/raw/         source CSV (gitignored)
data/processed/   pipeline outputs (gitignored)
generated/        D1 seed script (gitignored: it contains the full row-level dataset)
```
