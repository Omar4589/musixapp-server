export function mapAppleSongToCard(item) {
  try {
    if (!item?.id) return null;

    const id = item.id;
    const attrs = item.attributes || {};
    const artwork = attrs.artwork;
    const art = artwork
      ? artwork.url.replace("{w}", "400").replace("{h}", "400")
      : null;

    const isLibrary = id.startsWith("l.");
    const catalogId = attrs?.playParams?.catalogId || null;

    // Extract artist relationship objects
    const artistData = item.relationships?.artists?.data || [];
    const artists = artistData.length
      ? artistData.map((a) => ({
          id: a.id,
          name: a.attributes?.name || attrs.artistName || "Unknown",
        }))
      : attrs.artistName
      ? [{ id: null, name: attrs.artistName }]
      : [];

    return {
      id: `apple:${catalogId || id}`,
      provider: "apple",
      providerId: id,
      isLibrary,
      catalogId,
      name: attrs.name || "",
      artists,
      album: attrs.albumName || "",
      durationMs: attrs.durationInMillis || null,
      artworkUrl: art,
    };
  } catch (err) {
    console.warn("[normalize.appleSong] failed", err.message);
    return null;
  }
}

// Optional: for album tracks
export function mapAppleAlbumTrack(t) {
  if (!t?.id) return null;
  const attrs = t.attributes || {};
  const artistData = t.relationships?.artists?.data || [];
  const artists = artistData.length
    ? artistData.map((a) => ({
        id: a.id,
        name: a.attributes?.name || attrs.artistName || "Unknown",
      }))
    : attrs.artistName
    ? [{ id: null, name: attrs.artistName }]
    : [];

  return {
    id: `apple:${t.id}`,
    name: attrs.name || "",
    artists,
    durationMs: attrs.durationInMillis || null,
  };
}
