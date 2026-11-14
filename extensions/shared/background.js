// Background script for the Rekoto extension (Chrome/Edge service worker, Firefox event page).
// Talks to the Rekoto desktop app through native messaging, and runs screenshot captures.
const api = globalThis.browser ?? globalThis.chrome
// Native host names must be lowercase.
const HOST = 'app.rekoto.host'
const BROWSER = navigator.userAgent.includes('Firefox') ? 'firefox' : navigator.userAgent.includes('Edg/') ? 'edge' : 'chrome'

let port = null
let hostError = null
let appConnected = false
let state = { recording: false, paused: false, mask: false, trackTitle: null, trackBrowser: null }
let trackWindowId = null
let viewportTimer = null
const lastUi = new Map() // windowId -> { dx, dy } browser chrome size, for pages without content scripts

// ---------- connection to the desktop app ----------

let reqId = 1
const pending = new Map()

function connect(force = false) {
  if (port && !force) return
  if (port) {
    try {
      port.disconnect()
    } catch (_) {
      /* already closed */
    }
    port = null
  }
  try {
    port = api.runtime.connectNative(HOST)
  } catch (e) {
    hostError = String(e && e.message ? e.message : e)
    port = null
    appConnected = false
    return
  }
  hostError = null
  port.onMessage.addListener(onAppMessage)
  port.onDisconnect.addListener(() => {
    const err = api.runtime.lastError || port?.error
    hostError = err ? err.message || String(err) : 'Disconnected'
    port = null
    appConnected = false
    for (const p of pending.values()) p.reject(new Error('Rekoto desktop app disconnected'))
    pending.clear()
    applyState({ recording: false, paused: false, mask: false, trackTitle: null, trackBrowser: null })
    // MV3 service workers die before setTimeout fires — alarms keep retries alive.
    try {
      api.alarms?.create('rk-connect', { delayInMinutes: 0.1 })
    } catch (_) {
      setTimeout(() => connect(), 5000)
    }
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

/** Request/response with the desktop app. */
function ask(msg, timeout = 20000) {
  return new Promise((resolve, reject) => {
    connect()
    if (!port || !appConnected) return reject(new Error('Open the Rekoto desktop app first.'))
    const id = reqId++
    const t = setTimeout(() => {
      if (pending.delete(id)) reject(new Error('The Rekoto app did not answer.'))
    }, timeout)
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(t)
        resolve(v)
      },
      reject: (e) => {
        clearTimeout(t)
        reject(e)
      }
    })
    post({ ...msg, id })
  })
}

function onAppMessage(msg) {
  if (!msg) return
  if (msg.type === 'app') {
    appConnected = !!msg.connected
    if (appConnected) post({ type: 'hello', browser: BROWSER })
  } else if (msg.type === 'state') {
    appConnected = true
    applyState(msg)
  } else if (msg.type === 'reply') {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok === false) p.reject(new Error(msg.error || 'Request failed'))
    else p.resolve(msg)
  }
}

function applyState(s) {
  const wasRecording = state.recording
  state = { ...state, ...s }
  api.storage.local.set({ lcMask: !!state.mask })
  api.action.setBadgeText({ text: state.recording ? (state.paused ? '❚❚' : 'REC') : '' })
  api.action.setBadgeBackgroundColor({ color: state.paused ? '#ffc400' : '#e5322d' })
  const tracking =
    state.recording && (!state.trackBrowser || state.trackBrowser === BROWSER) && (state.trackTitle || trackWindowId != null)
  if (tracking && !viewportTimer) {
    viewportTimer = setInterval(reportViewport, 400)
    void reportViewport()
  }
  if (!tracking && viewportTimer) {
    clearInterval(viewportTimer)
    viewportTimer = null
  }
  if (wasRecording && !state.recording) trackWindowId = null
}

// ---------- viewport tracking (crop browser chrome while recording) ----------

function stripBrowserSuffix(title) {
  return String(title || '')
    .replace(/\s*[-–—]\s*(Google Chrome|Mozilla Firefox|Microsoft\s*Edge)\s*$/i, '')
    .trim()
}

function titlesMatch(trackTitle, tabTitle) {
  const a = String(trackTitle || '').toLowerCase()
  const b = String(tabTitle || '').toLowerCase()
  const aCore = stripBrowserSuffix(trackTitle).toLowerCase()
  if (!a || !b) return false
  return a.includes(b) || b.includes(a) || aCore.includes(b) || b.includes(aCore)
}

