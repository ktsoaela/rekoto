import { BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, type Display } from 'electron'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { CameraLayout, Layout, RecState, Rect, StartOptions, ViewportInfo } from '@shared/types'
import { getSettings, updateSettings } from './settings'
import { applyCleanDesktop, restoreCleanDesktop, wallpaperFile, type CleanState } from './clean-desktop'
import { toMp4 } from './ffmpeg'
import { broadcastState, type BrowserName } from './native-bridge'
import { createRouteWindow, hideFromCapture } from './windows'

const BROWSER_TITLE = /(Google Chrome|Mozilla Firefox|Microsoft​? Edge)\s*$/

interface Track {
  browser: BrowserName | null
  title: string
}

interface Session {
  options: StartOptions
  tmpPath: string
  out: fs.WriteStream
  mime: string
  display: Display
  layout: Layout
  track: Track | null
  clean: CleanState | null
  recorder: BrowserWindow | null
  bubble: BrowserWindow | null
  controls: BrowserWindow | null
  countdown: BrowserWindow | null
  ready: Deferred<string>
  started: Deferred<void>
  finished: Deferred<void>
  canceled: boolean
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: Error) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  promise.catch(() => undefined)
  return { promise, resolve, reject }
}
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))])
}
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function hwndOf(sourceId: string): number | null {
  const m = /^window:(\d+):/.exec(sourceId)
  return m ? Number(m[1]) : null
}

function clampRect(r: Rect): Rect | null {
  const x = Math.max(0, Math.min(1, r.x))
  const y = Math.max(0, Math.min(1, r.y))
  const w = Math.min(1 - x, r.w - (x - r.x))
  const h = Math.min(1 - y, r.h - (y - r.y))
  return w > 0.05 && h > 0.05 ? { x, y, w, h } : null
}

function fileStamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
}

export class RecordingManager {
  state: RecState = { status: 'idle', startedAt: null, pausedMs: 0, pausedAt: null, error: null, lastSaved: null }
  private s: Session | null = null
  /** Source the next getDisplayMedia call should resolve to. */
  pendingSource: { id: string; audio: boolean } | null = null

  constructor(
    private getMainWindow: () => BrowserWindow | null,
    private onSaved: (file: string) => void
  ) {
    this.registerIpc()
  }

  get active(): boolean {
    return this.state.status !== 'idle'
  }

  private setState(patch: Partial<RecState>): void {
    this.state = { ...this.state, ...patch }
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('rec:state', this.state)
    const settings = getSettings()
    const rec = this.state.status === 'recording' || this.state.status === 'paused' || this.state.status === 'countdown'
    broadcastState({
      recording: rec,
      paused: this.state.status === 'paused',
      mask: settings.maskPasswords && (rec || this.state.status === 'preparing'),
      trackTitle: this.s?.track?.title ?? null,
      trackBrowser: this.s?.track?.browser ?? null
    })
  }

