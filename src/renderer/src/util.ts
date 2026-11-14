export function formatDuration(sec: number | null): string {
  if (sec == null || !isFinite(sec)) return '--:--'
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = String(m).padStart(h ? 2 : 1, '0')
  return `${h ? h + ':' : ''}${mm}:${String(r).padStart(2, '0')}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const units: Array<[number, string]> = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
    [2629800, 'month'],
    [31557600, 'year']
  ]
  let label = 'minute'
  let size = 60
  for (const [u, l] of units) if (s >= u) {
    size = u
    label = l
  }
  const n = Math.floor(s / size)
  return `${n} ${label}${n === 1 ? '' : 's'} ago`
}

/** Short duration for badges: "45 sec", "5 min", "1 h 12 min". */
export function formatMinutes(sec: number | null): string {
  if (sec == null || !isFinite(sec)) return '–'
  if (sec < 60) return `${Math.max(1, Math.round(sec))} sec`
  const m = Math.round(sec / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}