async function findTrackedTab() {
  const tabs = await api.tabs.query({ active: true })
  if (trackWindowId != null) return tabs.find((t) => t.windowId === trackWindowId) || null
  if (state.trackTitle) {
    const hit = tabs.find((t) => t.title && titlesMatch(state.trackTitle, t.title))
    if (hit) return hit
    const all = await api.tabs.query({})
    return all.find((t) => t.title && titlesMatch(state.trackTitle, t.title)) || null
  }
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
  const ui = lastUi.get(tab.windowId) || { dx: 16, dy: BROWSER === 'firefox' ? 110 : 148 }
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

// ---------- recording ----------

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true })
  return tab || null
}

/** opts: { mode: 'desktop'|'camera'|'tab'|'area', title, camera, mic, cameraDeviceId, micDeviceId, systemAudio, resolution, format, controls } */
async function startRecording(opts) {
  if (!appConnected) throw new Error('Open the Rekoto desktop app first.')
  const tab = await activeTab()
  let info = null
  if (tab) {
    try {
      if (opts.mode === 'tab' || opts.mode === 'area') info = await measure(tab)
      else {
        // Desktop / camera only need to know which display the browser is on: skip the page round-trip.
        const w = await api.windows.get(tab.windowId)
        info = { screenX: w.left, screenY: w.top, outerWidth: w.width, outerHeight: w.height, innerWidth: w.width, innerHeight: w.height, zoom: 1 }
      }
    } catch (_) {}
  }
  if (opts.mode === 'area') {
    if (!tab) throw new Error('No tab to record.')
    const sel = await sendTab(tab.id, { type: 'sel:start', label: 'Drag over the part of the page to record' })
    if (!sel || sel.cancel) return { canceled: true }
    opts = { ...opts, region: sel.rect }
  }
  if ((opts.mode === 'tab' || opts.mode === 'area') && tab) trackWindowId = tab.windowId
  post({ type: 'start', browser: BROWSER, title: tab?.title || '', info, opts })
  return { ok: true }
}

// ---------- screenshots ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function sendTab(tabId, msg) {
  try {
    return await api.tabs.sendMessage(tabId, msg)
  } catch (_) {
    throw new Error("This page can't be captured by extensions (browser pages, the web store and PDFs are blocked). Use Entire screen or app window instead.")
  }
}

let lastCapture = 0
async function captureVisible(windowId) {
  // Browsers allow about two captures per second.
  const wait = 550 - (Date.now() - lastCapture)
  if (wait > 0) await sleep(wait)
  lastCapture = Date.now()
  try {
    return await api.tabs.captureVisibleTab(windowId, { format: 'png' })
  } catch (e) {
    throw new Error("This page can't be captured (browser pages are blocked). Use Entire screen or app window instead.")
  }
}

// Captures are handed to the editor tab from memory: the editor asks for its job by id when it loads.
// (IndexedDB in the extension service worker fails on some Chrome builds.)
const jobs = new Map()

