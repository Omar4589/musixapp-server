// services/discovery/home.js
import { getAppleHomeRows } from "../providers/appleDiscovery.js";
import { getSpotifyHomeRows } from "../providers/spotifyDiscovery.js";

export async function buildHome({ user, storefront, locale, provider }) {
  const rows = [];

  try {
    if (provider === "apple") {
      const appleRows = await getAppleHomeRows({ user, storefront });
      rows.push(...appleRows);
    } else if (provider === "spotify") {
      const spotifyRows = await getSpotifyHomeRows({ user, locale });
      rows.push(...spotifyRows);
    } else {
      console.warn("[discovery] unknown provider", provider);
    }
  } catch (err) {
    console.error(`[discovery] failed to build home for ${provider}:`, err);
  }

  return { rows };
}
