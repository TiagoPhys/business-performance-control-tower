-- Business Performance Control Tower: initial D1 schema.
--
-- Row-level tables come from analytics/prepare_data.py; pre-aggregated tables come
-- from analytics/calculate_kpis.py and generate_insights.py. Data is loaded with
-- generated/seed.sql (analytics/export_seed_sql.py).
--
-- In pre-aggregated tables the value 'ALL' in a dimension column means "all members",
-- so any filter combination is a primary-key lookup. Those tables are WITHOUT ROWID
-- so the primary key is the table itself: no separate index rows to write, which
-- keeps a full load well inside D1's free-tier daily write quota.

-- --------------------------------------------------------------------- metadata

CREATE TABLE dataset_metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) WITHOUT ROWID;

-- --------------------------------------------------------------------- row-level

CREATE TABLE customers (
    customer_id TEXT PRIMARY KEY,
    segment     TEXT
) WITHOUT ROWID;

-- Superstore reuses some Product IDs for different names, so the key is surrogate.
CREATE TABLE products (
    product_key  INTEGER PRIMARY KEY,
    product_id   TEXT NOT NULL,
    product_name TEXT NOT NULL,
    category     TEXT,
    sub_category TEXT,
    UNIQUE (product_id, product_name)
);

CREATE TABLE orders (
    order_id        TEXT PRIMARY KEY,
    order_date      TEXT NOT NULL CHECK (order_date = date(order_date)),
    ship_date       TEXT NOT NULL CHECK (ship_date = date(ship_date)),
    ship_mode       TEXT,
    customer_id     TEXT NOT NULL REFERENCES customers (customer_id),
    segment         TEXT,
    country         TEXT,
    city            TEXT,
    state           TEXT,
    postal_code     TEXT,
    postal_code_raw TEXT,
    region          TEXT,
    shipping_days   INTEGER NOT NULL CHECK (shipping_days >= 0),
    order_year      INTEGER NOT NULL,
    order_month     TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE order_lines (
    row_id      INTEGER PRIMARY KEY,
    order_id    TEXT NOT NULL REFERENCES orders (order_id),
    product_key INTEGER NOT NULL REFERENCES products (product_key),
    sales       REAL NOT NULL CHECK (sales > 0),
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    discount    REAL NOT NULL CHECK (discount BETWEEN 0 AND 1),
    profit      REAL NOT NULL
);

CREATE INDEX idx_order_lines_order ON order_lines (order_id);

-- --------------------------------------------------------------------- pre-aggregated

CREATE TABLE kpi_summary (
    order_year          TEXT NOT NULL,
    region              TEXT NOT NULL,
    segment             TEXT NOT NULL,
    category            TEXT NOT NULL,
    sales               REAL NOT NULL,
    profit              REAL NOT NULL,
    units               INTEGER NOT NULL,
    line_count          INTEGER NOT NULL,
    orders              INTEGER NOT NULL,
    customers           INTEGER NOT NULL,
    avg_discount        REAL,
    loss_line_share     REAL,
    avg_shipping_days   REAL,
    profit_margin       REAL,
    average_order_value REAL,
    prior_sales         REAL,
    prior_profit        REAL,
    sales_yoy           REAL,
    profit_yoy          REAL,
    PRIMARY KEY (order_year, region, segment, category)
) WITHOUT ROWID;

CREATE TABLE kpi_monthly (
    order_month         TEXT NOT NULL,
    region              TEXT NOT NULL,
    segment             TEXT NOT NULL,
    category            TEXT NOT NULL,
    sales               REAL NOT NULL,
    profit              REAL NOT NULL,
    units               INTEGER NOT NULL,
    orders              INTEGER NOT NULL,
    profit_margin       REAL,
    average_order_value REAL,
    PRIMARY KEY (region, segment, category, order_month)
) WITHOUT ROWID;

CREATE TABLE subcategory_performance (
    order_year          TEXT NOT NULL,
    category            TEXT NOT NULL,
    sub_category        TEXT NOT NULL,
    sales               REAL NOT NULL,
    profit              REAL NOT NULL,
    units               INTEGER NOT NULL,
    line_count          INTEGER NOT NULL,
    orders              INTEGER NOT NULL,
    customers           INTEGER NOT NULL,
    avg_discount        REAL,
    loss_line_share     REAL,
    profit_margin       REAL,
    average_order_value REAL,
    PRIMARY KEY (order_year, category, sub_category)
) WITHOUT ROWID;

CREATE TABLE product_performance (
    order_year    TEXT NOT NULL,
    product_key   INTEGER NOT NULL REFERENCES products (product_key),
    sales         REAL NOT NULL,
    profit        REAL NOT NULL,
    units         INTEGER NOT NULL,
    line_count    INTEGER NOT NULL,
    orders        INTEGER NOT NULL,
    avg_discount  REAL,
    profit_margin REAL,
    PRIMARY KEY (order_year, product_key)
) WITHOUT ROWID;

CREATE TABLE discount_band_performance (
    order_year      TEXT NOT NULL,
    category        TEXT NOT NULL,
    discount_band   TEXT NOT NULL,
    band_order      INTEGER NOT NULL,
    sales           REAL NOT NULL,
    profit          REAL NOT NULL,
    line_count      INTEGER NOT NULL,
    avg_discount    REAL,
    loss_line_share REAL,
    profit_margin   REAL,
    PRIMARY KEY (order_year, category, band_order)
) WITHOUT ROWID;

CREATE TABLE shipping_performance (
    order_year           TEXT NOT NULL,
    region               TEXT NOT NULL,
    ship_mode            TEXT NOT NULL,
    shipped_orders       INTEGER NOT NULL,
    avg_shipping_days    REAL,
    median_shipping_days REAL,
    min_shipping_days    INTEGER,
    max_shipping_days    INTEGER,
    PRIMARY KEY (order_year, region, ship_mode)
) WITHOUT ROWID;

-- --------------------------------------------------------------------- insights & quality

CREATE TABLE insights (
    insight_id    TEXT PRIMARY KEY,
    display_order INTEGER NOT NULL UNIQUE,
    section       TEXT NOT NULL,
    topic         TEXT NOT NULL,
    severity      TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    metric_name   TEXT,
    metric_value  REAL,
    caveat        TEXT,
    evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json))
) WITHOUT ROWID;

CREATE TABLE data_quality_checks (
    check_id      TEXT PRIMARY KEY,
    check_group   TEXT NOT NULL,
    description   TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('pass', 'warn', 'fail')),
    affected_rows INTEGER NOT NULL,
    details       TEXT
) WITHOUT ROWID;

-- Row-level findings, identified by the source Row ID only (no customer data).
CREATE TABLE data_quality_issues (
    issue_id    INTEGER PRIMARY KEY,
    check_id    TEXT NOT NULL REFERENCES data_quality_checks (check_id),
    row_id      TEXT NOT NULL,
    column_name TEXT NOT NULL,
    raw_value   TEXT
);
