/**
 * Rasterizes the Rekoto mark (charcoal plate + gold R + red record dot) into PNG/ICO assets.
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

function inRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1
}

/** Geometric capital R in normalized 0..1 box coords relative to icon. */
function inLetterR(x, y, size) {
  const L = size * 0.29
  const T = size * 0.26
  const W = size * 0.42
  const H = size * 0.48
  const stem = W * 0.22
  const bowlH = H * 0.46
  const bowlR = bowlH * 0.55
  const nx = (x - L) / W
  const ny = (y - T) / H
  if (nx < 0 || nx > 1.05 || ny < 0 || ny > 1) return false

  // Stem
  if (nx <= stem / W + 0.02) return true

  // Upper bowl (rounded D attached to stem)
  const bx = nx - stem / W
  const by = ny
  if (by <= bowlH / H) {
    const cx = stem / W + 0.28
    const cy = bowlH / H / 2
    const rx = 0.34
    const ry = bowlH / H / 2
    const dx = (nx - cx) / rx
    const dy = (ny - cy) / ry
    if (nx >= stem / W && dx * dx + dy * dy <= 1) {
      // hollow inner
      const irx = rx * 0.45
      const iry = ry * 0.55
      const idx = (nx - cx) / irx
      const idy = (ny - cy) / iry
      if (nx > stem / W + 0.12 && idx * idx + idy * idy <= 1) return false
      return true
    }
    // fill bar connecting stem to bowl
    if (nx < cx && by > 0.08 && by < bowlH / H - 0.08) return true
  }

  // Diagonal leg
  const legStartY = bowlH / H - 0.02
  if (ny >= legStartY) {
    const t = (ny - legStartY) / (1 - legStartY)
    const center = stem / W + 0.08 + t * 0.55
    const thickness = 0.11 + t * 0.02
    if (Math.abs(nx - center) <= thickness) return true
  }
  return false
}

function paint(size) {
  const data = new Uint8Array(size * size * 4)
  const plateR = size * 0.22
  const recCx = size * 0.72
  const recCy = size * 0.72
  const recR = size * 0.07
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

      if (inLetterR(x, y, size)) {
        const t = Math.min(1, dist(x, y, size * 0.45, size * 0.45) / (size * 0.45))
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
// Window / tab favicon for the Electron renderer
write(join(root, 'src', 'renderer', 'public', 'favicon.ico'), ico)
write(join(root, 'src', 'renderer', 'public', 'favicon.png'), pngs.get(32))
write(join(root, 'src', 'renderer', 'public', 'icon-192.png'), pngs.get(128))

for (const browser of ['chrome', 'firefox']) {
  for (const size of [16, 32, 48, 128]) {
    write(join(root, 'extensions', browser, 'icons', `${size}.png`), pngs.get(size))
  }
}

// Remove old Capora asset names if present
for (const old of ['assets/capora-logo.png', 'assets/Capora-Desktop.png', 'assets/capora-logo.svg']) {
  const p = join(root, old)
  if (existsSync(p)) unlinkSync(p)
}

console.log('Wrote yellow Rekoto icons: build/icon.ico, favicon, assets/rekoto-logo.png, extension icons')
