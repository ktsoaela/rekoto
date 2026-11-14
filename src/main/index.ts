import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, session, shell } from 'electron'
import fs from 'fs'
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
  stopCleanDesktopHelper
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
  type ExtMessage
} from './native-bridge'
import { RecordingManager } from './recording'
import { createRouteWindow } from './windows'
import { ffmpegPath } from './ffmpeg'

registerMediaScheme()

// Hardware video encoders hang MediaRecorder on some Windows GPU drivers (no data is ever produced).
// Software encoding is reliable and fast enough for screen recordings; set Rekoto_HW_ENCODE=1 to opt back in.
if (!process.env.Rekoto_HW_ENCODE) app.commandLine.appendSwitch('disable-accelerated-video-encode')

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

async function onExtensionMessage(msg: ExtMessage): Promise<void> {
  switch (msg.type) {
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
      if (recorder.active) return
      const settings = getSettings()
      const windows = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } })
      const brand = msg.browser === 'firefox' ? 'Firefox' : msg.browser === 'edge' ? 'Edge' : 'Chrome'
      const match = windows.find((w) => msg.title && w.name.includes(msg.title) && w.name.includes(brand))
      let opts: StartOptions
      if (match) {
        opts = {
          mode: 'window',
          sourceId: match.id,
          sourceName: match.name,
          camera: settings.cameraEnabled,
          mic: settings.micEnabled,
          systemAudio: settings.systemAudio,
          studio: settings.studioForWindow,
          cleanDesktop: settings.cleanDesktopEnabled,
          keepWindowIds: [match.id]
        }
      } else {
        // Fall back to recording the screen under the browser window and cropping to the page.
        const pt = msg.info
          ? { x: Math.round(msg.info.screenX + msg.info.outerWidth / 2), y: Math.round(msg.info.screenY + msg.info.outerHeight / 2) }
          : screen.getCursorScreenPoint()
        const display = screen.getDisplayNearestPoint(pt)
        const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
        const src = screens.find((x) => x.display_id === String(display.id)) ?? screens[0]
        opts = {
          mode: 'screen',
          sourceId: src?.id ?? null,
          sourceName: src?.name,
          camera: settings.cameraEnabled,
          mic: settings.micEnabled,
          systemAudio: settings.systemAudio,
          studio: settings.studioForWindow,
          cleanDesktop: settings.cleanDesktopEnabled,
          keepWindowIds: []
        }
      }
      try {
        await recorder.start(opts, { browser: msg.browser, title: msg.title, info: msg.info })
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
  startBridge((m) => void onExtensionMessage(m))

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
