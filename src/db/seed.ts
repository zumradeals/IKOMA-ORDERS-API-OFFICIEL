import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  if (process.env.SEED !== 'true') {
    console.log('🌱 Seeding skipped (SEED != true)');
    return;
  }

  console.log('🌱 Seeding database (debug-only)...');
  console.log('ℹ️ Base playbooks are provisioned via migrations (see 0004_seed_playbooks.sql).');
  console.log('ℹ️ Avoid manual seeding in pipelines; use db:migrate instead.');

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });
  void drizzle(pool);
  console.log('✅ Seeding completed (no-op).');
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Seeding failed');
  console.error(err);
  process.exit(1);
});
