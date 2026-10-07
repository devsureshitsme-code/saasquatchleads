require('dotenv').config({ quiet: true });

const bool = (v, def) => (v === undefined || v === '' ? def : !['false', '0', 'no'].includes(String(v).toLowerCase()));

const config = {
  port: Number(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL || 'postgresql://saasquatchleads:saasquatchleads@localhost:5432/saasquatchleads',
  databaseSsl: bool(process.env.DATABASE_SSL, false),
  redisUrl: process.env.REDIS_URL || '',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
  checkWebsites: bool(process.env.CHECK_WEBSITES, true),
  validationConcurrency: Number(process.env.VALIDATION_CONCURRENCY) || 20,
  maxUploadRows: Number(process.env.MAX_UPLOAD_ROWS) || 5000,
};

module.exports = config;
