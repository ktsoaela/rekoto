import { protocol } from 'electron'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { MEDIA_SCHEME } from '@shared/types'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp'
}

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true }
    }
  ])
}

/** Serves local images and videos with HTTP range support so <video> can seek. */
export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const p = new URL(req.url).searchParams.get('p')
    if (!p) return new Response('missing path', { status: 400 })
    const mime = MIME[path.extname(p).toLowerCase()]
    if (!mime) return new Response('unsupported type', { status: 403 })
    let size: number
    try {
      size = (await fs.promises.stat(p)).size
    } catch {
      return new Response('not found', { status: 404 })
    }
    const base = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' }
    const range = req.headers.get('range')
    const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (m && size > 0) {
      let start = m[1] ? Number(m[1]) : 0
      let end = m[2] ? Number(m[2]) : size - 1
      if (!m[1] && m[2]) {
        start = Math.max(0, size - Number(m[2]))
        end = size - 1
      }
      end = Math.min(end, size - 1)
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      const body = Readable.toWeb(fs.createReadStream(p, { start, end })) as ReadableStream
      return new Response(body, {
        status: 206,
        headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
      })
    }
    const body = Readable.toWeb(fs.createReadStream(p)) as ReadableStream
    return new Response(body, { status: 200, headers: { ...base, 'Content-Length': String(size) } })
  })
}
