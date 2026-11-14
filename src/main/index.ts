import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, session, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import type { ExtensionInfo, Settings, SourceInfo, StartOptions, VideoItem } from '@shared/types'
import { getSettings, updateSettings } from './settings'
import { handleMediaProtocol, registerMediaScheme } from './media-protocol'
import { deleteVideo, listVideos, renameVideo, watchFolder } from './library'
import {
  hasPendingRestore,
  restoreCleanDesktop,
  wallpaperFile,
  isSupported as cleanSupported,
  warmCleanDesktop,
  stopCleanDesktopHelper,
  ocrImage
} from './clean-desktop'
import {
  CHROME_EXTENSION_ID,
  FIREFOX_EXTENSION_ID,
  connectedBrowsers,
  extensionFolders,
  hostError,
  hostRegistered,
  registerNativeHost,
  startBridge,
  stopBridge,
  type ExtMessage,
  type ExtStartOptions,
  type Reply
} from './native-bridge'
import { RecordingManager } from './recording'
import { createRouteWindow } from './windows'
import { ffmpegPath } from './ffmpeg'

registerMediaScheme()

// Hardware video encoders hang MediaRecorder on some Windows GPU drivers (no data is ever produced).
// Software encoding is reliable and fast enough for screen recordings; set Rekoto_HW_ENCODE=1 to opt back in.
if (!process.env.Rekoto_HW_ENCODE) app.commandLine.appendSwitch('disable-accelerated-video-encode')
// Windows Graphics Capture can time out waiting for its first frame on a busy PC ("Recorder did not start").
// DXGI desktop duplication is the older, sturdier path for whole screens. REKOTO_WGC=1 restores WGC.
if (!process.env.REKOTO_WGC) app.commandLine.appendSwitch('disable-features', 'AllowWgcScreenCapturer')

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.setAppUserModelId('app.Rekoto.desktop')

let mainWindow: BrowserWindow | null = null
let stopWatching: (() => void) | null = null

function sendMain(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

const recorder = new RecordingManager(
  () => mainWindow,
  (file) => sendMain('library:saved', file)
)

function createMainWindow(): void {
  mainWindow = createRouteWindow('main', {
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Rekoto'
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    if (!recorder.active) app.quit()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function rewatch(): void {
  stopWatching?.()
  stopWatching = watchFolder(getSettings().saveFolder, () => sendMain('library:changed'))
}

/** Last capture sources seen by the Record screen; reused at start to skip a second full scan. */
const sourceCache = new Map<string, Electron.DesktopCapturerSource>()

async function getSources(): Promise<SourceInfo[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 480, height: 270 },
    fetchWindowIcons: true
  })
  sourceCache.clear()
  for (const src of sources) sourceCache.set(src.id, src)
  const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()))
  return sources
    .filter((s) => !own.has(s.id) && s.name !== 'Rekoto')
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      displayId: s.display_id
    }))
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const before = getSettings().saveFolder
    const next = updateSettings(patch)
    if (next.saveFolder !== before) {
      rewatch()
      sendMain('library:changed')
    }
    return next
  })
  ipcMain.handle('dialog:folder', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose where to save recordings',
      defaultPath: getSettings().saveFolder,
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dialog:image', async () => {
    const r = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose an image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('sources:list', () => getSources())
  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    cleanDesktopSupported: cleanSupported(),
    ffmpeg: !!ffmpegPath(),
    version: app.getVersion()
  }))

  ipcMain.handle('rec:start', (_e, opts: StartOptions) => recorder.start(opts))
  ipcMain.handle('rec:state', () => recorder.state)
  ipcMain.handle('rec:control', (_e, action: 'pause' | 'resume' | 'stop' | 'cancel') => recorder.control(action))

  ipcMain.handle('wallpaper:save', (_e, dataUrl: string) => {
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    fs.writeFileSync(wallpaperFile(), Buffer.from(b64, 'base64'))
    return wallpaperFile()
  })

  ipcMain.handle('library:list', () =>
    listVideos(getSettings().saveFolder, (item: VideoItem) => sendMain('library:item', item))
  )
  ipcMain.handle('library:delete', (_e, p: string) => deleteVideo(getSettings().saveFolder, p))
  ipcMain.handle('library:rename', (_e, p: string, name: string) => renameVideo(getSettings().saveFolder, p, name))
  ipcMain.handle('library:reveal', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('library:disk', async () => {
    try {
      const folder = getSettings().saveFolder
      fs.mkdirSync(folder, { recursive: true })
      const st = await fs.promises.statfs(folder)
      return { free: st.bavail * st.bsize, total: st.blocks * st.bsize }
    } catch {
      return null
    }
  })
  ipcMain.handle('library:openFolder', async () => {
    fs.mkdirSync(getSettings().saveFolder, { recursive: true })
    await shell.openPath(getSettings().saveFolder)
  })
  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p))

  ipcMain.handle('ext:info', (): ExtensionInfo => {
    const f = extensionFolders()
    return {
      chromeId: CHROME_EXTENSION_ID,
      firefoxId: FIREFOX_EXTENSION_ID,
      chromeFolder: f.chrome,
      firefoxFolder: f.firefox,
      hostRegistered,
      hostError,
      connected: connectedBrowsers()
    }
  })
  ipcMain.handle('ext:register', async () => {
    await registerNativeHost()
    return { hostRegistered, hostError }
  })
}

