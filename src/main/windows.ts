import { BrowserWindow, nativeImage, type BrowserWindowConstructorOptions, type NativeImage } from 'electron'
import path from 'path'
import fs from 'fs'

export type Route = 'main' | 'recorder' | 'bubble' | 'controls' | 'countdown'

function appIcon(): NativeImage | undefined {
  const candidates = [
    path.join(process.resourcesPath, 'build', 'icon.ico'),
    path.join(__dirname, '../../build/icon.ico'),
    path.join(__dirname, '../../build/icon.png'),
    path.join(process.cwd(), 'build/icon.ico'),
    path.join(process.cwd(), 'build/icon.png')
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    const img = nativeImage.createFromPath(file)
    if (!img.isEmpty()) return img
  }
  return undefined
}

export function createRouteWindow(route: Route, opts: BrowserWindowConstructorOptions = {}): BrowserWindow {
  const icon = opts.icon ?? appIcon()
  const win = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    backgroundColor: opts.transparent ? '#00000000' : '#0f1117',
    ...(icon ? { icon } : {}),
    ...opts,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      ...(opts.webPreferences ?? {})
    }
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(`${devUrl}#${route}`)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: route })
  return win
}

/** Excludes a window from screen capture (Windows 10 2004+), so overlays never appear in recordings. */
export function hideFromCapture(win: BrowserWindow): void {
  try {
    win.setContentProtection(true)
  } catch {
    /* unsupported */
  }
}
