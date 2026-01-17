import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import * as dotenv from 'dotenv';
import { eq } from 'drizzle-orm';

dotenv.config();

async function main() {
  if (process.env.SEED !== 'true') {
    console.log('🌱 Seeding skipped (SEED != true)');
    return;
  }

  console.log('🌱 Seeding database...');
  
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });
  const db = drizzle(pool, { schema });

  // Seed Playbooks
  const basePlaybooks = [
    {
      key: 'system-setup',
      name: 'System Setup',
      category: 'BASE' as const,
      riskLevel: 'LOW' as const,
      schemaVersion: '1.0',
      spec: { steps: [{ name: 'update', action: 'apt-get update' }] },
      isPublished: 'true',
    },
  ];

  for (const pb of basePlaybooks) {
    const [existing] = await db.select().from(schema.playbooks).where(eq(schema.playbooks.key, pb.key)).limit(1);
    if (!existing) {
      await db.insert(schema.playbooks).values(pb);
      console.log(`✅ Seeded playbook: ${pb.key}`);
    } else {
      console.log(`ℹ️ Playbook ${pb.key} already exists, skipping.`);
    }
  }

  console.log('✅ Seeding completed.');
  await pool.end();
}

main().catch((err) => {
  console.error('❌ Seeding failed');
  console.error(err);
  process.exit(1);
});
