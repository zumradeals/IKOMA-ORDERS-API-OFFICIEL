CREATE INDEX IF NOT EXISTS "claim_next_idx" ON "orders" ("status", "runner_id", "created_at");
