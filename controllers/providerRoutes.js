// controllers/providerRoutes.js
import express from "express";
import crypto from "crypto";
import { requireAuth } from "../middlewares/auth.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { User } from "../models/User.js";
import {
  setSpotifyOAuthState,
  findUserIdBySpotifyState,
  getAndDeleteSpotifyOAuthState,
} from "../config/redis.js";
import {
  buildSpotifyAuthUrl,
  exchangeCodeForTokens,
  getCurrentUserProfile,
  refreshAccessToken,
} from "../services/spotify.js";
import { signAppleDeveloperToken } from "../services/apple.js";

const router = express.Router();

/* ---------- SPOTIFY SPOTIFY SPOTIFY SPOTIFY SPOTIFY  ---------- */
const SPOTIFY_SCOPES = [
  "user-read-email",
  "user-read-private",
  "streaming",
  "app-remote-control",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
];

router.get("/oauth/spotify/start", requireAuth, async (req, res) => {
  try {
    const userId = String(req.user._id);
    const state = crypto.randomUUID();

    await setSpotifyOAuthState(userId, state, { createdAt: Date.now() }, 600);

    const authUrl = buildSpotifyAuthUrl({ state, scope: SPOTIFY_SCOPES });
    logger.info({ msg: "spotify.oauth.start", userId });
    return res.json({ authUrl, state });
  } catch (err) {
    logger.error({ msg: "spotify.oauth.start.error", err: err.message });
    return res.status(500).json({ message: "Failed to start Spotify OAuth" });
  }
});

router.get("/oauth/spotify/callback", async (req, res) => {
  const { code, state } = req.query || {};
  try {
    const userId = await findUserIdBySpotifyState(state);
    if (!userId) return res.status(400).send("Invalid or expired state");

    const stateData = await getAndDeleteSpotifyOAuthState(userId, state);
    if (!stateData)
      return res.status(400).send("State already used or expired");

    const user = await User.findById(userId).lean();
    if (user.activeProvider && user.activeProvider !== "spotify") {
      logger.warn({
        msg: "spotify.oauth.already_linked_conflict",
        userId,
        active: user.activeProvider,
      });
      return res.redirect(
        `${env.DEEP_LINK_SCHEME}://oauth/callback?provider=spotify&ok=0&error=already_linked`
      );
    }

    const tokens = await exchangeCodeForTokens(code);
    const me = await getCurrentUserProfile(tokens.accessToken);

    if (me?.product !== "premium") {
      logger.warn({
        msg: "spotify.oauth.nonpremium",
        userId,
        plan: me?.product,
      });
      return res.redirect(
        `${env.DEEP_LINK_SCHEME}://oauth/callback?provider=spotify&ok=0&error=not_premium`
      );
    }

    await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          "providers.spotify.userId": me?.id || null,
          "providers.spotify.refreshToken": tokens.refreshToken || null,
          "providers.spotify.scope": tokens.scope || [],
          "providers.spotify.linkedAt": new Date(),
          "providers.spotify.plan": me?.product || null,
          activeProvider: "spotify",
        },
      },
      { new: true }
    );

    logger.info({ msg: "spotify.oauth.success", userId, spotifyId: me?.id });
    return res.redirect(
      `${env.DEEP_LINK_SCHEME}://oauth/callback?provider=spotify&ok=1`
    );
  } catch (err) {
    logger.error({ msg: "spotify.oauth.callback.error", err: err.message });
    return res.redirect(
      `${env.DEEP_LINK_SCHEME}://oauth/callback?provider=spotify&ok=0&error=oauth_failed`
    );
  }
});

// Helper: map refresh errors -> needsAttention flag (used by /me/providers)
async function getSpotifyNeedsAttention(user) {
  try {
    const rt = user?.providers?.spotify?.refreshToken;
    if (!rt) return false;

    // 🔁 Refresh access token
    const refreshed = await refreshAccessToken(rt);
    const me = await getCurrentUserProfile(refreshed.accessToken);

    // 🧠 Update stored plan
    if (me?.product) {
      await User.findByIdAndUpdate(user._id, {
        $set: { "providers.spotify.plan": me.product },
      });
    }

    // ⚠️ If plan isn’t premium → needs attention
    if (me?.product !== "premium") {
      return true;
    }

    // 🔐 Keep refresh token up-to-date if Spotify rotated it
    if (refreshed?.refreshToken) {
      await User.findByIdAndUpdate(user._id, {
        $set: { "providers.spotify.refreshToken": refreshed.refreshToken },
      });
    }

    return false; // all good
  } catch (e) {
    console.error("Spotify plan recheck failed", e);
    return true; // fallback: assume it needs attention
  }
}

