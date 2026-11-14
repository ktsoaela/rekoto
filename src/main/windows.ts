import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import path from 'path'

export type Route = 'main' | 'recorder' | 'bubble' | 'controls' | 'countdown'

export function createRouteWindow(route: Route, opts: BrowserWindowConstructorOptions = {}): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    backgroundColor: opts.transparent ? '#00000000' : '#0f1117',
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
