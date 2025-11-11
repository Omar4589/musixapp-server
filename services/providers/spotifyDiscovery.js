// services/providers/spotifyDiscovery.js
import { env } from "../../config/env.js";
import { rcacheGet, rcacheSet } from "../../lib/redisCache.js";
import { logger } from "../../config/logger.js";

const API_BASE = "https://api.spotify.com/v1";

// Basic client credentials flow to get system token
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

export async function getSpotifyHomeRows({ user, locale }) {
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

    // Featured playlists
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

    // New releases (albums → top tracks)
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
    logger.error({ msg: "spotify.discovery.failed", err: err.message });
  }

  return rows;
}
