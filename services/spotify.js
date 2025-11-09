// services/spotify.js
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const AUTH_BASE = "https://accounts.spotify.com";
const API_BASE = "https://api.spotify.com/v1";

// Build the user-facing authorize URL
export function buildSpotifyAuthUrl({ state, scope = [] }) {
  const params = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: env.SPOTIFY_REDIRECT_URI,
    state,
    scope: scope.join(" "),
    show_dialog: "false",
  });
  return `${AUTH_BASE}/authorize?${params.toString()}`;
}

// Exchange code for tokens
export async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.SPOTIFY_REDIRECT_URI,
    client_id: env.SPOTIFY_CLIENT_ID,
    client_secret: env.SPOTIFY_CLIENT_SECRET,
  });

  const res = await fetch(`${AUTH_BASE}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    logger.error({ msg: "spotify.exchange.failed", status: res.status, text });
    throw new Error("Failed to exchange Spotify code");
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token, // may be undefined if scopes didn’t include offline access; Spotify usually returns it
    expiresIn: data.expires_in,
    scope: (data.scope || "").split(" ").filter(Boolean),
    tokenType: data.token_type,
  };
}

// Refresh access token
export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.SPOTIFY_CLIENT_ID,
    client_secret: env.SPOTIFY_CLIENT_SECRET,
  });

  const res = await fetch(`${AUTH_BASE}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json();
  if (!res.ok) {
    logger.warn({ msg: "spotify.refresh.failed", status: res.status, data });
    const err = new Error("Failed to refresh Spotify token");
    err.code = data?.error || "refresh_failed";
    throw err;
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    scope: (data.scope || "").split(" ").filter(Boolean),
    tokenType: data.token_type,
    // refresh_token may not always be returned on refresh; only update if present
    refreshToken: data.refresh_token,
  };
}

// Get current user profile to store spotify user id
export async function getCurrentUserProfile(accessToken) {
  const res = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn({ msg: "spotify.me.failed", status: res.status, text });
    throw new Error("Failed to fetch Spotify profile");
  }
  return res.json(); // { id, email, product, ... }
}
