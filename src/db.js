import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  ssl: config.isProd && process.env.PGSSL !== 'disable' ? { rejectUnauthorized: false } : false,
});

export function query(text, params) {
  return pool.query(text, params);
}

// Run a function inside a transaction.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function migrate() {
  const sql = await readFile(join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  // eslint-disable-next-line no-console
  console.log('✓ Migrations applied');
}

// CLI: node src/db.js migrate
if (process.argv[2] === 'migrate') {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('Migration failed:', e.message);
      process.exit(1);
    });
}
