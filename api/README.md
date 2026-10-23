# API: Cloudflare Worker + D1

A read-only JSON API over the D1 database loaded by the analytics pipeline.

## Endpoints

All endpoints are `GET`. Responses use one envelope:

```jsonc
{ "data": { ... }, "meta": { "filters": { ... }, "source": "precomputed" | "live" } }  // 2xx
{ "error": { "code": "invalid_parameter", "message": "...", "details": { ... }, "requestId": "..." } }  // 4xx/5xx
```

| Endpoint | Extra parameters | Returns |
|---|---|---|
| `/api/health` | none | database status, dataset version (never cached) |
| `/api/meta` | none | the data's date range, the years covered and the filter allowlists (used by the frontend's filter bar) |
| `/api/overview` | filters | KPIs for the period, plus the previous period of the same length and the change |
| `/api/trends` | filters, `granularity` = `month` (default) \| `quarter` \| `year` | gap-free series of sales, profit, margin, orders, units and average order value |
| `/api/breakdowns` | filters, `dimension` (required) = `region` \| `segment` \| `category` \| `subcategory` | one row per member, with share of sales |
| `/api/products` | filters, `q` (case-insensitive substring of product name or ID), `sort` = `sales` (default) \| `profit` \| `profitMargin` \| `unitsSold` \| `orders` \| `averageDiscount` \| `name`, `order` = `asc` \| `desc` (default), `page` 1–1000, `pageSize` 1–50 (default 20) | a page of products (including the average line discount) plus pagination totals |
| `/api/operations` | filters | order-to-ship days (ship date − order date) overall and by ship mode, region, region × ship mode, plus the distribution. There is deliberately no on-time measure, because the data has no promised date. |
| `/api/insights` | `section` = `overview` \| `drivers` \| `products` \| `operations`, `severity` = `critical` \| `warning` \| `info` | the pipeline's ranked insights |
| `/api/data-quality` | none | check results, the first 100 row-level issues and dataset metadata |

### Filters

| Parameter | Values |
|---|---|
| `start`, `end` | `YYYY-MM-DD`, inclusive. They default to the first and last order date. |
| `region` | `Central`, `East`, `South`, `West` |
| `segment` | `Consumer`, `Corporate`, `Home Office` |
| `category` | `Furniture`, `Office Supplies`, `Technology` |
| `shipMode` | `First Class`, `Same Day`, `Second Class`, `Standard Class` |

How parameters are validated:
- Filter values are matched case-insensitively against fixed allowlists and returned in canonical form.
- Unknown, repeated or over-long (> 64 characters) parameters are rejected with `400`.
- An impossible date such as `2016-02-30`, or `start` after `end`, is also a `400`.

### KPI definitions

| KPI | Definition |
|---|---|
| Sales, Profit, Units sold | Σ over `order_lines` |
| Orders | count of rows in `orders` |
| Customers | distinct `customer_id` in `orders` |
| Average shipping days | mean of `orders.shipping_days`, counted once per order |
| Profit margin | Profit ÷ Sales; `null` when Sales is 0 |
| Average order value | Sales ÷ Orders; `null` when there are no orders |

How filters affect the counts:
- With a category filter, an order counts if it has at least one line in that category. This is a semi-join, so an order is never counted twice.
- In the category and sub-category breakdowns, an order counts once in each category it contains, so those order counts can add up to more than the total.
- Average shipping days is not reported per sub-category.

**Previous-period comparison:** the comparison covers the same number of days immediately before the period, so 2017 is compared with 2016-01-02 to 2016-12-31. It is returned only when that period lies within the data's coverage, which starts on the first day of the month of the first order. Otherwise `comparison` is `{ available: false, reason: "insufficient_history" }`. Percent changes are relative to |previous|, and margin changes are given in absolute points only.

## How queries stay cheap

The free tier allows 10 ms of CPU per request and 5M D1 rows read per day, so queries avoid full-table reads.

- **Pre-computed path** (`meta.source = "precomputed"`): when the period is all time or an exact calendar year and there is no `shipMode` filter, the Worker reads the pipeline's `kpi_*`, `subcategory_performance` and `product_performance` tables.
  - Each read is a primary-key lookup of one to a few rows.
  - Trends use `kpi_monthly` whenever the period is month-aligned.