async function openEditor(data, nextTo) {
  const id = `shot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  jobs.set(id, { ...data, createdAt: Date.now() })
  // Drop anything an editor never picked up (closed before loading).
  setTimeout(() => jobs.delete(id), 120000)
  const url = api.runtime.getURL('editor.html') + '#' + id
  await api.tabs.create({ url, index: nextTo ? nextTo.index + 1 : undefined, windowId: nextTo?.windowId })
}

function shotName(title) {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
  const clean = String(title || '').replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 60)
  return clean ? `${clean} – ${stamp}` : `Screenshot ${stamp}`
}

async function shotVisible() {
  const tab = await activeTab()
  if (!tab) throw new Error('No tab to capture.')
  const image = await captureVisible(tab.windowId)
  await openEditor({ kind: 'image', image, name: shotName(tab.title), url: tab.url }, tab)
}

async function countdownBadge(seconds) {
  for (let n = seconds; n >= 1; n--) {
    await api.action.setBadgeText({ text: String(n) })
    await api.action.setBadgeBackgroundColor({ color: '#ffc400' })
    await sleep(1000)
  }
  await api.action.setBadgeText({ text: '' })
}

async function shotDelayed(seconds = 3) {
  const tab = await activeTab()
  if (!tab) throw new Error('No tab to capture.')
  await countdownBadge(seconds)
  const current = (await activeTab()) || tab
  const image = await captureVisible(current.windowId)
  await openEditor({ kind: 'image', image, name: shotName(current.title), url: current.url }, current)
}

async function shotArea(ocr) {
  const tab = await activeTab()
  if (!tab) throw new Error('No tab to capture.')
  const sel = await sendTab(tab.id, { type: 'sel:start', label: ocr ? 'Select the text to extract' : 'Drag to select an area' })
  if (!sel || sel.cancel) return { canceled: true }
  const image = await captureVisible(tab.windowId)
  await openEditor({ kind: 'image', image, crop: { ...sel.rect, vw: sel.vw }, ocr: !!ocr, name: shotName(tab.title), url: tab.url }, tab)
}

async function shotFullPage() {
  const tab = await activeTab()
  if (!tab) throw new Error('No tab to capture.')
  const info = await sendTab(tab.id, { type: 'fp:start' })
  const maxCss = Math.floor(30000 / Math.max(1, info.dpr)) // browser canvas height limit
  const total = Math.min(info.total, maxCss)
  const pieces = []
  try {
    let y = 0
    for (let i = 0; i < 80; i++) {
      api.action.setBadgeText({ text: `${Math.min(99, Math.round((y / total) * 100))}%` })
      const r = await sendTab(tab.id, { type: 'fp:scroll', y, hideFixed: i > 0 })
      const data = await captureVisible(tab.windowId)
      pieces.push({ y: r.y, data })
      if (r.y + info.vh >= total || (i > 0 && r.y === pieces[i - 1].y)) break
      y = r.y + info.vh
    }
  } finally {
    await sendTab(tab.id, { type: 'fp:end' }).catch(() => undefined)
    api.action.setBadgeText({ text: '' })
  }
  await openEditor(
    { kind: 'pieces', pieces, total, vw: info.vw, vh: info.vh, truncated: info.total > total, name: shotName(tab.title), url: tab.url },
    tab
  )
}

// ---------- messages from the popup and editor ----------

const handlers = {
  'popup:get': async () => {
    connect()
    const v = await api.storage.local.get('lcAlwaysMask')
    return { appConnected, hostError, state, browser: BROWSER, alwaysMask: !!v.lcAlwaysMask }
  },
  'popup:stop': async () => post({ type: 'stop' }),
  'popup:pause': async () => post({ type: state.paused ? 'resume' : 'pause' }),
  'popup:alwaysMask': async (m) => api.storage.local.set({ lcAlwaysMask: !!m.value }),
  'rec:devices': async () => ask({ type: 'devices' }, 8000),
  'rec:start': async (m) => startRecording(m.opts || { mode: 'tab' }),
  'shot:visible': async (m) => (m.seconds > 0 ? shotDelayed(m.seconds) : shotVisible()),
  'shot:delay': async (m) => shotDelayed(m.seconds || 3),
  'shot:area': async () => shotArea(false),
  'shot:ocr': async () => shotArea(true),
  'shot:full': async (m) => {
    if (m.seconds > 0) await countdownBadge(m.seconds)
    return shotFullPage()
  },
  'shot:desktop': async () => openEditor({ kind: 'desktop', name: shotName('') }),
  'shot:annotate': async () => openEditor({ kind: 'open', name: shotName('') }),
  'img:save': async (m) => ask({ type: 'save-image', name: m.name, dataUrl: m.dataUrl }, 30000),
  'img:reveal': async (m) => ask({ type: 'reveal-image', path: m.path }, 8000),
  'img:ocr': async (m) => ask({ type: 'ocr', dataUrl: m.dataUrl }, 60000),
  'app:status': async () => ({ appConnected }),
  'editor:get': async (m) => {
    const job = jobs.get(m.id)
    jobs.delete(m.id)
    return { job: job || null }
  }
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = msg && handlers[msg.type]
  if (!h) return
  Promise.resolve()
    .then(() => h(msg))
    .then((r) => sendResponse({ ok: true, ...(r && typeof r === 'object' ? r : {}) }))
    .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }))
  return true
})

api.commands?.onCommand.addListener((cmd) => {
  const run = { 'shot-visible': shotVisible, 'shot-full': shotFullPage, 'shot-area': () => shotArea(false) }[cmd]
  if (run) run().catch(() => undefined)
})

api.runtime.onStartup?.addListener(() => connect())
api.runtime.onInstalled?.addListener(() => connect())
api.alarms?.onAlarm.addListener((a) => {
  if (a.name !== 'rk-connect') return
  if (!port) connect()
  else if (!appConnected) {
    try {
      port.postMessage({ type: 'hello', browser: BROWSER })
    } catch (_) {
      connect(true)
    }
  }
})
try {
  api.alarms?.create('rk-connect', { periodInMinutes: 1 })
} catch (_) {
  /* alarms permission missing in older installs until reload */
}
connect()
