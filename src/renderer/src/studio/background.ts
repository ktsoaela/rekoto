import { mediaUrl, type BackgroundConfig } from '@shared/types'

const imageCache = new Map<string, Promise<HTMLImageElement | null>>()

export function loadImage(p: string | null): Promise<HTMLImageElement | null> {
  if (!p) return Promise.resolve(null)
  let cached = imageCache.get(p)
  if (!cached) {
    cached = new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = mediaUrl(p)
    })
    imageCache.set(p, cached)
  }
  return cached
}

function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource, iw: number, ih: number, W: number, H: number): void {
  const s = Math.max(W / iw, H / ih)
  const w = iw * s
  const h = ih * s
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
}

/** Renders the branded studio background (gradient/solid/image + logo + text) at the given size. */
export async function renderBackground(cfg: BackgroundConfig, W: number, H: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  const [bgImg, logo] = await Promise.all([cfg.kind === 'image' ? loadImage(cfg.imagePath) : null, loadImage(cfg.logoPath)])

  if (cfg.kind === 'image' && bgImg) {
    drawCover(ctx, bgImg, bgImg.naturalWidth, bgImg.naturalHeight, W, H)
  } else if (cfg.kind === 'solid') {
    ctx.fillStyle = cfg.color1
    ctx.fillRect(0, 0, W, H)
  } else {
    const a = ((cfg.angle - 90) * Math.PI) / 180
    const r = Math.hypot(W, H) / 2
    const cx = W / 2
    const cy = H / 2
    const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    g.addColorStop(0, cfg.color1)
    g.addColorStop(1, cfg.color2)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  const margin = Math.round(H * 0.035)
  if (logo) {
    const lw = Math.max(8, W * cfg.logoScale)
    const lh = (logo.naturalHeight / logo.naturalWidth) * lw
    let x = margin
    let y = margin
    if (cfg.logoPosition.endsWith('right')) x = W - lw - margin
    if (cfg.logoPosition.startsWith('bottom')) y = H - lh - margin
    if (cfg.logoPosition === 'center') {
      x = (W - lw) / 2
      y = (H - lh) / 2
    }
    ctx.drawImage(logo, x, y, lw, lh)
  }

  if (cfg.text.trim()) {
    const size = Math.round(H * 0.03)
    ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`
    ctx.fillStyle = cfg.textColor
    ctx.textBaseline = 'top'
    const right = cfg.logoPosition.endsWith('left')
    ctx.textAlign = right ? 'right' : 'left'
    ctx.fillText(cfg.text, right ? W - margin : margin, margin)
  }
  return canvas
}