- **Live path** (`meta.source = "live"`): any other request runs SQL over `orders` and `order_lines`. `/api/operations` always uses this path, reading only the covering index on `orders`.
  - Order-level measures are read from `orders` through the covering index `idx_orders_date_covering`.
  - Line measures join `order_lines` through `idx_order_lines_order`.
  - `products` is joined only for category filters or product dimensions.
  - Each request's statements go to D1 in a single `batch()` round trip.
- **Caching:** successful responses send `Cache-Control: public, max-age=300`.
- **Consistency:** `test/parity.test.ts` checks that both paths return the same numbers.

## Security

- **Read-only:** there are no write routes. Every method other than `GET`, `HEAD` and `OPTIONS` gets `405`.
- **SQL:** user values reach SQL only as bound parameters. SQL text, including sort columns, dimensions and time buckets, is built only from fixed fragments in the code.
- **CORS:** only origins listed in `ALLOWED_ORIGINS` (in `wrangler.jsonc`) receive `Access-Control-Allow-Origin`. `*.` matches exactly one subdomain level, for Pages preview URLs.
- **Errors:** responses never include SQL, stack traces or D1 messages. Database failures return `503 database_unavailable` and are logged server-side with the request ID.
- **Headers:** responses send `nosniff`, a restrictive CSP and `no-referrer`. Errors are never cached.

## Running locally

Prerequisites:
- Node 20+.
- The analytics pipeline has been run, so that `../generated/seed.sql` exists (see the root README).

```bash
cd api
npm ci
npm run db:migrate:local   # applies migrations/ to a local SQLite under .wrangler/
npm run db:seed:local      # loads ../generated/seed.sql
npm run dev                # http://localhost:8787
```

```bash
curl "http://localhost:8787/api/overview?start=2017-01-01&end=2017-12-31&region=West"
curl "http://localhost:8787/api/products?sort=profit&order=asc&pageSize=10"
```

## Tests

```bash
npm test           # Vitest inside the Workers runtime (@cloudflare/vitest-plugin) with a local D1
npm run typecheck
```

- **Test data:** the tests apply the real migrations and load `test/fixtures/seed.sql`, which the Python pipeline generates from the synthetic data in `tests/python/conftest.py`. Regenerate it after pipeline changes with `uv run python -m tests.python.build_api_fixture`. A pytest check fails if the fixture is stale.
- **What they cover:**
  - Totals for every endpoint.
  - Valid and invalid filters, including injection attempts.
  - Pagination limits.
  - CORS and read-only methods.
  - An empty database.
  - D1 failures (`503` with no leaked details).
  - Parity between the pre-computed and live paths.

## Deploying with Wrangler

1. Authenticate: `npx wrangler login`.
2. Create the database: run `npx wrangler d1 create bpct-db`, then copy the printed `database_id` into `wrangler.jsonc`.
3. Set `ALLOWED_ORIGINS` in `wrangler.jsonc` to the frontend origin(s), e.g. `https://bpct.pages.dev,https://*.bpct.pages.dev`. Then run `npm run cf-typegen`.
4. Create the remote schema and load the data:
   ```bash
   npm run db:migrate:remote
   npm run db:seed:remote     # ~46k rows written on an empty database
   ```
5. Deploy: `npm run deploy`. The Worker is served at `https://bpct-api.<your-subdomain>.workers.dev`.
6. Check it: `curl https://bpct-api.<your-subdomain>.workers.dev/api/health`. The returned `datasetVersion` should be the first 12 characters of `source_sha256` in `data/processed/dataset_metadata.json`.

**Reloading only the insights:** when only the pipeline's insights change, reload just that table (about 14 rows written):
```bash
uv run python -m analytics.generate_insights                      # from the project root
uv run python -m analytics.export_seed_sql --only insights --output generated/seed_insights.sql
cd api && npx wrangler d1 execute DB --remote --file ../generated/seed_insights.sql
```

**Reloading data:** a reload of a populated database writes about 92k rows, because the deletes count too. That is close to the free tier's 100k rows per day. A cheaper way to reload:
1. Run `wrangler d1 delete bpct-db`, then `d1 create` again, and update `database_id`.
2. Run the migrations and seed again.

Either way, reload at most once per day.

**Quotas:** if the free-tier limits are reached, requests fail; nothing is billed. The Cache API has no effect on `*.workers.dev`, so with edge caching unavailable, the pre-computed path is what keeps daily D1 reads low.