const imagesDir = (): string => path.join(app.getPath('pictures'), 'Rekoto')

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Screenshot'
}

function decodeDataUrl(dataUrl: string): { buf: Buffer; ext: string } {
  const m = /^data:image\/(png|jpeg|webp);base64,/.exec(dataUrl)
  if (!m) throw new Error('Unsupported image data')
  return { buf: Buffer.from(dataUrl.slice(m[0].length), 'base64'), ext: m[1] === 'jpeg' ? 'jpg' : m[1] }
}

async function listDevices(): Promise<{ cameras: Array<{ id: string; label: string }>; mics: Array<{ id: string; label: string }> }> {
  const w = mainWindow
  if (!w || w.isDestroyed()) return { cameras: [], mics: [] }
  // Capped: a busy renderer must never hold up a recording start.
  const all = (await Promise.race([
    w.webContents.executeJavaScript(
      'navigator.mediaDevices.enumerateDevices().then((d) => d.map((x) => ({ kind: x.kind, id: x.deviceId, label: x.label })))'
    ),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Device list timed out')), 3000))
  ])) as Array<{ kind: string; id: string; label: string }>
  const pick = (kind: string): Array<{ id: string; label: string }> =>
    all.filter((d) => d.kind === kind && d.id !== 'default' && d.id !== 'communications').map(({ id, label }) => ({ id, label }))
  return { cameras: pick('videoinput'), mics: pick('audioinput') }
}

async function startFromExtension(msg: Extract<ExtMessage, { type: 'start' }>): Promise<void> {
  if (recorder.active) return
  const o: ExtStartOptions | undefined = msg.opts
  const settings = getSettings()
  const mode = o?.mode ?? 'tab'
  const cameraOn = o ? o.camera || mode === 'camera' : settings.cameraEnabled
  const pt = msg.info
    ? { x: Math.round(msg.info.screenX + msg.info.outerWidth / 2), y: Math.round(msg.info.screenY + msg.info.outerHeight / 2) }
    : screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(pt)
  const brand = msg.browser === 'firefox' ? 'Firefox' : msg.browser === 'edge' ? 'Edge' : 'Chrome'

  // Everything slow happens inside resolve(), which runs while the countdown is already on screen,
  // so starting from the browser is as fast as starting from the desktop app.
  const resolve = async (): Promise<Partial<StartOptions>> => {
    const patch: Partial<Settings> = {}
    if (o) {
      Object.assign(patch, { cameraEnabled: cameraOn, micEnabled: o.mic, systemAudio: o.systemAudio })
      if (o.resolution) patch.resolution = o.resolution
      if (o.cameraLabel !== undefined || o.micLabel !== undefined) {
        const d = await listDevices().catch(() => ({ cameras: [], mics: [] }))
        if (o.cameraLabel !== undefined) patch.cameraDeviceId = d.cameras.find((c) => c.label === o.cameraLabel)?.id ?? ''
        if (o.micLabel !== undefined) patch.micDeviceId = d.mics.find((c) => c.label === o.micLabel)?.id ?? ''
      }
      updateSettings(patch)
    }
    if (mode === 'camera') return {}
    // Windows are only listed when clean desktop needs to know which browser window to keep visible.
    const types: Array<'screen' | 'window'> = settings.cleanDesktopEnabled ? ['screen', 'window'] : ['screen']
    const sources = await desktopCapturer.getSources({ types, thumbnailSize: { width: 1, height: 1 } })
    const browserWindows = sources.filter((w) => w.id.startsWith('window:') && w.name.includes(brand))
    const match = browserWindows.find((w) => msg.title && w.name.includes(msg.title))
    // Clean desktop must never minimize the browser you are recording from.
    const keepWindowIds = match ? [match.id] : browserWindows.map((w) => w.id)
    const screenSrc = sources.find((x) => x.id.startsWith('screen:') && x.display_id === String(display.id)) ?? sources.find((x) => x.id.startsWith('screen:'))
    // "This tab" / "Custom area" record the screen under the browser and crop to the page (from the
    // extension's live viewport reports). Window capture of Chrome is less reliable and slower to start.
    return { mode: 'screen', sourceId: screenSrc?.id ?? null, sourceName: screenSrc?.name, displayId: String(display.id), keepWindowIds }
  }

  const base: StartOptions = {
    mode: mode === 'camera' ? 'camera' : 'screen',
    sourceId: null,
    displayId: String(display.id),
    camera: cameraOn,
    mic: o ? o.mic : settings.micEnabled,
    systemAudio: o ? o.systemAudio && mode !== 'camera' : settings.systemAudio,
    studio: mode === 'camera' ? true : mode === 'desktop' ? settings.studioForScreen : settings.studioForWindow,
    cleanDesktop: settings.cleanDesktopEnabled,
    keepWindowIds: [],
    title: o?.title,
    format: o?.format,
    showControls: o?.controls
  }
  const from =
    mode === 'tab' || mode === 'area'
      ? { browser: msg.browser, title: msg.title, info: msg.info, region: mode === 'area' ? o?.region : undefined }
      : undefined
  await recorder.start(base, from, resolve)
}

