// services/apple.js
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * Create a short-lived Apple Developer Token (MusicKit)
 * alg: ES256, kid: APPLE_KEY_ID, iss: APPLE_TEAM_ID, aud: appstoreconnect-v1
 */
export function signAppleDeveloperToken(ttlSeconds = 1800) {
  if (!env.APPLE_TEAM_ID || !env.APPLE_KEY_ID || !env.APPLE_PRIVATE_KEY) {
    throw new Error("Apple Music env not configured");
  }
  const privateKey = (process.env.APPLE_PRIVATE_KEY || "").replace(
    /\\n/g,
    "\n"
  );

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: env.APPLE_TEAM_ID,
    iat: now,
    exp: now + ttlSeconds,
    aud: "appstoreconnect-v1",
  };
  const headers = { alg: "ES256", kid: env.APPLE_KEY_ID, typ: "JWT" };

  // Private key must be the raw .p8 contents (PKCS#8)
  const token = jwt.sign(payload, privateKey, {
    algorithm: "ES256",
    header: headers,
  });

  return {
    token,
    expiresAt: new Date((now + ttlSeconds) * 1000).toISOString(),
  };
}
