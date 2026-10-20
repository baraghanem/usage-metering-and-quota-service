import * as fs from 'fs';
import * as path from 'path';
import { pool, waitForDatabase } from './pool';

async function migrate(): Promise<void> {
  await waitForDatabase();

  const candidateDirs = [
    path.join(__dirname, 'migrations'),
    path.join(__dirname, '../../src/db/migrations'),
    path.join(process.cwd(), 'src/db/migrations'),
    path.join(process.cwd(), 'dist/db/migrations'),
  ];

  let migrationsDir = candidateDirs.find((dir) => fs.existsSync(dir));
  if (!migrationsDir) {
    throw new Error(`Could not find migrations directory in any of: ${candidateDirs.join(', ')}`);
  }

  const files = fs.readdirSync(migrationsDir).sort();

  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');
    console.log(`Running migration: ${file}`);
    await pool.query(sql);
    console.log(`Completed migration: ${file}`);
  }

  console.log('All migrations completed.');
}

// Run if called directly
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

export { migrate };
