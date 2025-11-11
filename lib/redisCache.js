// lib/redisCache.js
import { redis } from "../config/redis.js";

/** JSON get with graceful null on miss */
export async function rcacheGet(key) {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // if some old value wasn't JSON, nuke it
    await redis.del(key);
    return null;
  }
}

/** JSON set with TTL (seconds) */
export async function rcacheSet(key, val, ttlSec = 90) {
  const payload = JSON.stringify(val ?? null);
  if (ttlSec > 0) {
    await redis.set(key, payload, "EX", ttlSec);
  } else {
    await redis.set(key, payload);
  }
}
