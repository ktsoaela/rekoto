import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const INVOKE_PREFIXES = ['settings:', 'dialog:', 'sources:', 'app:', 'rec:', 'wallpaper:', 'library:', 'shell:', 'ext:', 'recorder:', 'bubble:', 'controls:']
const EVENT_CHANNELS = new Set([
  'rec:state',
  'library:item',
  'library:changed',
  'library:saved',
  'ext:changed',
  'recorder:command',
  'recorder:layout'
])

const api = {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
    if (!INVOKE_PREFIXES.some((p) => channel.startsWith(p))) return Promise.reject(new Error(`Blocked channel ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel: string, cb: (...args: unknown[]) => void): () => void {
    if (!EVENT_CHANNELS.has(channel)) throw new Error(`Blocked channel ${channel}`)
    const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
