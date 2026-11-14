// Background script for the Loom Clone extension (Chrome/Edge service worker, Firefox event page).
// Connects to the desktop app through native messaging.
const api = globalThis.browser ?? globalThis.chrome
const HOST = 'app.loomclone.host'
const BROWSER = navigator.userAgent.includes('Firefox') ? 'firefox' : navigator.userAgent.includes('Edg/') ? 'edge' : 'chrome'

let port = null
let hostError = null
let appConnected = false
let state = { recording: false, paused: false, mask: false, trackTitle: null, trackBrowser: null }
let trackWindowId = null
let viewportTimer = null
const lastUi = new Map() // windowId -> { dx, dy } browser chrome size, for pages without content scripts

function connect() {
  if (port) return
  try {
    port = api.runtime.connectNative(HOST)
  } catch (e) {
    hostError = String(e && e.message ? e.message : e)
    port = null
    return
  }
  hostError = null
  port.onMessage.addListener(onAppMessage)
  port.onDisconnect.addListener(() => {
    const err = api.runtime.lastError || port?.error
    hostError = err ? err.message || String(err) : 'Disconnected'
    port = null
    appConnected = false
    applyState({ recording: false, paused: false, mask: false, trackTitle: null, trackBrowser: null })
    setTimeout(connect, 5000)
  })
  port.postMessage({ type: 'hello', browser: BROWSER })
}

function post(msg) {
  connect()
  try {
    port?.postMessage(msg)
  } catch (_) {
    /* port closed */
  }
}

function onAppMessage(msg) {
  if (!msg) return
  if (msg.type === 'app') {
    appConnected = !!msg.connected
    if (appConnected) post({ type: 'hello', browser: BROWSER })
  } else if (msg.type === 'state') {
    appConnected = true
    applyState(msg)
  }
}

function applyState(s) {
  const wasRecording = state.recording
  state = { ...state, ...s }
  api.storage.local.set({ lcMask: !!state.mask })
  api.action.setBadgeText({ text: state.recording ? (state.paused ? '❚❚' : 'REC') : '' })
  api.action.setBadgeBackgroundColor({ color: state.paused ? '#f59e0b' : '#f43f5e' })
  const tracking = state.recording && (!state.trackBrowser || state.trackBrowser === BROWSER) && (state.trackTitle || trackWindowId != null)
  if (tracking && !viewportTimer) viewportTimer = setInterval(reportViewport, 700)
  if (!tracking && viewportTimer) {
    clearInterval(viewportTimer)
    viewportTimer = null
  }
  if (wasRecording && !state.recording) trackWindowId = null
}

async function findTrackedTab() {
  const tabs = await api.tabs.query({ active: true })
  if (trackWindowId != null) return tabs.find((t) => t.windowId === trackWindowId) || null
  if (state.trackTitle) return tabs.find((t) => t.title && state.trackTitle.includes(t.title)) || null
  return null
}

async function measure(tab) {
  const win = await api.windows.get(tab.windowId)
  let zoom = 1
  try {
    zoom = await api.tabs.getZoom(tab.id)
  } catch (_) {}
  try {
    const v = await api.tabs.sendMessage(tab.id, { type: 'viewport' })
    if (v && v.outerWidth) {
      lastUi.set(tab.windowId, { dx: v.outerWidth - v.innerWidth * zoom, dy: v.outerHeight - v.innerHeight * zoom })
      return { ...v, zoom }
    }
  } catch (_) {
    /* restricted page (new tab, settings, store) - fall back to window bounds */
  }
  const ui = lastUi.get(tab.windowId) || { dx: 16, dy: BROWSER === 'firefox' ? 110 : 120 }
  return {
    screenX: win.left,
    screenY: win.top,
    outerWidth: win.width,
    outerHeight: win.height,
    innerWidth: win.width - ui.dx,
    innerHeight: win.height - ui.dy,
    zoom: 1
  }
}

async function reportViewport() {
  try {
    const tab = await findTrackedTab()
    if (!tab) return
    const info = await measure(tab)
    post({ type: 'viewport', browser: BROWSER, title: tab.title || '', info })
  } catch (_) {
    /* ignore */
  }
}

async function startFromBrowser() {
  const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab) return
  trackWindowId = tab.windowId
  let info = null
  try {
    info = await measure(tab)
  } catch (_) {}
  post({ type: 'start', browser: BROWSER, title: tab.title || '', info })
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return
  if (msg.type === 'popup:get') {
    connect()
    api.storage.local.get('lcAlwaysMask').then((v) =>
      sendResponse({ appConnected, hostError, state, browser: BROWSER, alwaysMask: !!v.lcAlwaysMask })
    )
    return true
  }
  if (msg.type === 'popup:start') startFromBrowser()
  if (msg.type === 'popup:stop') post({ type: 'stop' })
  if (msg.type === 'popup:pause') post({ type: state.paused ? 'resume' : 'pause' })
  if (msg.type === 'popup:alwaysMask') api.storage.local.set({ lcAlwaysMask: !!msg.value })
  sendResponse({ ok: true })
})

api.runtime.onStartup?.addListener(connect)
api.runtime.onInstalled?.addListener(connect)
connect()
