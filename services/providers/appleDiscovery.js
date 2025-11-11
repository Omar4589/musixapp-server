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

/* -----------------------------
 * Track + Album Details (Apple)
 * ----------------------------- */
export async function getAppleTrackDetails(id, userToken, storefront = "us") {
  const r = await appleFetch(`/v1/catalog/${storefront}/songs/${id}`, {
    userToken,
    storefront,
  });

  const item = r?.data?.[0];
  if (!item) throw new Error("Track not found");
  const attrs = item.attributes || {};
  const artwork = attrs.artwork?.url
    ?.replace("{w}", "800")
    .replace("{h}", "800");

  return {
    id: `apple:${item.id}`,
    provider: "apple",
    name: attrs.name || "",
    artists: attrs.artistName ? [attrs.artistName] : [],
    album: attrs.albumName || "",
    releaseDate: attrs.releaseDate || null,
    genre: attrs.genreNames?.[0] || null,
    artworkUrl: artwork || null,
  };
}

export async function getAppleAlbumDetails(id, userToken, storefront = "us") {
  const r = await appleFetch(`/v1/catalog/${storefront}/albums/${id}`, {
    userToken,
    storefront,
  });

  const item = r?.data?.[0];
  if (!item) throw new Error("Album not found");
  const attrs = item.attributes || {};
  const artwork = attrs.artwork?.url
    ?.replace("{w}", "800")
    .replace("{h}", "800");

  const tracks =
    item.relationships?.tracks?.data?.map((t) => ({
      id: `apple:${t.id}`,
      name: t.attributes?.name || "",
      artists: t.attributes?.artistName ? [t.attributes.artistName] : [],
      durationMs: t.attributes?.durationInMillis || null,
    })) || [];

  return {
    id: `apple:${item.id}`,
    provider: "apple",
    name: attrs.name || "",
    artists: attrs.artistName ? [attrs.artistName] : [],
    album: attrs.name || "",
    releaseDate: attrs.releaseDate || null,
    genre: attrs.genreNames?.[0] || null,
    artworkUrl: artwork || null,
    tracks,
  };
}

export async function getAppleLibraryAlbumDetails(id, userToken) {
  const url = `/v1/me/library/albums/${id}`;
  const r = await appleFetch(url, { userToken });
  const item = r?.data?.[0];
  if (!item) return null;

  return {
    id: item.id,
    name: item.attributes?.name || "",
    artists: [item.attributes?.artistName].filter(Boolean),
    genre: item.attributes?.genreNames?.[0] || "",
    artworkUrl:
      item.attributes?.artwork?.url
        ?.replace("{w}", "600")
        ?.replace("{h}", "600") || null,
    tracks:
      item.relationships?.tracks?.data?.map((t) => ({
        id: t.id,
        name: t.attributes?.name,
        artists: [t.attributes?.artistName].filter(Boolean),
        durationMs: t.attributes?.durationInMillis,
      })) || [],
  };
}

/* ---------------------- ARTIST DETAILS ---------------------- */
export async function getAppleArtistDetails(
  nameOrId,
  userToken,
  storefront = "us"
) {
  let artist = null;

  try {
    // If it's a clean ID (digits only), use it directly
    if (/^\d+$/.test(nameOrId)) {
      const res = await appleFetch(
        `/v1/catalog/${storefront}/artists/${nameOrId}`,
        {
          userToken,
          storefront,
        }
      );
      artist = res?.data?.[0];
    }

    // If no result (likely a name), search by term
    if (!artist) {
      const searchRes = await appleFetch(`/v1/catalog/${storefront}/search`, {
        userToken,
        storefront,
        params: { term: nameOrId, types: "artists", limit: 1 },
      });

      const firstArtist = searchRes?.results?.artists?.data?.[0];
      if (firstArtist?.id) {
        const detailRes = await appleFetch(
          `/v1/catalog/${storefront}/artists/${firstArtist.id}`,
          {
            userToken,
            storefront,
          }
        );
        artist = detailRes?.data?.[0];
      }
    }
    console.log("[apple.artist.raw]", JSON.stringify(artist, null, 2));

    if (!artist) throw new Error("Artist not found");

    const attrs = artist.attributes || {};
    const artwork = attrs.artwork?.url
      ?.replace("{w}", "600")
      ?.replace("{h}", "600");

    return {
      id: artist.id,
      name: attrs.name || nameOrId,
      genres: attrs.genreNames || [],
      artworkUrl: artwork || null,
      bio:
        attrs.editorialNotes?.standard || attrs.editorialNotes?.short || null,
    };
  } catch (err) {
    console.warn("[apple.artist] fetch failed:", err.message);
    return {
      id: nameOrId,
      name: nameOrId,
      bio: null,
      genres: [],
      artworkUrl: null,
    };
  }
}
