import { appleFetch } from "./appleHttp.js";
import { mapAppleSongToCard } from "./normalize.js";
import { rcacheGet, rcacheSet } from "../../lib/redisCache.js";

/**
 * Map preferred language → Apple storefront
 * This decides *where* to pull charts from.
 */
const LANG_TO_STOREFRONT = {
  en: "us",
  es: "mx",
  ja: "jp",
};

/**
 * Map preferred language → genre IDs for discovery
 */
const LANG_TO_GENRE_IDS = {
  en: ["34"], // Pop
  es: ["12", "1119"], // Latin, Urbano Latino
  ja: ["27"], // J-Pop
};

export async function getAppleHomeRows({ user, storefront }) {
  const langPrefs = user?.preferences?.preferredLanguages || [];
  const rows = [];
  const userToken = user?.providers?.apple?.musicUserToken;

  console.log("[appleDiscovery] start", {
    userId: user?._id?.toString?.(),
    hasUserToken: !!userToken,
    langs: langPrefs,
    storefront,
  });

  if (!userToken) {
    console.log("[appleDiscovery] no user token — skipping");
    return [];
  }

  /* -----------------------------
   * Personal rows (same storefront)
   * ----------------------------- */
  const heavyKey = `apple:${user._id}:heavy:${storefront}`;
  const recentKey = `apple:${user._id}:recent:${storefront}`;

  let heavy = await rcacheGet(heavyKey);
  let recent = await rcacheGet(recentKey);

  try {
    if (!heavy) {
      const r = await appleFetch(`/v1/me/history/heavy-rotation`, {
        userToken,
        storefront,
      });
      heavy = (r?.data || []).map(mapAppleSongToCard).filter(Boolean);
      await rcacheSet(heavyKey, heavy, 90);
    }
    if (heavy?.length) {
      rows.push({
        key: "heavyRotation",
        title: "Heavy Rotation",
        items: heavy,
      });
    }
  } catch (err) {
    console.warn("[appleDiscovery] heavy rotation failed:", err.message);
  }

  try {
    if (!recent) {
      const r = await appleFetch(`/v1/me/recent/played/tracks`, {
        userToken,
        storefront,
        params: { limit: 25 },
      });
      recent = (r?.data || []).map(mapAppleSongToCard).filter(Boolean);
      await rcacheSet(recentKey, recent, 90);
    }
    if (recent?.length) {
      rows.push({
        key: "recentlyPlayed",
        title: "Recently Played",
        items: recent,
      });
    }
  } catch (err) {
    console.warn("[appleDiscovery] recent played failed:", err.message);
  }

  /* -----------------------------
   * Discovery by language prefs
   * ----------------------------- */
  for (const lang of langPrefs) {
    const langStorefront = LANG_TO_STOREFRONT[lang] || storefront;
    const genres = LANG_TO_GENRE_IDS[lang] || [];

    for (const genreId of genres) {
      const chartKey = `apple:charts:${langStorefront}:${genreId}`;
      let chart = await rcacheGet(chartKey);

      if (!chart) {
        try {
          const r = await appleFetch(`/v1/catalog/${langStorefront}/charts`, {
            storefront: langStorefront,
            userToken,
            params: { types: "songs", genre: genreId, limit: 20 },
          });

          const songs = (r?.results?.songs?.[0]?.data || [])
            .map(mapAppleSongToCard)
            .filter(Boolean);

          chart = songs;
          await rcacheSet(chartKey, chart, 90);
        } catch (err) {
          console.warn(
            `[appleDiscovery] skipping genre ${genreId} for ${langStorefront}:`,
            err.message
          );
          continue; // skip invalid
        }
      }

      if (chart?.length) {
        rows.push({
          key: `charts:${lang}:${genreId}`,
          title:
            lang === "es"
              ? "Latin Charts"
              : lang === "ja"
              ? "J-Pop Charts"
              : "Top Songs",
          items: chart,
        });
      }
    }
  }

  /* -----------------------------
   * Fallback — general charts
   * ----------------------------- */
  if (!langPrefs?.length || rows.length < 2) {
    const baseKey = `apple:charts:${storefront}:base`;
    let base = await rcacheGet(baseKey);

    if (!base) {
      try {
        const r = await appleFetch(`/v1/catalog/${storefront}/charts`, {
          storefront,
          userToken,
          params: { types: "songs", limit: 20 },
        });
        base = (r?.results?.songs?.[0]?.data || [])
          .map(mapAppleSongToCard)
          .filter(Boolean);
        await rcacheSet(baseKey, base, 90);
      } catch (err) {
        console.warn("[appleDiscovery] fallback chart failed:", err.message);
        base = [];
      }
    }

    if (base?.length)
      rows.push({ key: "charts:top", title: "Top Songs", items: base });
  }

  return rows;
}
