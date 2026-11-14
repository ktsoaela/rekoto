import { useEffect, useRef } from 'react'
import type { BackgroundConfig } from '@shared/types'
import { renderBackground } from '../studio/background'

/** Live preview of the studio background with a mock window and camera bubble. */
export default function BackgroundPreview({ bg, small }: { bg: BackgroundConfig; small?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let alive = true
    const W = 640
    const H = 360
    void renderBackground(bg, W, H).then((src) => {
      const c = ref.current
      if (!alive || !c) return
      const ctx = c.getContext('2d')!
      ctx.drawImage(src, 0, 0)
      const pad = H * 0.06
      const ww = W - pad * 2
      const wh = H - pad * 2
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,.35)'
      ctx.shadowBlur = 12
      ctx.fillStyle = '#f4f5f7'
      ctx.beginPath()
      ctx.roundRect(pad, pad, ww, wh, 8)
      ctx.fill()
      ctx.restore()
      ctx.fillStyle = '#d9dce3'
      for (let i = 0; i < 5; i++) ctx.fillRect(pad + 24, pad + 30 + i * 26, ww * (0.7 - i * 0.08), 10)
      ctx.fillStyle = '#9aa3b5'
      ctx.beginPath()
      ctx.arc(pad + 48, H - pad - 48, 34, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 3
      ctx.stroke()
    })
    return () => {
      alive = false
    }
  }, [bg])
  return <canvas ref={ref} width={640} height={360} className={`bg-preview ${small ? 'small' : ''}`} />
}
