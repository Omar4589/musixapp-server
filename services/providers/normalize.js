export function mapAppleSongToCard(item) {
  try {
    const id = item?.id;
    const attrs = item?.attributes || {};
    const artwork = attrs?.artwork;
    const art = artwork
      ? artwork.url.replace("{w}", "400").replace("{h}", "400")
      : null;

    return {
      id: `apple:${id}`,
      provider: "apple",
      providerId: id,
      name: attrs?.name || "",
      artists: attrs?.artistName ? [attrs.artistName] : [],
      album: attrs?.albumName || "",
      durationMs: attrs?.durationInMillis || null,
      artworkUrl: art,
      // You can add `reason` later at row-level, not item-level
    };
  } catch {
    return null;
  }
}
