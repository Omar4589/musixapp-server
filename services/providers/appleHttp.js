import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

let cachedDevToken = null;
let cachedExp = 0;

function signDevToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedDevToken && now < cachedExp - 60) return cachedDevToken;

  const privateKey = (env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const payload = {
    iss: env.APPLE_TEAM_ID,
    iat: now,
    exp: now + 1800,
    aud: "appstoreconnect-v1",
  };
  const headers = { alg: "ES256", kid: env.APPLE_KEY_ID, typ: "JWT" };
  const token = jwt.sign(payload, privateKey, {
    algorithm: "ES256",
    header: headers,
  });
  cachedDevToken = token;
  cachedExp = now + 1800;
  return token;
}

export async function appleFetch(path, { userToken, storefront, params } = {}) {
  const url = new URL(`https://api.music.apple.com${path}`);
  console.log("[appleFetch request]", { url, hasUserToken: !!userToken });

  if (params)
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const devToken = signDevToken();
  const headers = {
    Authorization: `Bearer ${devToken}`,
    Accept: "application/json",
  };
  if (userToken) headers["Music-User-Token"] = userToken;
  if (storefront) headers["X-Apple-Store-Front"] = storefront;

  const res = await fetch(url.toString(), { headers });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(
      "[appleFetch error]",
      res.status,
      res.statusText,
      url,
      text.slice(0, 200)
    );
    throw new Error(`Apple ${res.status}: ${res.statusText}`);
  }
  return res.json();
}
