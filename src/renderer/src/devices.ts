import { useEffect, useState } from 'react'
import type { BackgroundConfig } from '@shared/types'
import { renderBackground } from './studio/background'

export interface Devices {
  cameras: MediaDeviceInfo[]
  mics: MediaDeviceInfo[]
}

export function useDevices(): Devices {
  const [d, setD] = useState<Devices>({ cameras: [], mics: [] })
  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      let list = await navigator.mediaDevices.enumerateDevices()
      if (list.some((x) => !x.label)) {
        // Labels are only exposed after permission has been granted once.
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
          s.getTracks().forEach((t) => t.stop())
        } catch {
          try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true })
            s.getTracks().forEach((t) => t.stop())
          } catch {
            /* no devices */
          }
        }
        list = await navigator.mediaDevices.enumerateDevices()
      }
      if (!alive) return
      setD({
        cameras: list.filter((x) => x.kind === 'videoinput'),
        mics: list.filter((x) => x.kind === 'audioinput' && x.deviceId !== 'communications')
      })
    }
    void load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => {
      alive = false
      navigator.mediaDevices.removeEventListener('devicechange', load)
    }
  }, [])
  return d
}

let lastWallpaperKey: string | null = null
let inflight: { key: string; p: Promise<void> } | null = null

function wallpaperKey(bg: BackgroundConfig, w: number, h: number): string {
  return JSON.stringify({
    w,
    h,
    kind: bg.kind,
    color1: bg.color1,
    color2: bg.color2,
    angle: bg.angle,
    imagePath: bg.imagePath,
    logoPath: bg.logoPath,
    logoPosition: bg.logoPosition,
    logoScale: bg.logoScale,
    text: bg.text,
    textColor: bg.textColor
  })
}

/** Renders the studio background at the primary display's native size and saves it as the clean-desktop wallpaper. */
export async function exportWallpaper(bg: BackgroundConfig): Promise<void> {
  const W = Math.round(window.screen.width * window.devicePixelRatio)
  const H = Math.round(window.screen.height * window.devicePixelRatio)
  const key = wallpaperKey(bg, W, H)
  if (key === lastWallpaperKey) return
  if (inflight?.key === key) return inflight.p
  const p = (async () => {
    const canvas = await renderBackground(bg, W, H)
    await window.api.invoke('wallpaper:save', canvas.toDataURL('image/png'))
    lastWallpaperKey = key
  })()
  inflight = { key, p }
  try {
    await p
  } finally {
    if (inflight?.p === p) inflight = null
  }
}
