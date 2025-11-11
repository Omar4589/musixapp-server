import express from "express";
import crypto from "crypto";
import { z } from "zod";
import { User } from "../models/User.js";
import {
  signAccessToken,
  signRefreshToken,
  requireAuth,
  verifyToken,
} from "../middlewares/auth.js";
import { rateLimit } from "../middlewares/ratelimit.js";
import { redis, releaseLock, denyJtiUntil } from "../config/redis.js";
import {
  isUsernameAllowed,
  normalizeEmail,
  normalizeUsername,
} from "../lib/usernames.js";

// --- helpers ---
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const idemKeyFromRegister = (email, username) => {
  const bkey = sha256(
    `${normalizeEmail(email)}|${normalizeUsername(username)}`
  );
  return {
    reqKeyPrefix: `idem:req:register:`,
    bizKey: `idem:register:${bkey}`,
  };
};

const withBusinessLocks = async ({ email, username }, ttlSec = 30) => {
  const lockVal = crypto.randomUUID();
  const emailKey = `lock:register:email:${sha256(normalizeEmail(email))}`;
  const userKey = `lock:register:username:${sha256(
    normalizeUsername(username)
  )}`;
  const ok1 = await redis.set(emailKey, lockVal, "NX", "EX", ttlSec);
  if (ok1 !== "OK") return { ok: false };
  const ok2 = await redis.set(userKey, lockVal, "NX", "EX", ttlSec);
  if (ok2 !== "OK") {
    await releaseLock(emailKey, lockVal);
    return { ok: false };
  }
  return { ok: true, lockVal, keys: [emailKey, userKey] };
};

const releaseBusinessLocks = async (keys, val) =>
  Promise.all(keys.map((k) => releaseLock(k, val)));

const sanitizeUser = (u) => ({
  _id: u._id,
  email: u.email,
  username: u.username,
  firstName: u.firstName || "",
  lastName: u.lastName || "",
  fullName: u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim(),
  roles: Array.isArray(u.roles) ? u.roles : ["user"],
  isActive: u.isActive,
  preferences: {
    preferredLanguages: Array.isArray(u?.preferences?.preferredLanguages)
      ? u.preferences.preferredLanguages
      : [],
    genres: Array.isArray(u?.preferences?.genres) ? u.preferences.genres : [],
  },
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

// --- primitive rate limiter (Redis) ---
const rlAuth = rateLimit({ windowSec: 10, max: 5 });
// rate limit for logout endpoints (reuse rlAuth window, slightly higher max)
const rlLogout = rateLimit({
  windowSec: 60,
  max: 10,
  keyer: (req) => req.user?._id || req.ip,
});

// --- validation ---
const RegisterSchema = z.object({
  firstName: z.string().min(1, "First name required").optional(),
  lastName: z.string().min(1, "Last name required").optional(),
  email: z.string().email("Invalid email address"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/,
      "Password must include at least one uppercase letter, one number, and one special character (@$!%*?&)"
    ),
});

const LoginSchema = z.object({
  emailOrUsername: z.string().min(3),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(10),
});

// --- router (handlers inline, arrow-style) ---
const router = express.Router();

// POST /api/auth/register  (idempotent + locks)
router.post("/auth/register", rlAuth, async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  console.log("parse sttuf", parsed);
  if (!parsed.success)
    return res
      .status(400)
      .json({ message: "Validation failed", issues: parsed.error.issues });

  const {
    email,
    username,
    password,
    firstName = "",
    lastName = "",
  } = parsed.data;
  const idk = req.header("Idempotency-Key") || null;
  const emailN = normalizeEmail(email);
  const userN = normalizeUsername(username);
  const displayUsername = username.trim();

  if (!isUsernameAllowed(userN)) {
    console.log(
      "🚫 Blocked username attempt:",
      username,
      "(normalized:",
      userN,
      ")"
    );
    return res.status(400).json({ message: "Username not available" });
  }

  const { reqKeyPrefix, bizKey } = idemKeyFromRegister(emailN, userN);

  // Idempotency replay by business key
  const existingStamp = await redis.get(bizKey);
  if (existingStamp) {
    const { userId } = JSON.parse(existingStamp);
    const usr = await User.findById(userId).lean();
    if (usr) {
      const accessToken = signAccessToken(usr);
      const refreshToken = signRefreshToken(usr);
      return res.status(201).json({
        user: sanitizeUser(usr),
        tokens: { accessToken, refreshToken },
        idempotent: true,
      });
    }
    await redis.del(bizKey); // stale cache
  }

  // Acquire locks
  const lock = await withBusinessLocks({ email: emailN, username: userN }, 30);
  if (!lock.ok)
    return res
      .status(409)
      .json({ message: "Registration in progress, please retry" });

  try {
    // duplicate fast-check
    const dupe = await User.findOne({
      $or: [{ email: emailN }, { username: userN }],
    }).lean();
    if (dupe)
      return res
        .status(409)
        .json({ message: "Email or username already in use" });

    // create user (model pre-save hashes "password")
    const user = new User({
      email: emailN,
      username: userN,
      displayUsername,
      password,
      firstName,
      lastName,
    });
    await user.save();

    // Cache idempotent stamp (10m)
    const stamp = JSON.stringify({ status: 201, userId: user._id.toString() });
    await redis.set(bizKey, stamp, "EX", 600);
    if (idk) await redis.set(`${reqKeyPrefix}${sha256(idk)}`, stamp, "EX", 600);

    const u = user.toObject();
    const accessToken = signAccessToken(u);
    const refreshToken = signRefreshToken(u);
    return res
      .status(201)
      .json({ user: sanitizeUser(u), tokens: { accessToken, refreshToken } });
  } catch (err) {
    if (err?.code === 11000)
      return res
        .status(409)
        .json({ message: "Email or username already in use" });
    return res.status(500).json({ message: "Error creating user" });
  } finally {
    await releaseBusinessLocks(lock.keys, lock.lockVal);
  }
});

// POST /api/auth/login
router.post("/auth/login", rlAuth, async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ message: "Validation failed", issues: parsed.error.issues });
  console.log("HITTING", parsed);
  const { emailOrUsername, password } = parsed.data;
  const isEmail = emailOrUsername.includes("@");
  const ident = isEmail
    ? normalizeEmail(emailOrUsername)
    : normalizeUsername(emailOrUsername);

  const user = await User.findOne(
    isEmail ? { email: ident } : { username: ident }
  ).select("+password");
  if (!user)
    return res
      .status(401)
      .json({ message: "Email or password is incorrect. Please try again." });
  if (!user.isActive)
    return res.status(403).json({
      message: "This account has been deactivated. Please contact support.",
    });

  const valid = await user.isCorrectPassword(password);
  if (!valid)
    return res
      .status(401)
      .json({ message: "Email or password is incorrect. Please try again." });

  const u = user.toObject();
  delete u.password;

  const accessToken = signAccessToken(u);
  const refreshToken = signRefreshToken(u);

  // (Optional) track active JTI per user: can be added if needed later.

  return res
    .status(200)
    .json({ user: sanitizeUser(u), tokens: { accessToken, refreshToken } });
});

