import jwt from "jsonwebtoken";
import crypto from "crypto";
import { User } from "../models/User.js";
import { isJtiDenied } from "../config/redis.js";

const secret = process.env.JWT_SECRET;
const accessTtl = process.env.ACCESS_TTL 
const refreshTtl = process.env.REFRESH_TTL 
const ISSUER = process.env.JWT_ISSUER 
const AUDIENCE = process.env.JWT_AUDIENCE 

if (!secret) {
  throw new Error("JWT_SECRET is required");
}

const toStr = (v) => (v ? String(v) : null);

export const signAccessToken = (user) => {
  const jti = crypto.randomUUID();
  const payload = {
    sub: toStr(user._id),
    roles: Array.isArray(user.roles) ? user.roles : ["user"],
    tv: user.tokenVersion ?? 0,
  };
  return jwt.sign(payload, secret, {
    expiresIn: accessTtl,
    issuer: ISSUER,
    audience: AUDIENCE,
    jwtid: jti,
  });
};

export const signRefreshToken = (user) => {
  const jti = crypto.randomUUID();
  const payload = { sub: toStr(user._id), tv: user.tokenVersion ?? 0 };
  return jwt.sign(payload, secret, {
    expiresIn: refreshTtl,
    issuer: ISSUER,
    audience: AUDIENCE,
    jwtid: jti,
  });
};

export const verifyToken = (token) =>
  jwt.verify(token, secret, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });

// Explicit helper for clarity (same verification as access)
export const verifyRefresh = (token) =>
  jwt.verify(token, secret, { issuer: ISSUER, audience: AUDIENCE });

/** Auth middleware: verifies token, deny-list, tokenVersion, loads user */
export const requireAuth = async (req, res, next) => {
  try {
    let token = req.headers?.authorization;
    if (token?.startsWith("Bearer ")) token = token.slice(7).trim();
    if (!token) return res.status(403).json({ message: "No token provided" });

    const decoded = verifyToken(token); // throws on invalid/expired
    const { sub, jti, exp, tv } = decoded || {};

    if (await isJtiDenied(jti)) {
      return res.status(401).json({ message: "Token has been revoked" });
    }

    const user = await User.findById(sub);
    if (!user || !user.isActive) {
      return res.status(403).json({ message: "Account inactive or not found" });
    }

    // instant revocation check via tokenVersion
    if ((user.tokenVersion ?? 0) !== (tv ?? -1)) {
      return res.status(401).json({ message: "Token no longer valid" });
    }

    req.user = user;
    req.tokenJti = jti;
    req.tokenExp = exp;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

// Role guards (roles array on user)
export const requireAdmin = (req, res, next) =>
  req.user?.roles?.includes("admin")
    ? next()
    : res.status(403).json({ message: "Admins only" });
