import { app } from 'electron'
import { execFile } from 'child_process'
import fs from 'fs'
import net from 'net'
import path from 'path'
import type { ViewportInfo } from '@shared/types'

/**
 * Browser extensions talk to a small native-messaging host (native-host/host.js). The host
 * relays newline-delimited JSON over this named pipe to the running app.
 */

// Chrome requires native host names to be lowercase letters, digits, dots and underscores.
export const HOST_NAME = 'app.rekoto.host'
export const CHROME_EXTENSION_ID = 'enopdbdfdabfjmnibejobebigmpkpglk'
export const FIREFOX_EXTENSION_ID = 'recorder@rekoto.app'
// REKOTO_PIPE lets tests run a second copy without touching the user's running app.
export const PIPE_PATH = process.env.REKOTO_PIPE || '\\\\.\\pipe\\Rekoto-bridge'

export type BrowserName = 'chrome' | 'edge' | 'firefox'

export type ExtMessage =
  | { type: 'hello'; browser: BrowserName }
  | { type: 'viewport'; browser: BrowserName; title: string; info: ViewportInfo }
  | { type: 'start'; browser: BrowserName; title: string; info: ViewportInfo | null; opts?: ExtStartOptions }
  | { type: 'devices'; id: number }
  | { type: 'save-image'; id: number; name: string; dataUrl: string }
  | { type: 'reveal-image'; id: number; path: string }
  | { type: 'ocr'; id: number; dataUrl: string }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' }

/** Recording choices made in the extension popup. */
export interface ExtStartOptions {
  mode: 'desktop' | 'camera' | 'tab' | 'area'
  title?: string
  camera: boolean
  mic: boolean
  cameraDeviceId?: string
  micDeviceId?: string
  /** Device names from the popup; browsers give each origin different device ids, so the app matches by name. */
  cameraLabel?: string
  micLabel?: string
  systemAudio: boolean
  resolution?: 720 | 1080 | 1440
  format?: 'mp4' | 'webm'
  controls?: boolean
  /** Region inside the page viewport, CSS pixels (mode "area"). */
  region?: { x: number; y: number; w: number; h: number }
}

export type Reply = (msg: Record<string, unknown>) => void

export interface ExtState {
  type: 'state'
  recording: boolean
  paused: boolean
  mask: boolean
  /** Window title the extension should report viewport data for, or null. */
  trackTitle: string | null
  trackBrowser: BrowserName | null
}

interface Client {
  socket: net.Socket
  browser: BrowserName | null
}

const clients = new Set<Client>()
let server: net.Server | null = null
let lastState: ExtState = { type: 'state', recording: false, paused: false, mask: false, trackTitle: null, trackBrowser: null }

export let hostRegistered = false
export let hostError: string | null = null

export function connectedBrowsers(): string[] {
  return [...clients].map((c) => c.browser).filter((b): b is BrowserName => !!b)
}

export function startBridge(onMessage: (msg: ExtMessage, reply: Reply) => void): void {
  if (process.platform !== 'win32' || server) return
  server = net.createServer((socket) => {
    const client: Client = { socket, browser: null }
    clients.add(client)
    // Lines can be tens of megabytes (screenshots): collect parts and only scan new data for newlines.
    let parts: string[] = []
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      let rest = chunk
      let i: number
      while ((i = rest.indexOf('\n')) >= 0) {
        parts.push(rest.slice(0, i))
        rest = rest.slice(i + 1)
        const line = parts.join('').trim()
        parts = []
        if (!line) continue
        try {
          const msg = JSON.parse(line) as ExtMessage
          if (msg.type === 'hello') {
            client.browser = msg.browser
            write(client, lastState)
          }
          onMessage(msg, (r) => write(client, { type: 'reply', id: (msg as { id?: number }).id, ...r }))
        } catch {
          /* ignore malformed lines */
        }
      }
      if (rest) parts.push(rest)
    })
    socket.on('error', () => undefined)
    socket.on('close', () => clients.delete(client))
  })
  server.on('error', (e) => {
    hostError = `Bridge pipe error: ${e.message}`
  })
  server.listen(PIPE_PATH)
}

function write(c: Client, msg: unknown): void {
  try {
    c.socket.write(JSON.stringify(msg) + '\n')
  } catch {
    /* socket closed */
  }
}

export function broadcastState(s: Omit<ExtState, 'type'>): void {
  lastState = { type: 'state', ...s }
  for (const c of clients) write(c, lastState)
}

export function stopBridge(): void {
  for (const c of clients) c.socket.destroy()
  server?.close()
  server = null
}

function hostScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'native-host', 'host.js')
    : path.join(app.getAppPath(), 'native-host', 'host.js')
}

export function extensionFolders(): { chrome: string; firefox: string } {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'extensions') : path.join(app.getAppPath(), 'extensions')
  return { chrome: path.join(base, 'chrome'), firefox: path.join(base, 'firefox') }
}

function reg(key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('reg.exe', ['add', key, '/ve', '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true }, (err) =>
      err ? reject(err) : resolve()
    )
  })
}

/** Writes the host launcher + manifests and registers them for Chrome, Edge and Firefox (per user). */
export async function registerNativeHost(): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    const dir = path.join(app.getPath('userData'), 'native-host')
    fs.mkdirSync(dir, { recursive: true })
    const bat = path.join(dir, 'host.bat')
    const log = path.join(dir, 'host.log')
    // Log launches only — never redirect stdout/stderr (Chrome speaks native messaging on those pipes).
    fs.writeFileSync(
      bat,
      [
        '@echo off',
        `>>"${log}" echo %DATE% %TIME% launch`,
        'set ELECTRON_RUN_AS_NODE=1',
        `"${process.execPath}" "${hostScriptPath()}" %*`,
        ''
      ].join('\r\n')
    )
    const base = { name: HOST_NAME, description: 'Rekoto recorder bridge', path: bat, type: 'stdio' }
    const chromeManifest = path.join(dir, 'chrome-host.json')
    const firefoxManifest = path.join(dir, 'firefox-host.json')
    fs.writeFileSync(chromeManifest, JSON.stringify({ ...base, allowed_origins: [`chrome-extension://${CHROME_EXTENSION_ID}/`] }, null, 2))
    fs.writeFileSync(firefoxManifest, JSON.stringify({ ...base, allowed_extensions: [FIREFOX_EXTENSION_ID] }, null, 2))
    await reg(`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, chromeManifest)
    await reg(`HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`, chromeManifest)
    await reg(`HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}`, firefoxManifest)
    hostRegistered = true
    hostError = null
  } catch (e) {
    hostRegistered = false
    hostError = (e as Error).message
  }
}
