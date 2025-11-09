// config/env.js
export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",

  // Auth already exists in your middlewares/auth.js
  JWT_SECRET: process.env.JWT_SECRET,
  ACCESS_TTL: process.env.ACCESS_TTL ,
  REFRESH_TTL: process.env.REFRESH_TTL ,
  JWT_ISSUER: process.env.JWT_ISSUER,
  JWT_AUDIENCE: process.env.JWT_AUDIENCE ,

  // Providers
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI: process.env.SPOTIFY_REDIRECT_URI, // -> https://api.yourapp.com/api/oauth/spotify/callback

  APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
  APPLE_KEY_ID: process.env.APPLE_KEY_ID,
  APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY,

  // Flags (env-driven for now)
  PROVIDER_LINK_OPTIONAL: (process.env.PROVIDER_LINK_OPTIONAL || "false") === "true",
  PROVIDER_APPLE_ANDROID_ENABLED: (process.env.PROVIDER_APPLE_ANDROID_ENABLED || "false") === "true",

  // Deep link scheme (documented for readability)
  DEEP_LINK_SCHEME: "makapp", // you chose this
};
