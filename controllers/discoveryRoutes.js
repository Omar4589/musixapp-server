// controllers/discoveryRoutes.js
import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod";
import { buildHome } from "../services/discovery/home.js";
import {
  getAppleTrackDetails,
  getAppleAlbumDetails,
  getAppleLibraryAlbumDetails,
  getAppleArtistDetails,
} from "../services/providers/appleDiscovery.js";
import {
  getSpotifyTrackDetails,
  getSpotifyAlbumDetails,
  getSpotifyArtistDetails,
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
  const { provider } = req.params;
  // Strip any prefixes like 'apple:' or 'spotify:'
  const id = req.params.id.replace(/^(apple:|spotify:)/, "");
  const storefront = req.query.storefront || "us";
  const user = req.user;

  try {
    if (provider === "apple") {
      const token = user?.providers?.apple?.musicUserToken;
      if (!token)
        return res.status(400).json({ message: "Apple user token missing" });

      // detect library vs catalog item
      const isLibrary = id.startsWith("l.");

      const album = isLibrary
        ? await getAppleLibraryAlbumDetails(id, token)
        : await getAppleAlbumDetails(id, token, storefront);

      if (!album) {
        console.warn(`[discovery.album] Apple album not found for ${id}`);
        return res.status(404).json({ message: "Album not found" });
      }

      return res.json(album);
    }

    if (provider === "spotify") {
      const refreshToken = user?.providers?.spotify?.refreshToken || null;
      const album = await getSpotifyAlbumDetails(id, refreshToken);

      if (!album) {
        console.warn(`[discovery.album] Spotify album not found for ${id}`);
        return res.status(404).json({ message: "Album not found" });
      }

      return res.json(album);
    }

    // fallback for unsupported providers
    return res.status(400).json({ message: "Unsupported provider" });
  } catch (err) {
    console.error("[discovery.album.error]", provider, err.message);
    return res.status(500).json({ message: "Failed to load album details" });
  }
});

/* ---------------------- ARIST DETAILS ---------------------- */
router.get("/discovery/artist/:provider/:id", requireAuth, async (req, res) => {
  const { provider } = req.params;
  // strip prefixes like apple: or spotify:
  const id = req.params.id.replace(/^(apple:|spotify:)/, "");
  const storefront = req.query.storefront || "us";
  const user = req.user;

  try {
    let artist = null;

    if (provider === "apple") {
      const token = user?.providers?.apple?.musicUserToken;
      if (!token)
        return res.status(400).json({ message: "Apple user token missing" });

      artist = await getAppleArtistDetails(id, token, storefront);
    } else if (provider === "spotify") {
      const refreshToken = user?.providers?.spotify?.refreshToken || null;
      artist = await getSpotifyArtistDetails(id, refreshToken);
    } else {
      return res.status(400).json({ message: "Unsupported provider" });
    }

    if (!artist) return res.status(404).json({ message: "Artist not found" });

    return res.json(artist);
  } catch (err) {
    console.error("[discovery.artist.error]", err.message);
    return res.status(500).json({ message: "Failed to load artist details" });
  }
});

export default router;
