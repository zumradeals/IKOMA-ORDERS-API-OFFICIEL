import { promises as fs } from 'node:fs';
import path from 'node:path';

const migrationsDir = path.resolve('migrations');
const journalPath = path.join(migrationsDir, 'meta', '_journal.json');

async function main() {
  const [journalRaw, migrationsEntries] = await Promise.all([
    fs.readFile(journalPath, 'utf8'),
    fs.readdir(migrationsDir, { withFileTypes: true }),
  ]);

  const journal = JSON.parse(journalRaw);
  const journalTags = new Set((journal.entries || []).map((entry) => entry.tag));

  const sqlTags = migrationsEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name.replace(/\.sql$/, ''));

  const sqlTagSet = new Set(sqlTags);

  const missingSql = Array.from(journalTags).filter((tag) => !sqlTagSet.has(tag));
  const missingJournal = sqlTags.filter((tag) => !journalTags.has(tag));

  if (missingSql.length || missingJournal.length) {
    console.error('❌ Migration journal mismatch detected.');
    if (missingSql.length) {
      console.error(`- Journal entries without SQL file: ${missingSql.join(', ')}`);
    }
    if (missingJournal.length) {
      console.error(`- SQL files missing from journal: ${missingJournal.join(', ')}`);
    }
    process.exit(1);
  }

  console.log('✅ Migration journal matches SQL files.');
}

main().catch((error) => {
  console.error('❌ Failed to verify migrations');
  console.error(error);
  process.exit(1);
});
