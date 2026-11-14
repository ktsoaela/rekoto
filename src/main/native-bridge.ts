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

export const HOST_NAME = 'app.loomclone.host'
export const CHROME_EXTENSION_ID = 'enopdbdfdabfjmnibejobebigmpkpglk'
export const FIREFOX_EXTENSION_ID = 'recorder@loomclone.app'
export const PIPE_PATH = '\\\\.\\pipe\\loom-clone-bridge'

export type BrowserName = 'chrome' | 'edge' | 'firefox'

export type ExtMessage =
  | { type: 'hello'; browser: BrowserName }
  | { type: 'viewport'; browser: BrowserName; title: string; info: ViewportInfo }
  | { type: 'start'; browser: BrowserName; title: string; info: ViewportInfo | null }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' }

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

export function startBridge(onMessage: (msg: ExtMessage) => void): void {
  if (process.platform !== 'win32' || server) return
  server = net.createServer((socket) => {
    const client: Client = { socket, browser: null }
    clients.add(client)
    let buf = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      buf += chunk
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line) as ExtMessage
          if (msg.type === 'hello') {
            client.browser = msg.browser
            write(client, lastState)
          }
          onMessage(msg)
        } catch {
          /* ignore malformed lines */
        }
      }
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
    fs.writeFileSync(
      bat,
      ['@echo off', 'set ELECTRON_RUN_AS_NODE=1', `"${process.execPath}" "${hostScriptPath()}" %*`, ''].join('\r\n')
    )
    const base = { name: HOST_NAME, description: 'Loom Clone recorder bridge', path: bat, type: 'stdio' }
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
