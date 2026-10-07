const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { ZodError } = require('zod');
const config = require('./config');
const { query } = require('./db');
const { cache } = require('./lib/cache');
const uploadsRouter = require('./routes/uploads');
const aiRouter = require('./routes/ai');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigin.includes('*') || config.corsOrigin.includes(origin)),
      exposedHeaders: ['content-disposition'],
    }),
  );
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

  // Uploads, searches and AI calls hit the network; keep a single client from hammering them.
  const heavyLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
  app.use('/api/uploads', (req, res, next) => (req.method === 'POST' ? heavyLimiter(req, res, next) : next()));
  app.use('/api/search', heavyLimiter);
  app.use('/api/ai', heavyLimiter);
  app.use('/api/leads', (req, res, next) => (req.method === 'POST' ? heavyLimiter(req, res, next) : next()));

  app.get('/api/health', async (_req, res) => {
    let db = 'ok';
    try {
      await query('SELECT 1');
    } catch (err) {
      db = `error: ${err.message}`;
    }
    res.json({
      ok: db === 'ok',
      db,
      cache: cache.kind,
      checkWebsites: config.checkWebsites,
      ai: require('./services/aiClient').info(),
      googlePlaces: !!process.env.GOOGLE_PLACES_API_KEY,
    });
  });

  app.use('/api', uploadsRouter);
  app.use('/api', aiRouter);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const field = first && first.path.length ? `${first.path.join('.')}: ` : '';
      return res.status(400).json({ error: first ? `${field}${first.message}` : 'Invalid request', details: err.issues });
    }
    if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Malformed JSON body' });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 5 MB)' });
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && !err.expose && !err.status ? 'Internal server error' : err.message });
  });

  return app;
}

module.exports = { createApp };
