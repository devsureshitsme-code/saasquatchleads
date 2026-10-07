const config = require('./config');
const { createApp } = require('./app');
const { migrate } = require('./db/migrate');
const { pool } = require('./db');

async function main() {
  // Schema is idempotent, so applying it on boot keeps deploys one-step.
  await migrate();
  await require('./db/repo').clearInterruptedAiPasses();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`SaaSquatchLeads API listening on http://localhost:${config.port}`);
  });

  const shutdown = () => {
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
