import { Pool, PoolConfig } from 'pg';
import { config } from '../config';

const poolConfig: PoolConfig = {
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.database,
  max: config.database.maxConnections,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

/**
 * Wait for the database to be ready (useful during container startup).
 */
export async function waitForDatabase(
  maxRetries = 30,
  delayMs = 2000
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      console.log('Database connection established.');
      return;
    } catch (err) {
      console.log(
        `Waiting for database... (attempt ${i + 1}/${maxRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Could not connect to database after maximum retries.');
}
