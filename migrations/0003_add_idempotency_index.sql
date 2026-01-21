CREATE UNIQUE INDEX IF NOT EXISTS "orders_idempotency_key_unique" ON "orders" USING btree ("idempotency_key");
