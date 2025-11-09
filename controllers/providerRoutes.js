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

const router = express.Router();

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

    const tokens = await exchangeCodeForTokens(code);
    const me = await getCurrentUserProfile(tokens.accessToken);

    await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          "providers.spotify.userId": me?.id || null,
          "providers.spotify.refreshToken": tokens.refreshToken || null,
          "providers.spotify.scope": tokens.scope || [],
          "providers.spotify.linkedAt": new Date(),
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
      `${
        env.DEEP_LINK_SCHEME
      }://oauth/callback?provider=spotify&ok=0&error=${encodeURIComponent(
        "oauth_failed"
      )}`
    );
  }
});

// Helper: map refresh errors -> needsAttention flag (used by /me/providers)
async function getSpotifyNeedsAttention(user) {
  try {
    const rt = user?.providers?.spotify?.refreshToken;
    if (!rt) return false;
    const refreshed = await refreshAccessToken(rt);
    // If refresh returned a new refreshToken, we might want to persist it
    if (refreshed?.refreshToken) {
      await User.findByIdAndUpdate(user._id, {
        $set: { "providers.spotify.refreshToken": refreshed.refreshToken },
      });
    }
    return false; // refresh ok
  } catch (e) {
    // invalid_grant or similar → needs attention
    return true;
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
    spotify: {
      linked: Boolean(s?.refreshToken),
      linkedAt: s?.linkedAt,
      scopes: s?.scope || [],
      needsAttention: spotifyNeeds,
    },
    apple: {
      linked: Boolean(a?.musicUserToken),
      linkedAt: a?.linkedAt || null,
      subscriptionActive: a?.subscriptionActive ?? null,
      needsAttention: false, // we don’t hard-block on this
    },
  });
});

// Unlink Spotify
router.post("/providers/spotify/unlink", requireAuth, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, {
    $set: {
      "providers.spotify.userId": null,
      "providers.spotify.refreshToken": null,
      "providers.spotify.scope": [],
      "providers.spotify.linkedAt": null,
    },
  });
  logger.info({ msg: "spotify.unlink", userId: String(req.user._id) });
  return res.json({ ok: true });
});

// Link Apple token
router.post("/apple/token", requireAuth, async (req, res) => {
  const { musicUserToken } = req.body || {};
  if (!musicUserToken) {
    return res.status(400).json({ message: "musicUserToken required" });
  }

  await User.findByIdAndUpdate(req.user._id, {
    $set: {
      "providers.apple.musicUserToken": musicUserToken,
      "providers.apple.linkedAt": new Date(),
      // Optional: you can attempt verification here and set subscriptionActive
    },
  });

  logger.info({ msg: "apple.link", userId: String(req.user._id) });
  return res.json({ ok: true });
});

// Unlink Apple
router.post("/providers/apple/unlink", requireAuth, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, {
    $set: {
      "providers.apple.musicUserToken": null,
      "providers.apple.subscriptionActive": null,
      "providers.apple.linkedAt": null,
    },
  });
  logger.info({ msg: "apple.unlink", userId: String(req.user._id) });
  return res.json({ ok: true });
});

export default router;

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