async function onExtensionMessage(msg: ExtMessage, reply: Reply): Promise<void> {
  switch (msg.type) {
    case 'devices': {
      try {
        const d = await listDevices()
        const st = getSettings()
        reply({
          ok: true,
          ...d,
          settings: {
            cameraEnabled: st.cameraEnabled,
            micEnabled: st.micEnabled,
            cameraDeviceId: st.cameraDeviceId,
            micDeviceId: st.micDeviceId,
            systemAudio: st.systemAudio,
            resolution: st.resolution,
            saveFolder: st.saveFolder,
            imagesFolder: imagesDir()
          }
        })
      } catch (e) {
        reply({ ok: false, error: (e as Error).message })
      }
      break
    }
    case 'save-image': {
      try {
        const { buf, ext } = decodeDataUrl(msg.dataUrl)
        fs.mkdirSync(imagesDir(), { recursive: true })
        const base = safeName(msg.name)
        let file = path.join(imagesDir(), `${base}.${ext}`)
        for (let i = 2; fs.existsSync(file); i++) file = path.join(imagesDir(), `${base} (${i}).${ext}`)
        await fs.promises.writeFile(file, buf)
        reply({ ok: true, path: file })
      } catch (e) {
        reply({ ok: false, error: (e as Error).message })
      }
      break
    }
    case 'reveal-image': {
      if (msg.path.startsWith(imagesDir())) shell.showItemInFolder(msg.path)
      else void shell.openPath(imagesDir())
      reply({ ok: true })
      break
    }
    case 'ocr': {
      const tmp = path.join(app.getPath('temp'), `rekoto-ocr-${Date.now()}.png`)
      try {
        const { buf } = decodeDataUrl(msg.dataUrl)
        await fs.promises.writeFile(tmp, buf)
        reply({ ok: true, text: await ocrImage(tmp) })
      } catch (e) {
        const m = (e as Error).message
        reply({ ok: false, error: /language/i.test(m) ? m : 'Text could not be read from this image.' })
      } finally {
        fs.rmSync(tmp, { force: true })
      }
      break
    }
    case 'hello':
      sendMain('ext:changed')
      break
    case 'viewport':
      recorder.handleViewport(msg.browser, msg.title, msg.info)
      break
    case 'stop':
      await recorder.stop()
      break
    case 'pause':
    case 'resume':
      recorder.control(msg.type)
      break
    case 'start': {
      try {
        await startFromExtension(msg)
      } catch (e) {
        console.error('extension start failed', e)
      }
      break
    }
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  if (hasPendingRestore()) {
    try {
      await restoreCleanDesktop()
    } catch (e) {
      console.error('restore after crash failed', e)
    }
  }

  handleMediaProtocol()

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'display-capture', 'mediaKeySystem', 'fullscreen'].includes(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'display-capture', 'fullscreen'].includes(permission)
  )
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    const pending = recorder.pendingSource
    if (!pending) return callback({})
    // Reuse the source the Record screen already listed; only scan when it is unknown.
    let src = sourceCache.get(pending.id)
    if (!src) {
      const types: Array<'screen' | 'window'> = pending.id.startsWith('screen:') ? ['screen'] : ['window']
      const sources = await desktopCapturer.getSources({ types, thumbnailSize: { width: 1, height: 1 } })
      src = sources.find((s) => s.id === pending.id)
    }
    if (!src) return callback({})
    callback(pending.audio ? { video: src, audio: 'loopback' } : { video: src })
  })

  registerIpc()
  createMainWindow()
  rewatch()
  // Warm the clean-desktop helper and the recording windows so Start is instant.
  warmCleanDesktop()
  mainWindow?.once('ready-to-show', () => setTimeout(() => recorder.warm(), 300))
  await registerNativeHost()
  startBridge((m, reply) => void onExtensionMessage(m, reply))

})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  if (recorder.active) {
    e.preventDefault()
    quitting = true
    void recorder.shutdown().finally(() => app.quit())
  }
})

app.on('will-quit', () => {
  stopCleanDesktopHelper()
  stopWatching?.()
  stopBridge()
})

app.on('window-all-closed', () => {
  if (!recorder.active) app.quit()
})
