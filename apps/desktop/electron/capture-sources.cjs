/**
 * Picker entries for desktopCapturer sources. A display carries its own native size in physical pixels
 * (logical size × scale factor), so each monitor of a mixed setup shows its real resolution. A window's
 * size is only known once captured; the renderer measures it from the live track.
 */
function describeSources(sources, displays) {
  return sources.map(source => {
    const display = source.id.startsWith('screen:');
    const match = display ? displays.find(item => source.display_id && String(item.id) === String(source.display_id)) : undefined;
    const size = match && match.size && match.size.width > 0 && match.size.height > 0
      ? { width: Math.round(match.size.width * (match.scaleFactor || 1)), height: Math.round(match.size.height * (match.scaleFactor || 1)) }
      : {};
    return { id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL(), display, ...size };
  });
}

module.exports = { describeSources };
