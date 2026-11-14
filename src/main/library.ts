import { app, shell } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { mediaUrl, type VideoItem } from '@shared/types'
import { probeAndThumb } from './ffmpeg'

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv', '.mov'])

interface MetaEntry {
  duration: number | null
  thumb: string | null
}

const thumbsDir = (): string => path.join(app.getPath('userData'), 'thumbs')
const metaFile = (): string => path.join(thumbsDir(), 'index.json')

let meta: Record<string, MetaEntry> | null = null
function loadMeta(): Record<string, MetaEntry> {
  if (meta) return meta
  try {
    meta = JSON.parse(fs.readFileSync(metaFile(), 'utf8'))
  } catch {
    meta = {}
  }
  return meta!
}
function saveMeta(): void {
  fs.mkdirSync(thumbsDir(), { recursive: true })
  fs.writeFileSync(metaFile(), JSON.stringify(meta ?? {}))
}

const keyFor = (p: string, mtime: number, size: number): string =>
  crypto.createHash('sha1').update(`${p}|${mtime}|${size}`).digest('hex')

function toItem(p: string, st: fs.Stats): VideoItem {
  const m = loadMeta()[keyFor(p, st.mtimeMs, st.size)]
  return {
    path: p,
    name: path.basename(p, path.extname(p)),
    size: st.size,
    createdAt: st.birthtimeMs || st.mtimeMs,
    duration: m?.duration ?? null,
    thumb: m?.thumb ? mediaUrl(m.thumb) : null
  }
}

const pending = new Set<string>()
let running = 0
const queue: Array<() => Promise<void>> = []
function enqueue(job: () => Promise<void>): void {
  queue.push(job)
  pump()
}
function pump(): void {
  while (running < 2 && queue.length) {
    const job = queue.shift()!
    running++
    job().finally(() => {
      running--
      pump()
    })
  }
}

export async function listVideos(folder: string, onItem: (item: VideoItem) => void): Promise<VideoItem[]> {
  let names: string[] = []
  try {
    names = await fs.promises.readdir(folder)
  } catch {
    return []
  }
  const items: VideoItem[] = []
  for (const n of names) {
    if (!VIDEO_EXT.has(path.extname(n).toLowerCase())) continue
    const p = path.join(folder, n)
    let st: fs.Stats
    try {
      st = await fs.promises.stat(p)
    } catch {
      continue
    }
    if (!st.isFile() || st.size === 0) continue
    const item = toItem(p, st)
    items.push(item)
    const key = keyFor(p, st.mtimeMs, st.size)
    if (!loadMeta()[key] && !pending.has(key)) {
      pending.add(key)
      enqueue(async () => {
        const thumb = path.join(thumbsDir(), `${key}.jpg`)
        fs.mkdirSync(thumbsDir(), { recursive: true })
        const r = await probeAndThumb(p, thumb)
        loadMeta()[key] = { duration: r.duration, thumb: r.ok ? thumb : null }
        saveMeta()
        pending.delete(key)
        onItem(toItem(p, st))
      })
    }
  }
  items.sort((a, b) => b.createdAt - a.createdAt)
  return items
}

function assertInside(folder: string, p: string): void {
  const rel = path.relative(path.resolve(folder), path.resolve(p))
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('File is outside the save folder')
}

export async function deleteVideo(folder: string, p: string): Promise<void> {
  assertInside(folder, p)
  await shell.trashItem(p)
}

export async function renameVideo(folder: string, p: string, newName: string): Promise<string> {
  assertInside(folder, p)
  const clean = newName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim()
  if (!clean) throw new Error('Name is empty')
  const target = path.join(path.dirname(p), clean + path.extname(p))
  if (target === p) return p
  if (fs.existsSync(target)) throw new Error('A video with that name already exists')
  await fs.promises.rename(p, target)
  return target
}

export function watchFolder(folder: string, onChange: () => void): () => void {
  let timer: NodeJS.Timeout | null = null
  let watcher: fs.FSWatcher | null = null
  try {
    fs.mkdirSync(folder, { recursive: true })
    watcher = fs.watch(folder, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(onChange, 800)
    })
  } catch {
    /* folder may be unavailable */
  }
  return () => {
    if (timer) clearTimeout(timer)
    watcher?.close()
  }
}
