import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Settings } from '@shared/types'

const file = (): string => path.join(app.getPath('userData'), 'settings.json')

export function defaultSettings(): Settings {
  return {
    saveFolder: path.join(app.getPath('videos'), 'Loom Clone'),
    cameraDeviceId: '',
    micDeviceId: '',
    cameraEnabled: true,
    micEnabled: true,
    systemAudio: false,
    countdown: true,
    resolution: 1080,
    fps: 30,
    studioForScreen: false,
    studioForWindow: true,
    studioPadding: 0.06,
    cornerRadius: 14,
    background: {
      kind: 'gradient',
      color1: '#4f46e5',
      color2: '#0ea5e9',
      angle: 135,
      imagePath: null,
      logoPath: null,
      logoPosition: 'bottom-right',
      logoScale: 0.12,
      text: '',
      textColor: '#ffffff'
    },
    cleanDesktopEnabled: false,
    cleanDesktop: {
      wallpaper: true,
      hideIcons: true,
      minimizeWindows: true,
      hideTaskbar: false
    },
    maskPasswords: true,
    cropBrowserChrome: true,
    bubble: { x: 0.1, y: 0.82, size: 200 },
    lastMode: 'screen'
  }
}

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  const defaults = defaultSettings()
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8').replace(/^﻿/, ''))
    cache = {
      ...defaults,
      ...raw,
      background: { ...defaults.background, ...(raw.background ?? {}) },
      cleanDesktop: { ...defaults.cleanDesktop, ...(raw.cleanDesktop ?? {}) },
      bubble: { ...defaults.bubble, ...(raw.bubble ?? {}) }
    }
  } catch {
    cache = defaults
  }
  return cache!
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  cache = next
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(next, null, 2))
  return next
}