  private registerIpc(): void {
    ipcMain.handle('recorder:config', () => {
      if (!this.s) throw new Error('No active recording')
      return { options: this.s.options, settings: getSettings(), layout: this.s.layout }
    })
    ipcMain.handle('recorder:ready', (_e, mime: string) => this.s?.ready.resolve(mime))
    ipcMain.handle('recorder:started', () => this.s?.started.resolve())
    ipcMain.handle('recorder:chunk', (_e, data: ArrayBuffer) => {
      if (this.s && !this.s.out.destroyed) this.s.out.write(Buffer.from(data))
    })
    ipcMain.handle('recorder:finished', () => this.s?.finished.resolve())
    ipcMain.handle('recorder:error', (_e, msg: string) => {
      if (!this.s) return
      const err = new Error(msg)
      this.s.ready.reject(err)
      if (this.state.status === 'recording' || this.state.status === 'paused') void this.fail(err)
    })
    ipcMain.handle('bubble:config', () => ({ cameraDeviceId: getSettings().cameraDeviceId, mode: this.s?.options.mode }))
    ipcMain.handle('bubble:size', (_e, size: number) => {
      const b = this.s?.bubble
      if (!b) return
      const old = b.getBounds()
      const cx = old.x + old.width / 2
      const cy = old.y + old.height / 2
      b.setBounds({ x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), width: size, height: size })
      this.updateCamera()
    })
    ipcMain.handle('controls:action', (_e, action: 'pause' | 'resume' | 'stop' | 'cancel') => this.control(action))
  }

  control(action: 'pause' | 'resume' | 'stop' | 'cancel' | 'toggle-pause'): Promise<void> | void {
    if (action === 'toggle-pause') action = this.state.status === 'paused' ? 'resume' : 'pause'
    if (action === 'pause') return this.pause()
    if (action === 'resume') return this.resume()
    if (action === 'stop') return this.stop()
    if (action === 'cancel') return this.stop(true)
  }

  async start(options: StartOptions, from?: { browser: BrowserName; title: string; info: ViewportInfo | null }): Promise<void> {
    if (this.active) throw new Error('A recording is already in progress')
    const settings = getSettings()
    updateSettings({ lastMode: options.mode })
    this.setState({ status: 'preparing', error: null, startedAt: null, pausedMs: 0, pausedAt: null })

    const tmpDir = path.join(app.getPath('userData'), 'tmp')
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmpPath = path.join(tmpDir, `rec-${Date.now()}.webm`)

    let display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    if (options.mode === 'screen' && options.sourceId) {
      const src = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })).find(
        (x) => x.id === options.sourceId
      )
      display = screen.getAllDisplays().find((d) => String(d.id) === src?.display_id) ?? display
    }

    let track: Track | null = null
    if (from) track = { browser: from.browser, title: from.title }
    else if (options.mode === 'window' && options.sourceName && BROWSER_TITLE.test(options.sourceName))
      track = { browser: null, title: options.sourceName }

    const s: Session = {
      options,
      tmpPath,
      out: fs.createWriteStream(tmpPath),
      mime: '',
      display,
      layout: { crop: null, camera: null },
      track,
      clean: null,
      recorder: null,
      bubble: null,
      controls: null,
      countdown: null,
      ready: deferred<string>(),
      started: deferred<void>(),
      finished: deferred<void>(),
      canceled: false
    }
    this.s = s
    if (from?.info) s.layout.crop = this.computeCrop(from.info)

    try {
      this.getMainWindow()?.hide()

      if (options.cleanDesktop) {
        const keep = options.keepWindowIds.map(hwndOf).filter((n): n is number => n != null)
        if (options.mode === 'window' && options.sourceId) {
          const h = hwndOf(options.sourceId)
          if (h) keep.push(h)
        }
        try {
          s.clean = await applyCleanDesktop(settings.cleanDesktop, wallpaperFile(), keep)
        } catch (e) {
          console.error('clean desktop failed', e)
        }
      }

      if (options.camera) s.bubble = this.createBubble(display, options.mode === 'camera')
      s.layout.camera = options.camera && options.mode !== 'camera' && s.bubble ? this.cameraFromBubble(s.bubble) : null

      this.pendingSource = options.sourceId ? { id: options.sourceId, audio: options.systemAudio } : null
      s.recorder = this.createRecorderWindow(display)
      s.recorder.on('closed', () => {
        if (this.s === s) s.recorder = null
      })
      s.mime = await withTimeout(s.ready.promise, 25_000, 'Recorder did not start (camera, microphone or screen unavailable)')

      if (settings.countdown) {
        this.setState({ status: 'countdown' })
        s.countdown = this.createCountdown(display)
        await wait(3000)
      }
      if (this.s !== s) return

      // The encoder needs a moment to spin up; keep the countdown on screen until it really records,
      // so the first words after "1" are not cut off.
      s.recorder?.webContents.send('recorder:command', 'begin')
      await withTimeout(s.started.promise, 8000, 'The video encoder did not start').catch((e) => console.error(e))
      if (this.s !== s) return
      s.countdown?.close()
      s.countdown = null
      s.controls = this.createControls(display)
      this.registerShortcuts()
      this.setState({ status: 'recording', startedAt: Date.now(), pausedMs: 0, pausedAt: null })
    } catch (e) {
      await this.fail(e as Error)
      throw e
    }
  }

  private pause(): void {
    if (this.state.status !== 'recording' || !this.s) return
    this.s.recorder?.webContents.send('recorder:command', 'pause')
    this.setState({ status: 'paused', pausedAt: Date.now() })
  }

  private resume(): void {
    if (this.state.status !== 'paused' || !this.s) return
    this.s.recorder?.webContents.send('recorder:command', 'resume')
    const pausedMs = this.state.pausedMs + (Date.now() - (this.state.pausedAt ?? Date.now()))
    this.setState({ status: 'recording', pausedAt: null, pausedMs })
  }

  async stop(cancel = false): Promise<void> {
    const s = this.s
    if (!s || this.state.status === 'processing') return
    if (this.state.status === 'preparing' || this.state.status === 'countdown') {
      await this.fail(new Error('Recording canceled'), true)
      return
    }
    s.canceled = cancel
    this.setState({ status: 'processing' })
    this.unregisterShortcuts()
    s.recorder?.webContents.send('recorder:command', cancel ? 'cancel' : 'stop')
    try {
      await withTimeout(s.finished.promise, 20_000, 'Recorder did not finish')
    } catch (e) {
      console.error(e)
    }
    await new Promise<void>((r) => s.out.end(() => r()))
    await this.teardown(s)

    if (cancel) {
      fs.rmSync(s.tmpPath, { force: true })
      this.s = null
      this.setState({ status: 'idle', startedAt: null })
      this.showMain()
      return
    }

    let saved: string | null = null
    let error: string | null = null
    try {
      const settings = getSettings()
      fs.mkdirSync(settings.saveFolder, { recursive: true })
      let target = path.join(settings.saveFolder, `Recording ${fileStamp()}.mp4`)
      for (let i = 2; fs.existsSync(target); i++) target = path.join(settings.saveFolder, `Recording ${fileStamp()} (${i}).mp4`)
      saved = await toMp4(s.tmpPath, target, /h264|avc1/i.test(s.mime), settings.fps)
      fs.rmSync(s.tmpPath, { force: true })
    } catch (e) {
      error = `Could not save the video: ${(e as Error).message}. The raw recording is kept at ${s.tmpPath}`
    }
    this.s = null
    this.setState({ status: 'idle', startedAt: null, lastSaved: saved, error })
    this.showMain()
    if (saved) this.onSaved(saved)
  }

  private async fail(err: Error, silent = false): Promise<void> {
    const s = this.s
    this.unregisterShortcuts()
    if (s) {
      s.out.destroy()
      await this.teardown(s)
      fs.rmSync(s.tmpPath, { force: true })
    }
    this.s = null
    this.setState({ status: 'idle', startedAt: null, error: silent ? null : err.message })
    this.showMain()
  }

  private async teardown(s: Session): Promise<void> {
    for (const w of [s.countdown, s.controls, s.bubble, s.recorder]) if (w && !w.isDestroyed()) w.destroy()
    s.countdown = s.controls = s.bubble = s.recorder = null
    this.pendingSource = null
    if (s.clean) {
      const c = s.clean
      s.clean = null
      try {
        await restoreCleanDesktop(c)
      } catch (e) {
        console.error('restore failed', e)
      }
    }
  }

  /** Emergency restore when the app quits during a recording. */
  async shutdown(): Promise<void> {
    if (this.s) {
      const s = this.s
      s.out.destroy()
      await this.teardown(s)
    }
  }

  private showMain(): void {
    const w = this.getMainWindow()
    if (w && !w.isDestroyed()) {
      w.show()
      w.focus()
    }
  }

  // ---- browser viewport -> crop ----

  handleViewport(browser: BrowserName, title: string, info: ViewportInfo): void {
    const s = this.s
    if (!s?.track || !getSettings().cropBrowserChrome) return
    if (s.track.browser && s.track.browser !== browser) return
    if (!s.track.browser && !s.track.title.includes(title)) return
    s.track.browser = browser
    const crop = this.computeCrop(info)
    const prev = s.layout.crop
    if (crop && prev && Math.abs(crop.x - prev.x) + Math.abs(crop.y - prev.y) + Math.abs(crop.w - prev.w) + Math.abs(crop.h - prev.h) < 0.002)
      return
    s.layout.crop = crop
    s.recorder?.webContents.send('recorder:layout', s.layout)
  }

  private computeCrop(v: ViewportInfo): Rect | null {
    const s = this.s
    if (!s || !getSettings().cropBrowserChrome || v.outerWidth <= 0 || v.outerHeight <= 0) return null
    const z = v.zoom || 1
    const innerW = v.innerWidth * z
    const innerH = v.innerHeight * z
    const border = Math.max(0, (v.outerWidth - innerW) / 2)
    const topUi = Math.max(0, v.outerHeight - innerH - border)
    if (s.options.mode === 'window') {
      return clampRect({ x: border / v.outerWidth, y: topUi / v.outerHeight, w: innerW / v.outerWidth, h: innerH / v.outerHeight })
    }
    if (s.options.mode === 'screen') {
      const d = s.display.bounds
      return clampRect({ x: (v.screenX + border - d.x) / d.width, y: (v.screenY + topUi - d.y) / d.height, w: innerW / d.width, h: innerH / d.height })
    }
    return null
  }

  // ---- overlay windows ----

  private createBubble(display: Display, large: boolean): BrowserWindow {
    const st = getSettings().bubble
    const size = large ? 360 : Math.max(120, Math.min(420, st.size))
    const b = display.bounds
    const x = large ? b.x + b.width - size - 40 : Math.round(b.x + st.x * b.width - size / 2)
    const y = large ? b.y + b.height - size - 80 : Math.round(b.y + st.y * b.height - size / 2)
    const win = createRouteWindow('bubble', {
      x: Math.max(b.x, Math.min(x, b.x + b.width - size)),
      y: Math.max(b.y, Math.min(y, b.y + b.height - size)),
      width: size,
      height: size,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      focusable: true
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    hideFromCapture(win)
    win.once('ready-to-show', () => win.showInactive())
    const onMove = (): void => this.updateCamera()
    win.on('move', onMove)
    win.on('resize', onMove)
    return win
  }

  private cameraFromBubble(win: BrowserWindow): CameraLayout {
    const b = win.getBounds()
    const s = this.s
    const d = s && s.options.mode === 'screen' ? s.display : screen.getDisplayMatching(b)
    const db = d.bounds
    return {
      x: (b.x + b.width / 2 - db.x) / db.width,
      y: (b.y + b.height / 2 - db.y) / db.height,
      size: b.width / db.height
    }
  }

  private updateCamera(): void {
    const s = this.s
    if (!s?.bubble || s.bubble.isDestroyed() || s.options.mode === 'camera') return
    const cam = this.cameraFromBubble(s.bubble)
    s.layout.camera = cam
    s.recorder?.webContents.send('recorder:layout', s.layout)
    updateSettings({ bubble: { x: cam.x, y: cam.y, size: s.bubble.getBounds().width } })
  }

  /**
   * The compositor needs a window that Chromium actually renders: a hidden window starves timers,
   * frame delivery and the encoder. A 2x2 transparent, click-through, capture-excluded window in
   * the corner is effectively invisible but keeps the pipeline running at full rate.
   */
  private createRecorderWindow(display: Display): BrowserWindow {
    const b = display.bounds
    const win = createRouteWindow('recorder', {
      x: b.x + b.width - 2,
      y: b.y + b.height - 2,
      width: 2,
      height: 2,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      hasShadow: false
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true)
    hideFromCapture(win)
    win.once('ready-to-show', () => win.showInactive())
    return win
  }

  private createControls(display: Display): BrowserWindow {
    const w = 330
    const h = 64
    const b = display.workArea
    const win = createRouteWindow('controls', {
      x: Math.round(b.x + (b.width - w) / 2),
      y: b.y + b.height - h - 24,
      width: w,
      height: h,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    hideFromCapture(win)
    win.once('ready-to-show', () => win.showInactive())
    return win
  }

  private createCountdown(display: Display): BrowserWindow {
    const size = 240
    const b = display.bounds
    const win = createRouteWindow('countdown', {
      x: Math.round(b.x + (b.width - size) / 2),
      y: Math.round(b.y + (b.height - size) / 2),
      width: size,
      height: size,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true)
    hideFromCapture(win)
    win.once('ready-to-show', () => win.showInactive())
    return win
  }

  private registerShortcuts(): void {
    try {
      globalShortcut.register('Alt+Shift+S', () => void this.stop())
      globalShortcut.register('Alt+Shift+P', () => this.control('toggle-pause'))
      globalShortcut.register('Alt+Shift+C', () => void this.stop(true))
    } catch {
      /* shortcut taken by another app */
    }
  }

  private unregisterShortcuts(): void {
    for (const k of ['Alt+Shift+S', 'Alt+Shift+P', 'Alt+Shift+C']) {
      try {
        globalShortcut.unregister(k)
      } catch {
        /* ignore */
      }
    }
  }
}