// Providers status
router.get("/me/providers", requireAuth, async (req, res) => {
  const u = await User.findById(req.user._id);
  const s = u?.providers?.spotify || {};
  const a = u?.providers?.apple || {};

  let spotifyNeeds = false;
  if (s?.refreshToken) {
    spotifyNeeds = await getSpotifyNeedsAttention(u);
  }

  return res.json({
    activeProvider: u.activeProvider || null,
    spotify: {
      linked: Boolean(s?.refreshToken),
      linkedAt: s?.linkedAt,
      scopes: s?.scope || [],
      plan: s.plan || null,
      needsAttention: spotifyNeeds,
    },
    apple: {
      linked: Boolean(a?.musicUserToken),
      linkedAt: a?.linkedAt || null,
      subscriptionActive: a?.subscriptionActive ?? null,
      needsAttention: false,
    },
    flags: {
      providerLinkOptional: !!env.PROVIDER_LINK_OPTIONAL,
      appleAndroidEnabled: !!env.PROVIDER_APPLE_ANDROID_ENABLED,
    },
  });
});

// Unlink Spotify and Apple
router.post("/providers/:provider/unlink", requireAuth, async (req, res) => {
  const { provider } = req.params;
  if (!["spotify", "apple"].includes(provider))
    return res.status(400).json({ message: "Invalid provider" });

  const unset = {};
  if (provider === "spotify") {
    unset["providers.spotify.userId"] = null;
    unset["providers.spotify.refreshToken"] = null;
    unset["providers.spotify.scope"] = [];
    unset["providers.spotify.linkedAt"] = null;
  } else if (provider === "apple") {
    unset["providers.apple.musicUserToken"] = null;
    unset["providers.apple.subscriptionActive"] = null;
    unset["providers.apple.linkedAt"] = null;
  }

  const user = await User.findById(req.user._id);
  const nextUpdate = { $set: unset };
  if (user.activeProvider === provider) nextUpdate.$set.activeProvider = null;

  await User.findByIdAndUpdate(req.user._id, nextUpdate);
  logger.info({ msg: `${provider}.unlink`, userId: String(req.user._id) });

  return res.json({ ok: true });
});

/* ---------- internal: state mirror keyed by state only ---------- */
import { redis } from "../config/redis.js";
const stateMirrorKey = (state) => `oauth:spotify:state:${state}`;

// monkey-patch mirrors (keep simple here)
const _origSetSpotifyState = setSpotifyState;
export async function findUserIdByState(state) {
  const userId = await redis.get(stateMirrorKey(state));
  return userId || null;
}
// override the setter to also store state-only mirror (10 min)
export async function setSpotifyState(userId, state, data, ttlSec = 600) {
  await redis.set(stateMirrorKey(state), String(userId), "EX", ttlSec);
  await _origSetSpotifyState(userId, state, data, ttlSec);
}

/* ---------- APPLE APPLE APPLE APPLE APPLE APPLE APPLE ---------- */
// GET /api/apple/dev-token
router.post("/apple/token", requireAuth, async (req, res) => {
  const { musicUserToken } = req.body || {};
  if (!musicUserToken)
    return res.status(400).json({ message: "musicUserToken required" });

  const user = await User.findById(req.user._id).lean();

  if (user.activeProvider && user.activeProvider !== "apple") {
    return res.status(409).json({
      message: `Already linked with ${user.activeProvider}.`,
      conflict: true,
      currentProvider: user.activeProvider,
    });
  }

  await User.findByIdAndUpdate(req.user._id, {
    $set: {
      "providers.apple.musicUserToken": musicUserToken,
      "providers.apple.linkedAt": new Date(),
      activeProvider: "apple",
    },
  });

  logger.info({ msg: "apple.link", userId: String(req.user._id) });
  return res.json({ ok: true });
});

router.get("/apple/dev-token", requireAuth, (_req, res) => {
  try {
    console.log("trying to get apple token");
    const { token, expiresAt } = signAppleDeveloperToken(1800);
    console.log(token);
    res.json({ devToken: token, expiresAt });
  } catch {
    res.status(500).json({ message: "Failed to create Apple dev token" });
  }
});

export default router;
