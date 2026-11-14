import type { CaptureMode, Layout } from '@shared/types'
import type { FrameSource } from './frames'

export interface CompositorOptions {
  width: number
  height: number
  fps: number
  mode: CaptureMode
  studio: boolean
  padding: number
  radius: number
  background: HTMLCanvasElement
  screen: FrameSource | null
  camera: FrameSource | null
  layout: Layout
  onFrame?: (canvas: HTMLCanvasElement) => void
}

/**
 * Draws one output frame: branded background -> (cropped) screen/window frame -> round camera.
 * Driven by setInterval so it keeps running in a hidden window.
 */
export class Compositor {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private timer: number | null = null
  layout: Layout

  constructor(private o: CompositorOptions) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = o.width
    this.canvas.height = o.height
    this.ctx = this.canvas.getContext('2d', { alpha: false })!
    this.layout = o.layout
  }

  start(): void {
    const tick = (): void => {
      try {
        this.draw()
      } catch {
        /* a source frame can be closed mid-swap; skip this tick */
      }
      this.o.onFrame?.(this.canvas)
    }
    tick()
    this.timer = window.setInterval(tick, 1000 / this.o.fps)
  }

  stop(): void {
    if (this.timer != null) window.clearInterval(this.timer)
    this.timer = null
  }

  private draw(): void {
    const { ctx } = this
    const W = this.canvas.width
    const H = this.canvas.height
    const { screen, camera, mode, studio } = this.o

    if (mode === 'camera' || studio || !screen) ctx.drawImage(this.o.background, 0, 0, W, H)
    else {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
    }

    if (mode === 'camera') {
      if (camera?.frame) this.drawCameraFull(camera.frame, camera.width, camera.height, W, H)
      return
    }

    if (screen?.frame) {
      const img = screen.frame
      const vw = screen.width
      const vh = screen.height
      const c = this.layout.crop
      const sx = c ? c.x * vw : 0
      const sy = c ? c.y * vh : 0
      const sw = c ? c.w * vw : vw
      const sh = c ? c.h * vh : vh
      const pad = studio ? Math.round(H * this.o.padding) : 0
      const s = Math.min((W - pad * 2) / sw, (H - pad * 2) / sh)
      const dw = sw * s
      const dh = sh * s
      const dx = (W - dw) / 2
      const dy = (H - dh) / 2
      if (studio) {
        const r = this.o.radius * (H / 1080)
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.35)'
        ctx.shadowBlur = H * 0.03
        ctx.shadowOffsetY = H * 0.008
        ctx.fillStyle = '#000'
        ctx.beginPath()
        ctx.roundRect(dx, dy, dw, dh, r)
        ctx.fill()
        ctx.restore()
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(dx, dy, dw, dh, r)
        ctx.clip()
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
        ctx.restore()
      } else {
        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
      }
    }

    const cam = this.layout.camera
    if (camera?.frame && cam) {
      const d = Math.max(40, cam.size * H)
      const cx = Math.min(W - d / 2, Math.max(d / 2, cam.x * W))
      const cy = Math.min(H - d / 2, Math.max(d / 2, cam.y * H))
      this.drawCameraCircle(camera.frame, camera.width, camera.height, cx, cy, d)
    }
  }

  private drawCameraCircle(v: VideoFrame, vw: number, vh: number, cx: number, cy: number, d: number): void {
    const { ctx } = this
    const side = Math.min(vw, vh)
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = d * 0.08
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, d / 2 - Math.max(2, d * 0.015), 0, Math.PI * 2)
    ctx.clip()
    // Mirror like a selfie view so it matches the on-screen bubble.
    ctx.translate(cx, cy)
    ctx.scale(-1, 1)
    ctx.drawImage(v, (vw - side) / 2, (vh - side) / 2, side, side, -d / 2, -d / 2, d, d)
    ctx.restore()
  }

  private drawCameraFull(v: VideoFrame, vw: number, vh: number, W: number, H: number): void {
    const { ctx } = this
    const pad = Math.round(H * 0.05)
    const s = Math.min((W - pad * 2) / vw, (H - pad * 2) / vh)
    const dw = vw * s
    const dh = vh * s
    const dx = (W - dw) / 2
    const dy = (H - dh) / 2
    const r = 24 * (H / 1080)
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = H * 0.03
    ctx.beginPath()
    ctx.roundRect(dx, dy, dw, dh, r)
    ctx.fillStyle = '#000'
    ctx.fill()
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(dx, dy, dw, dh, r)
    ctx.clip()
    ctx.translate(dx + dw, dy)
    ctx.scale(-1, 1)
    ctx.drawImage(v, 0, 0, dw, dh)
    ctx.restore()
  }
}
