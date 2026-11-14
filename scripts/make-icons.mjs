/**
 * Rasterizes the Rekoto mark: charcoal plate + gold video-camera (app icon) + red record dot.
 * Camera geometry matches Icon.tsx `camera`: body rect + right-side wedge.
 */
import { deflateSync } from 'zlib'
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function clamp(n) {
  return Math.max(0, Math.min(255, n | 0))
}

function mix(a, b, t) {
  return [
    clamp(a[0] + (b[0] - a[0]) * t),
    clamp(a[1] + (b[1] - a[1]) * t),
    clamp(a[2] + (b[2] - a[2]) * t),
    clamp(a[3] + (b[3] - a[3]) * t)
  ]
}

function dist(x, y, cx, cy) {
  return Math.hypot(x - cx, y - cy)
}

function insideRoundedRect(x, y, size, radius) {
  const cx = Math.max(radius, Math.min(size - 1 - radius, x))
  const cy = Math.max(radius, Math.min(size - 1 - radius, y))
  return dist(x, y, cx, cy) <= radius + 0.5
}

/** Point-in-triangle (barycentric). */
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const v0x = cx - ax
  const v0y = cy - ay
  const v1x = bx - ax
  const v1y = by - ay
  const v2x = px - ax
  const v2y = py - ay
  const dot00 = v0x * v0x + v0y * v0y
  const dot01 = v0x * v1x + v0y * v1y
  const dot02 = v0x * v2x + v0y * v2y
  const dot11 = v1x * v1x + v1y * v1y
  const dot12 = v1x * v2x + v1y * v2y
  const inv = 1 / (dot00 * dot11 - dot01 * dot01)
  const u = (dot11 * dot02 - dot01 * dot12) * inv
  const v = (dot00 * dot12 - dot01 * dot02) * inv
  return u >= 0 && v >= 0 && u + v <= 1
}

/**
 * App camera icon in a 24×24 viewBox, mapped into the icon with padding.
 * Body: (3,6)-(15,18)  Wedge: (15,10)-(20,7)-(20,17)
 */
function inCamera(x, y, size) {
  const pad = size * 0.18
  const s = (size - pad * 2) / 24
  const ox = pad
  const oy = pad
  const toX = (vx) => ox + vx * s
  const toY = (vy) => oy + vy * s

  const x0 = toX(3)
  const y0 = toY(6)
  const x1 = toX(15)
  const y1 = toY(18)
  // Slightly round the body corners for a friendlier app-icon look
  const br = size * 0.035
  if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
    const lx = x < x0 + br ? x0 + br : x > x1 - br ? x1 - br : x
    const ly = y < y0 + br ? y0 + br : y > y1 - br ? y1 - br : y
    if (dist(x, y, lx, ly) <= br + 0.5 || (x >= x0 + br && x <= x1 - br) || (y >= y0 + br && y <= y1 - br)) {
      // Exclude only outside the rounded-rect corner circles
      const inCornerZone = (x < x0 + br || x > x1 - br) && (y < y0 + br || y > y1 - br)
      if (!inCornerZone || dist(x, y, lx, ly) <= br + 0.5) return true
    }
  }

  return inTriangle(x, y, toX(15), toY(10), toX(20), toY(7), toX(20), toY(17))
}

function paint(size) {
  const data = new Uint8Array(size * size * 4)
  const plateR = size * 0.22
  const recCx = size * 0.26
  const recCy = size * 0.74
  const recR = size * 0.055
  const plateA = [42, 36, 24, 255]
  const plateB = [15, 14, 12, 255]
  const goldA = [255, 229, 102, 255]
  const goldB = [212, 160, 23, 255]
  const red = [220, 38, 38, 255]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (!insideRoundedRect(x, y, size, plateR)) {
        data[i + 3] = 0
        continue
      }
      const gt = (x + y) / (2 * Math.max(1, size - 1))
      let c = mix(plateA, plateB, gt * 0.9 + 0.1)

      if (inCamera(x, y, size)) {
        const t = Math.min(1, dist(x, y, size * 0.42, size * 0.5) / (size * 0.4))
        c = mix(goldA, goldB, t * t)
      }

      if (dist(x, y, recCx, recCy) <= recR) c = red

      data[i] = c[0]
      data[i + 1] = c[1]
      data[i + 2] = c[2]
      data[i + 3] = c[3]
    }
  }
  return data
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type)
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function encodeIco(images) {
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  const entries = []
  const blobs = []
  let offset = 6 + count * 16
  for (const img of images) {
    const entry = Buffer.alloc(16)
    entry[0] = img.size >= 256 ? 0 : img.size
    entry[1] = img.size >= 256 ? 0 : img.size
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(img.png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    blobs.push(img.png)
    offset += img.png.length
  }
  return Buffer.concat([header, ...entries, ...blobs])
}

function write(path, buf) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buf)
}

const sizes = [16, 24, 32, 48, 64, 128, 256, 512]
const pngs = new Map()
for (const size of sizes) pngs.set(size, encodePng(size, paint(size)))

const ico = encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: pngs.get(size) })))
write(join(root, 'build', 'icon.png'), pngs.get(512))
write(join(root, 'build', 'icon.ico'), ico)
write(join(root, 'assets', 'rekoto-logo.png'), pngs.get(512))
write(join(root, 'assets', 'Rekoto-Desktop.png'), pngs.get(256))
write(join(root, 'src', 'renderer', 'public', 'favicon.ico'), ico)
write(join(root, 'src', 'renderer', 'public', 'favicon.png'), pngs.get(32))
write(join(root, 'src', 'renderer', 'public', 'icon-192.png'), pngs.get(128))

for (const browser of ['chrome', 'firefox']) {
  for (const size of [16, 32, 48, 128]) {
    write(join(root, 'extensions', browser, 'icons', `${size}.png`), pngs.get(size))
  }
}

for (const old of ['assets/capora-logo.png', 'assets/Capora-Desktop.png', 'assets/capora-logo.svg']) {
  const p = join(root, old)
  if (existsSync(p)) unlinkSync(p)
}

console.log('Wrote Rekoto camera icons: build/icon.ico, favicon, assets/rekoto-logo.png')
