-- Indexes for the API's live queries (arbitrary date ranges and ship-mode filters).
--
-- Covering index on orders: order-level aggregates (count, distinct customers,
-- average shipping days) filtered by date range and order attributes are answered
-- from the index alone. One index costs one extra written row per order on load.
CREATE INDEX idx_orders_date_covering
    ON orders (order_date, region, segment, ship_mode, customer_id, shipping_days);
