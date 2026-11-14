/** Pure helpers for recovering the user's wallpaper after clean-desktop mode. */

export type WallpaperRef = {
  path: string
  style: string
  tile: string
  source?: string
}

const isOurs = (p: string): boolean => /studio-wallpaper/i.test(p)
const isTranscoded = (p: string): boolean => /TranscodedWallpaper/i.test(p)
const usable = (p: string | undefined | null): p is string => !!p && p.trim().length > 0

/**
 * Pick a wallpaper file to restore. Never returns empty when a backup or Windows
 * history path is still available — an empty path used to clear the desktop.
 *
 * `exists` must reflect the real filesystem for path/source. Backup and history
 * lists should already be filtered to files that exist.
 */
export function resolveWallpaperTarget(
  wallpaper: WallpaperRef | null,
  existingBackups: string[],
  historyPaths: string[],
  exists: (p: string) => boolean = () => true
): WallpaperRef | null {
  if (!wallpaper) return null
  const style = wallpaper.style || '10'
  const tile = wallpaper.tile || '0'
  const src = usable(wallpaper.source) ? wallpaper.source.trim() : ''
  const path = usable(wallpaper.path) ? wallpaper.path.trim() : ''

  if (src && !isOurs(src) && !isTranscoded(src) && exists(src)) {
    return { path: src, style, tile, source: src }
  }
  if (path && !isOurs(path) && exists(path)) {
    return { path, style, tile, source: src || path }
  }
  for (const b of existingBackups) {
    if (usable(b) && !isOurs(b)) return { path: b, style, tile, source: src || b }
  }
  // Empty path+source: solid colour, or a failed prior restore that left no meta.
  // Only our backup file is authoritative here — Windows history may still list old images.
  if (!path && !src) return { path: '', style, tile, source: '' }
  for (const h of historyPaths) {
    if (usable(h) && !isOurs(h) && !isTranscoded(h)) return { path: h, style, tile, source: h }
  }
  // Path pointed at a missing/ours file with no recovery — skip restore rather than clear.
  return null
}

/** List backup image paths under the clean-desktop dir (not the .json meta). */
export function listWallpaperBackups(names: string[], dir: string, join: (a: string, b: string) => string): string[] {
  return names
    .filter((n) => /^original-wallpaper\./i.test(n) && !/\.json$/i.test(n))
    .map((n) => join(dir, n))
}
