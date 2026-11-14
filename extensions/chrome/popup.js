const api = globalThis.browser ?? globalThis.chrome
const $ = (id) => document.getElementById(id)
const send = (msg) => api.runtime.sendMessage(msg)

const PREFS_KEY = 'rkPopup2'
let prefs = { tab: 'rec', mode: 'both', target: 'desktop', shot: 'visible', delay: '0', save: 'pc', res: '1080', fmt: 'mp4', bar: true, sound: false, cam: '', mic: '' }
let status = null
const NO_MIC = '__none'

const savePrefs = () => api.storage.local.set({ [PREFS_KEY]: prefs })
function showError(id, text) {
  $(id).textContent = text || ''
  $(id).classList.toggle('hidden', !text)
}

$('close').addEventListener('click', () => window.close())

// ---------- video / screenshot switch ----------

function setTab(tab) {
  prefs.tab = tab
  for (const b of document.querySelectorAll('.sw')) b.classList.toggle('active', b.dataset.tab === tab)
  $('tab-rec').classList.toggle('hidden', tab !== 'rec')
  $('tab-shot').classList.toggle('hidden', tab !== 'shot')
  $('heading').textContent = tab === 'rec' ? 'Record a new video' : 'Take a screenshot'
  savePrefs()
  if (tab === 'rec') void startPreview()
  else stopMedia()
}
for (const b of document.querySelectorAll('.sw')) b.addEventListener('click', () => setTab(b.dataset.tab))

// ---------- devices, preview and waveform ----------

let camGranted = false
let micGranted = false
let ownDevices = [] // this extension's own device list (ids differ from the app's)
let camStream = null
let micStream = null
let audioCtx = null
let waveTimer = 0

const withTimeout = (p, ms, fallback) => Promise.race([p, new Promise((r) => setTimeout(() => r(fallback), ms))])

async function checkPermissions() {
  const state = async (name) => {
    try {
      return (await withTimeout(navigator.permissions.query({ name }), 400, { state: 'unknown' })).state
    } catch {
      return 'unknown'
    }
  }
  const [cam, mic] = await Promise.all([state('camera'), state('microphone')])
  camGranted = cam === 'granted'
  micGranted = mic === 'granted'
  if (camGranted || micGranted) ownDevices = await withTimeout(navigator.mediaDevices.enumerateDevices(), 800, [])
}

function fill(sel, labels, current, first) {
  sel.innerHTML = ''
  for (const [value, text] of first) {
    const o = document.createElement('option')
    o.value = value
    o.textContent = text
    sel.appendChild(o)
  }
  for (const l of labels) {
    const o = document.createElement('option')
    o.value = l
    o.textContent = l
    sel.appendChild(o)
  }
  sel.value = [...sel.options].some((o) => o.value === current) ? current : sel.options[0].value
}

async function loadDevices() {
  let cams = ownDevices.filter((d) => d.kind === 'videoinput' && d.label).map((d) => d.label)
  let mics = ownDevices.filter((d) => d.kind === 'audioinput' && d.label && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => d.label)
  if ((!cams.length || !mics.length) && status?.appConnected) {
    // No permission in the browser yet: use the device names the desktop app knows.
    const r = await send({ type: 'rec:devices' })
    if (r && r.ok) {
      if (!cams.length) cams = (r.cameras || []).map((d) => d.label).filter(Boolean)
      if (!mics.length) mics = (r.mics || []).map((d) => d.label).filter(Boolean)
    }
  }
  fill($('cam'), cams, prefs.cam, [['', cams.length ? 'Default camera' : 'Default camera']])
  fill($('mic'), mics, prefs.mic, [['', 'Default microphone'], [NO_MIC, 'No microphone']])
}

function stopMedia() {
  camStream?.getTracks().forEach((t) => t.stop())
  micStream?.getTracks().forEach((t) => t.stop())
  camStream = micStream = null
  clearInterval(waveTimer)
  void audioCtx?.close()
  audioCtx = null
  setWave(null)
}

const ownId = (kind, label) => ownDevices.find((d) => d.kind === kind && d.label === label)?.deviceId