// GET /api/auth/me
router.get("/auth/me", requireAuth, async (req, res) => {
  const u = req.user.toObject ? req.user.toObject() : req.user;
  return res.json({ user: sanitizeUser(u) });
});

// POST /api/auth/logout  — kill current access + provided refresh
router.post("/auth/logout", requireAuth, rlLogout, async (req, res) => {
  try {
    // 1) always deny-list the current access token
    if (req.tokenJti && req.tokenExp) {
      await denyJtiUntil(req.tokenJti, req.tokenExp);
    }

    // 2) optionally deny-list a provided refresh token (header or body)
    const headerRt =
      typeof req.headers["x-refresh-token"] === "string"
        ? req.headers["x-refresh-token"]
        : null;
    const bodyRt =
      typeof req.body?.refreshToken === "string" ? req.body.refreshToken : null;
    const refreshToken = headerRt || bodyRt || null;

    if (refreshToken) {
      try {
        // verify refresh; ensure same subject + matching tokenVersion (tv)
        const decoded = verifyToken(refreshToken); // same signature/claims
        const { sub, jti, exp, tv } = decoded || {};
        if (
          String(sub) === String(req.user._id) &&
          (tv ?? -1) === (req.user.tokenVersion ?? 0)
        ) {
          if (jti && exp) await denyJtiUntil(jti, exp);
        }
        // if sub/tv mismatch, silently ignore (don’t leak)
      } catch {
        // invalid/expired refresh token: ignore; access has already been revoked
      }
    }

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ message: "Logout failed" });
  }
});

// POST /api/auth/logout-all  — invalidate everything (all devices)
router.post("/auth/logout-all", requireAuth, rlLogout, async (req, res) => {
  try {
    // bump tokenVersion to revoke all existing tokens for this user
    await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { tokenVersion: 1 } },
      { new: false }
    );

    // deny-list current access immediately
    if (req.tokenJti && req.tokenExp) {
      await denyJtiUntil(req.tokenJti, req.tokenExp);
    }

    // optionally deny-list a provided refresh token (header or body)
    const headerRt =
      typeof req.headers["x-refresh-token"] === "string"
        ? req.headers["x-refresh-token"]
        : null;
    const bodyRt =
      typeof req.body?.refreshToken === "string" ? req.body.refreshToken : null;
    const refreshToken = headerRt || bodyRt || null;

    if (refreshToken) {
      try {
        const decoded = verifyToken(refreshToken);
        const { jti, exp } = decoded || {};
        if (jti && exp) await denyJtiUntil(jti, exp);
      } catch {
        // ignore invalid/expired refresh — tokenVersion bump already invalidates it
      }
    }

    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ message: "Logout-all failed" });
  }
});

// POST /api/auth/refresh — rotate refresh, mint new access
router.post("/auth/refresh", rlAuth, async (req, res) => {
  try {
    const parsed = RefreshSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Refresh token required" });
    }
    const { refreshToken } = parsed.data;

    // 1) verify & extract claims
    let decoded;
    try {
      decoded = verifyRefresh(refreshToken);
    } catch {
      return res
        .status(401)
        .json({ message: "Invalid or expired refresh token" });
    }
    const { sub, jti, exp, tv } = decoded || {};

    // 2) deny-list check (refresh jti could already be revoked)
    const isDenied = await redis.get(`deny:jti:${jti}`);
    if (isDenied) {
      return res.status(401).json({ message: "Refresh token revoked" });
    }

    // 3) load user & tokenVersion match
    const user = await User.findById(sub).lean();
    if (!user || !user.isActive) {
      return res.status(403).json({ message: "Account inactive or not found" });
    }
    if ((user.tokenVersion ?? 0) !== (tv ?? -1)) {
      return res.status(401).json({ message: "Session no longer valid" });
    }

    // 4) rotate refresh: deny-list the OLD refresh jti until its exp
    if (jti && exp) {
      await denyJtiUntil(jti, exp);
    }

    // 5) mint new tokens
    const accessToken = signAccessToken(user);
    const newRefreshToken = signRefreshToken(user);

    return res.json({ tokens: { accessToken, refreshToken: newRefreshToken } });
  } catch (err) {
    return res.status(500).json({ message: "Refresh failed" });
  }
});

export default router;
