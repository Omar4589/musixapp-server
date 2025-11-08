// server/middlewares/rateLimit.js
import { redis } from "../config/redis.js";

export const rateLimit = ({ windowSec = 10, max = 5, keyer }) => {
  return async (req, _res, next) => {
    try {
      const key = `rl:${keyer ? keyer(req) : req.ip}:${req.path}`;
      const tx = redis.multi();
      tx.incr(key);
      tx.expire(key, windowSec);
      const [count] = await tx.exec().then(([c]) => [c[1]]);

      if (count > max) {
        const e = new Error("Too many requests");
        e.status = 429;
        e.code = "RATE_LIMITED";
        return next(e); // let global error handler format it
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};
