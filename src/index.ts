import { createApp } from './app';
import { config } from './config';
import { waitForDatabase } from './db/pool';
import { migrate } from './db/migrate';

async function main(): Promise<void> {
  console.log('Starting Usage Metering and Quota Service...');

  // Wait for database and run migrations
  await waitForDatabase();
  await migrate();

  const app = createApp();

  app.listen(config.port, () => {
    console.log(`Service is running on port ${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`Health check: http://localhost:${config.port}/health`);
  });
}

main().catch((err) => {
  console.error('Failed to start service:', err);
  process.exit(1);
});