async function startPreview() {
  stopMedia()
  const camWanted = prefs.mode !== 'screen'
  $('cam-off').classList.toggle('hidden', camWanted)
  $('allow-cam').classList.toggle('hidden', !camWanted || camGranted)
  if (camWanted && camGranted) {
    try {
      const id = ownId('videoinput', $('cam').value)
      camStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: id ? { exact: id } : undefined, width: { ideal: 320 } } })
      $('cam-video').srcObject = camStream
    } catch {
      $('allow-cam').classList.remove('hidden')
    }
  }
  if (micGranted && $('mic').value !== NO_MIC) {
    try {
      const id = ownId('audioinput', $('mic').value)
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined } })
      audioCtx = new AudioContext()
      const an = audioCtx.createAnalyser()
      an.fftSize = 1024
      audioCtx.createMediaStreamSource(micStream).connect(an)
      const buf = new Uint8Array(an.fftSize)
      waveTimer = setInterval(() => {
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += (v - 128) * (v - 128)
        pushLevel(Math.min(1, (Math.sqrt(sum / buf.length) / 128) * 5))
      }, 60)
    } catch {
      /* mic busy or missing */
    }
  }
}

// Waveform: ghost bars in the background, live level bars on top.
const BARS = 36
const levels = Array(BARS).fill(0)
function buildWave() {
  const w = $('wave')
  for (let i = 0; i < BARS; i++) {
    const s = document.createElement('span')
    s.style.setProperty('--ghost', `${30 + ((i * 37) % 55)}%`)
    s.appendChild(document.createElement('i'))
    w.appendChild(s)
  }
}
function setWave(vals) {
  const w = $('wave')
  w.classList.toggle('idle', !vals)
  ;[...w.children].forEach((s, i) => s.firstChild.style.setProperty('--h', `${vals ? Math.max(10, Math.round(vals[i] * 100)) : 10 + ((i * 13) % 14)}%`))
}
function pushLevel(l) {
  levels.shift()
  levels.push(l)
  setWave(levels)
}

$('allow-cam').addEventListener('click', () => api.tabs.create({ url: api.runtime.getURL('permission.html') }))

// ---------- record options ----------

function setMode(mode) {
  prefs.mode = mode
  for (const t of document.querySelectorAll('[data-mode]')) t.classList.toggle('selected', t.dataset.mode === mode)
  const camOnly = mode === 'camera'
  $('target').disabled = camOnly
  $('target-row').classList.toggle('disabled', camOnly)
  $('cam').disabled = mode === 'screen'
  $('cam-row').classList.toggle('disabled', mode === 'screen')
  $('sound-on').closest('.chip').classList.toggle('hidden', camOnly)
  savePrefs()
  if (prefs.tab === 'rec') void startPreview()
}
for (const t of document.querySelectorAll('[data-mode]')) t.addEventListener('click', () => setMode(t.dataset.mode))

$('target').addEventListener('change', (e) => { prefs.target = e.target.value; savePrefs() })
$('cam').addEventListener('change', (e) => { prefs.cam = e.target.value; savePrefs(); void startPreview() })
$('mic').addEventListener('change', (e) => { prefs.mic = e.target.value; savePrefs(); void startPreview() })
$('sound-on').addEventListener('change', (e) => { prefs.sound = e.target.checked; savePrefs() })
$('bar-on').addEventListener('change', (e) => { prefs.bar = e.target.checked; savePrefs() })
$('res').addEventListener('change', (e) => { prefs.res = e.target.value; savePrefs() })
$('fmt').addEventListener('change', (e) => { prefs.fmt = e.target.value; savePrefs() })

$('start').addEventListener('click', async () => {
  showError('rec-error', '')
  if (!status?.appConnected) return showError('rec-error', 'Start the Rekoto desktop app first. It does the recording.')
  const mode = prefs.mode === 'camera' ? 'camera' : prefs.target
  const mic = $('mic').value
  const opts = {
    mode,
    title: $('title').value.trim() || undefined,
    camera: prefs.mode !== 'screen',
    mic: mic !== NO_MIC,
    cameraLabel: $('cam').value,
    micLabel: mic === NO_MIC ? '' : mic,
    systemAudio: prefs.mode !== 'camera' && $('sound-on').checked,
    resolution: Number($('res').value),
    format: $('fmt').value,
    controls: $('bar-on').checked
  }
  stopMedia() // release the camera and mic for the desktop app
  $('start').disabled = true
  const p = send({ type: 'rec:start', opts })
  if (mode === 'area') {
    setTimeout(() => window.close(), 60) // the page takes over so you can draw the area
    return
  }
  const r = await p
  $('start').disabled = false
  if (r && r.ok === false) {
    showError('rec-error', r.error)
    void startPreview()
  } else window.close()
})

