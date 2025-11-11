// controllers/discoveryRoutes.js
import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod";
import { buildHome } from "../services/discovery/home.js";
import {
  getAppleTrackDetails,
  getAppleAlbumDetails,
} from "../services/providers/appleDiscovery.js";
import {
  getSpotifyTrackDetails,
  getSpotifyAlbumDetails,
} from "../services/providers/spotifyDiscovery.js";

const router = express.Router();

/* ---------------------- HOME FEED ---------------------- */
const QuerySchema = z.object({
  storefront: z.string().min(2).max(5).optional(),
  locale: z.string().optional(),
  provider: z.string().optional(),
});

router.get("/discovery/home", requireAuth, async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query || {});
  const storefront = parsed.success ? parsed.data.storefront || "us" : "us";
  const locale = parsed.success ? parsed.data.locale || null : null;
  const providerQuery = parsed.success ? parsed.data.provider || null : null;

  const provider =
    providerQuery ||
    req.user?.activeProvider ||
    (req.user?.providers?.apple?.musicUserToken
      ? "apple"
      : req.user?.providers?.spotify?.refreshToken
      ? "spotify"
      : null);

  if (!provider) {
    return res.status(400).json({
      message: "No music provider linked. Link a provider to continue.",
      rows: [],
    });
  }

  console.log("[discovery] building home", {
    userId: req.user._id,
    storefront,
    locale,
    provider,
  });

  const result = await buildHome({
    user: req.user,
    storefront,
    locale,
    provider,
  });

  return res.json(result);
});

/* ---------------------- TRACK DETAILS ---------------------- */
router.get("/discovery/track/:provider/:id", requireAuth, async (req, res) => {
  const { provider, id } = req.params;
  const storefront = req.query.storefront || "us";
  const user = req.user;

  try {
    if (provider === "apple") {
      const token = user?.providers?.apple?.musicUserToken;
      if (!token)
        return res.status(400).json({ message: "Apple user token missing" });
      const track = await getAppleTrackDetails(id, token, storefront);
      return res.json(track);
    }

    if (provider === "spotify") {
      const refreshToken = user?.providers?.spotify?.refreshToken || null;
      const track = await getSpotifyTrackDetails(id, refreshToken);
      return res.json(track);
    }

    return res.status(400).json({ message: "Unsupported provider" });
  } catch (err) {
    console.error("[discovery.track.error]", err.message);
    return res.status(500).json({ message: "Failed to load track details" });
  }
});

/* ---------------------- ALBUM DETAILS ---------------------- */
router.get("/discovery/album/:provider/:id", requireAuth, async (req, res) => {
  const { provider, id } = req.params;
  const storefront = req.query.storefront || "us";
  const user = req.user;

  try {
    if (provider === "apple") {
      const token = user?.providers?.apple?.musicUserToken;
      if (!token)
        return res.status(400).json({ message: "Apple user token missing" });
      const album = await getAppleAlbumDetails(id, token, storefront);
      return res.json(album);
    }

    if (provider === "spotify") {
      const refreshToken = user?.providers?.spotify?.refreshToken || null;
      const album = await getSpotifyAlbumDetails(id, refreshToken);
      return res.json(album);
    }

    return res.status(400).json({ message: "Unsupported provider" });
  } catch (err) {
    console.error("[discovery.album.error]", err.message);
    return res.status(500).json({ message: "Failed to load album details" });
  }
});

export default router;
