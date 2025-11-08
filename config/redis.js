import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

// ----- Locks -----
export const releaseLock = async (key, value) => {
  const lua = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  return redis.eval(lua, 1, key, value);
};

// ----- JWT deny-list (by JTI) -----
const denyKey = (jti) => `deny:jti:${jti}`;

/** mark a JTI as revoked until exp */
export const denyJtiUntil = async (jti, expUnix) => {
  const ttl = Math.max(0, expUnix - Math.floor(Date.now() / 1000));
  if (ttl > 0) await redis.set(denyKey(jti), "1", "EX", ttl);
};

/** check if a JTI is denied */
export const isJtiDenied = async (jti) => {
  if (!jti) return false;
  return Boolean(await redis.get(denyKey(jti)));
};