$('stop').addEventListener('click', async () => {
  await send({ type: 'popup:stop' })
  window.close()
})
$('pause').addEventListener('click', async () => {
  await send({ type: 'popup:pause' })
  setTimeout(refresh, 250)
})
$('alwaysMask').addEventListener('change', (e) => send({ type: 'popup:alwaysMask', value: e.target.checked }))

// ---------- screenshot ----------

const SHOTS = {
  visible: { button: 'Take Screenshot', note: 'Captures what you can see in this tab.', delay: true },
  full: { button: 'Capture Full Page', note: 'Scrolls the page and captures it top to bottom.', delay: true },
  area: { button: 'Select Area', note: 'Drag over the part of the page you want.', delay: false },
  desktop: { button: 'Choose Screen or Window', note: 'Any screen or app window, not just the browser.', delay: false },
  annotate: { button: 'Open Image', note: 'Open a file or paste from the clipboard, then draw on it.', delay: false },
  ocr: { button: 'Select Text to Extract', note: 'Select an area and copy the text in it.', delay: false }
}
function setShot(kind) {
  prefs.shot = kind
  for (const t of document.querySelectorAll('[data-shot]')) t.classList.toggle('selected', t.dataset.shot === kind)
  const s = SHOTS[kind]
  $('shoot').textContent = s.button
  $('shot-note').textContent = s.note
  $('delay').disabled = !s.delay
  $('delay-row').classList.toggle('disabled', !s.delay)
  savePrefs()
}
for (const t of document.querySelectorAll('[data-shot]')) {
  t.addEventListener('click', () => setShot(t.dataset.shot))
  t.addEventListener('dblclick', () => $('shoot').click())
}
$('delay').addEventListener('change', (e) => { prefs.delay = e.target.value; savePrefs() })
$('shot-save').addEventListener('change', (e) => {
  prefs.save = e.target.value
  api.storage.local.set({ rkSaveTo: prefs.save })
  savePrefs()
})

$('shoot').addEventListener('click', async () => {
  showError('shot-error', '')
  const kind = prefs.shot
  const seconds = SHOTS[kind].delay ? Number($('delay').value) : 0
  const type = { visible: 'shot:visible', full: 'shot:full', area: 'shot:area', desktop: 'shot:desktop', annotate: 'shot:annotate', ocr: 'shot:ocr' }[kind]
  const p = send({ type, seconds })
  // These need the page itself (selecting, scrolling or waiting), so get out of the way.
  if (kind === 'area' || kind === 'ocr' || kind === 'full' || seconds > 0) {
    setTimeout(() => window.close(), 60)
    return
  }
  const r = await p
  if (r && r.ok === false) showError('shot-error', r.error)
})

// ---------- status ----------

async function refresh() {
  const r = await send({ type: 'popup:get' })
  if (!r) return
  const first = !status
  status = r
  $('alwaysMask').checked = !!r.alwaysMask
  const rec = r.state && r.state.recording
  const st = $('status')
  if (!r.appConnected) {
    st.textContent = 'Rekoto app offline'
    st.className = 'status bad'
  } else if (rec) {
    st.textContent = r.state.paused ? 'Paused' : 'Recording'
    st.className = 'status rec'
  } else {
    st.textContent = 'Connected to Rekoto'
    st.className = 'status ok'
  }
  $('rec-live').classList.toggle('hidden', !rec)
  $('rec-setup').classList.toggle('hidden', !!rec)
  $('live-label').textContent = r.state?.paused ? 'Paused' : 'Recording'
  $('pause').textContent = r.state?.paused ? 'Resume' : 'Pause'
  if (first) await loadDevices()
}

// ---------- init ----------

buildWave()
setWave(null)
;(async () => {
  const v = await api.storage.local.get([PREFS_KEY, 'rkSaveTo'])
  prefs = { ...prefs, ...(v[PREFS_KEY] || {}) }
  $('shot-save').value = v.rkSaveTo || prefs.save
  $('target').value = prefs.target
  $('delay').value = prefs.delay
  $('res').value = prefs.res
  $('fmt').value = prefs.fmt
  $('bar-on').checked = prefs.bar !== false
  $('sound-on').checked = !!prefs.sound
  setShot(prefs.shot)
  setMode(prefs.mode)
  setTab(prefs.tab)
  await checkPermissions()
  await refresh()
  if (!status) await loadDevices()
  if (prefs.tab === 'rec') void startPreview()
  setInterval(refresh, 1000)
})()
window.addEventListener('pagehide', stopMedia)
