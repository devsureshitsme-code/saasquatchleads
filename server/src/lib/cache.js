/**
 * Small cache abstraction: Redis when REDIS_URL is set (Upstash in production),
 * otherwise an in-process Map with TTL so the app still runs with zero setup.
 */
const config = require('../config');

class MemoryCache {
  constructor() {
    this.store = new Map();
    this.kind = 'memory';
  }
  async get(key) {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }
  async set(key, value, ttlSeconds) {
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
}

class RedisCache {
  constructor(url) {
    const Redis = require('ioredis');
    this.kind = 'redis';
    this.client = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: false, enableOfflineQueue: false });
    this.client.on('error', (err) => {
      if (!this.warned) console.warn(`[cache] Redis error, using fallback: ${err.message}`);
      this.warned = true;
    });
    this.fallback = new MemoryCache();
  }
  async get(key) {
    try {
      const raw = await this.client.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return this.fallback.get(key);
    }
  }
  async set(key, value, ttlSeconds) {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      await this.fallback.set(key, value, ttlSeconds);
    }
  }
}

const cache = config.redisUrl ? new RedisCache(config.redisUrl) : new MemoryCache();

/** Read-through helper: return cached value or compute, store, and return it. */
async function remember(key, ttlSeconds, compute) {
  const cached = await cache.get(key);
  if (cached !== null && cached !== undefined) return { value: cached, cached: true };
  const value = await compute();
  await cache.set(key, value, ttlSeconds);
  return { value, cached: false };
}

module.exports = { cache, remember, MemoryCache };
