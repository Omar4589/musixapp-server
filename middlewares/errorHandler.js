import { logger } from "../config/logger.js";

export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const code = err.code || "INTERNAL_ERROR";
  const msg =
    status >= 500 ? "Something went wrong" : err.message || "Bad request";
  if (status >= 500) logger.error({ err, path: req.path });
  res.status(status).json({ error: { code, message: msg } });
}
