// services/providers/spotifyDiscovery.js
import { env } from "../../config/env.js";
import { rcacheGet, rcacheSet } from "../../lib/redisCache.js";
import { logger } from "../../config/logger.js";
import { refreshAccessToken } from "../spotify.js";

const API_BASE = "https://api.spotify.com/v1";

/* -----------------------------
 *  Helpers
 * ----------------------------- */
function mapSpotifyTrackToCard(track) {
  if (!track?.id) return null;
  try {
    return {
      id: `spotify:${track.id}`,
      provider: "spotify",
      providerId: track.id,
      name: track.name || "",
      artists: track.artists?.map((a) => a.name) || [],
      album: track.album?.name || "",
      durationMs: track.duration_ms || null,
      artworkUrl: track.album?.images?.[0]?.url || null,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch generic browse feed using app-level token
 */
async function getSystemAccessToken() {
  const cacheKey = "spotify:system:token";
  const cached = await rcacheGet(cacheKey);
  if (cached) return cached;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.SPOTIFY_CLIENT_ID,
    client_secret: env.SPOTIFY_CLIENT_SECRET,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Spotify system token failed: ${txt.slice(0, 120)}`);
  }

  const data = await res.json();
  await rcacheSet(cacheKey, data.access_token, data.expires_in - 30);
  return data.access_token;
}

/* -----------------------------
 *  Personalized Discovery
 * ----------------------------- */
export async function getSpotifyHomeRows({ user }) {
  const rows = [];
  const refreshToken = user?.providers?.spotify?.refreshToken;

  // ✅ personalized path if user has a refresh token
  if (refreshToken) {
    try {
      const { accessToken } = await refreshAccessToken(refreshToken);
      const userId = user._id.toString();
      const topKey = `spotify:${userId}:top`;
      const recentKey = `spotify:${userId}:recent`;

      let top = await rcacheGet(topKey);
      let recent = await rcacheGet(recentKey);

      // Your Top Tracks
      if (!top) {
        const res = await fetch(`${API_BASE}/me/top/tracks?limit=20`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          top = (data?.items || []).map(mapSpotifyTrackToCard).filter(Boolean);
          await rcacheSet(topKey, top, 90);
        }
      }
      if (top?.length) {
        rows.push({ key: "spotify:top", title: "Your Top Tracks", items: top });
      }

      // Recently Played
      if (!recent) {
        const res = await fetch(
          `${API_BASE}/me/player/recently-played?limit=20`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        if (res.ok) {
          const data = await res.json();
          recent = (data?.items || [])
            .map((x) => mapSpotifyTrackToCard(x.track))
            .filter(Boolean);
          await rcacheSet(recentKey, recent, 90);
        }
      }
      if (recent?.length) {
        rows.push({
          key: "spotify:recent",
          title: "Recently Played",
          items: recent,
        });
      }

      // If personalized failed silently or no rows, fallback to generic
      if (!rows.length) {
        const fallback = await getSpotifyGenericRows();
        rows.push(...fallback);
      }

      return rows;
    } catch (err) {
      logger.error({
        msg: "spotify.discovery.personal.failed",
        err: err.message,
      });
      const fallback = await getSpotifyGenericRows();
      return fallback;
    }
  }

  // ❌ No refresh token → generic public browse
  return await getSpotifyGenericRows();
}

/* -----------------------------
 *  Generic (Public) Feed
 * ----------------------------- */
async function getSpotifyGenericRows() {
  const rows = [];
  const token = await getSystemAccessToken();

  try {
    const [featured, newReleases] = await Promise.all([
      fetch(`${API_BASE}/browse/featured-playlists?limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
      fetch(`${API_BASE}/browse/new-releases?limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
    ]);

    // Featured Playlists
    const playlists =
      featured?.playlists?.items?.map((p) => ({
        id: `spotify:${p.id}`,
        provider: "spotify",
        providerId: p.id,
        name: p.name,
        artists: [p.owner?.display_name || "Spotify"],
        album: null,
        durationMs: null,
        artworkUrl: p.images?.[0]?.url || null,
      })) || [];

    if (playlists.length) {
      rows.push({
        key: "spotify:featured",
        title: "Featured Playlists",
        items: playlists,
      });
    }

    // New Releases
    const albums =
      newReleases?.albums?.items?.map((a) => ({
        id: `spotify:${a.id}`,
        provider: "spotify",
        providerId: a.id,
        name: a.name,
        artists: (a.artists || []).map((x) => x.name),
        album: a.name,
        durationMs: null,
        artworkUrl: a.images?.[0]?.url || null,
      })) || [];

    if (albums.length) {
      rows.push({
        key: "spotify:new",
        title: "New Releases",
        items: albums,
      });
    }
  } catch (err) {
    logger.error({ msg: "spotify.discovery.generic.failed", err: err.message });
  }

  return rows;
}
