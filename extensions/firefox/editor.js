// Rekoto screenshot editor: crop, annotate, blur, copy, download, save to PC, extract text.
const api = globalThis.browser ?? globalThis.chrome
const $ = (id) => document.getElementById(id)
const canvas = $('canvas')
const ctx = canvas.getContext('2d')

const COLORS = ['#e5322d', '#ffc400', '#16a34a', '#2563eb', '#141414', '#ffffff']
const SIZES = [2, 5, 10]

let base = null // canvas holding the image (after crops)
let shapes = []
let undoStack = []
let redoStack = []
let tool = 'arrow'
let color = COLORS[0]
let size = SIZES[1]
let draft = null
let saveTo = 'pc'

// ---------- data hand-off from the background (kept in its memory) ----------

async function takeShot(id) {
  const r = await api.runtime.sendMessage({ type: 'editor:get', id })
  return r && r.ok ? r.job : null
}

// ---------- helpers ----------

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read the image'))
    img.src = src
  })

function makeCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

let toastTimer = 0
function toast(text, opts = {}) {
  const el = $('toast')
  $('toast-text').textContent = text
  el.classList.toggle('error', !!opts.error)
  const btn = $('toast-action')
  btn.classList.toggle('hidden', !opts.action)
  if (opts.action) {
    btn.textContent = opts.action.label
    btn.onclick = opts.action.run
  }
  el.classList.remove('hidden')
  clearTimeout(toastTimer)
  if (!opts.sticky) toastTimer = setTimeout(() => el.classList.add('hidden'), opts.action ? 6000 : 2600)
}

function fileName() {
  return ($('name').value || 'Screenshot').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 120) || 'Screenshot'
}

// ---------- base image ----------

function setBase(c) {
  base = c
  shapes = []
  undoStack = []
  redoStack = []
  canvas.width = c.width
  canvas.height = c.height
  for (const id of ['empty-desktop', 'empty-open']) $(id).classList.add('hidden')
  $('canvas-wrap').classList.remove('hidden')
  for (const id of ['ocr', 'copy', 'download', 'save']) $(id).disabled = false
  render()
}

function resizeToBase() {
  canvas.width = base.width
  canvas.height = base.height
}

async function fromImage(src, crop) {
  const img = await loadImage(src)
  if (!crop) {
    const c = makeCanvas(img.naturalWidth, img.naturalHeight)
    c.getContext('2d').drawImage(img, 0, 0)
    return c
  }
  const s = img.naturalWidth / crop.vw
  const c = makeCanvas(crop.w * s, crop.h * s)
  c.getContext('2d').drawImage(img, crop.x * s, crop.y * s, crop.w * s, crop.h * s, 0, 0, c.width, c.height)
  return c
}

async function stitch(job) {
  const imgs = []
  for (const p of job.pieces) imgs.push({ y: p.y, img: await loadImage(p.data) })
  const scale = imgs[0].img.naturalWidth / job.vw
  const last = imgs[imgs.length - 1]
  const height = Math.min(job.total * scale, last.y * scale + last.img.naturalHeight)
  const c = makeCanvas(imgs[0].img.naturalWidth, height)
  const g = c.getContext('2d')
  for (const { y, img } of imgs) g.drawImage(img, 0, Math.round(y * scale))
  return c
}

// ---------- drawing ----------

const norm = (d) => ({ x: Math.min(d.x1, d.x2), y: Math.min(d.y1, d.y2), w: Math.abs(d.x2 - d.x1), h: Math.abs(d.y2 - d.y1) })

function drawShape(g, s) {
  g.save()
  g.strokeStyle = s.c
  g.fillStyle = s.c
  g.lineWidth = s.w
  g.lineCap = 'round'
  g.lineJoin = 'round'
  if (s.t === 'pen' || s.t === 'highlight') {
    if (s.t === 'highlight') g.globalAlpha = 0.35
    g.beginPath()
    s.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
    if (s.pts.length === 1) g.lineTo(s.pts[0].x + 0.1, s.pts[0].y)
    g.stroke()
  } else if (s.t === 'line' || s.t === 'arrow') {
    g.beginPath()
    g.moveTo(s.x1, s.y1)
    g.lineTo(s.x2, s.y2)
    g.stroke()
    if (s.t === 'arrow') {
      const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
      const len = Math.max(14, s.w * 4.5)
      g.beginPath()
      g.moveTo(s.x2, s.y2)
      g.lineTo(s.x2 - len * Math.cos(a - Math.PI / 7), s.y2 - len * Math.sin(a - Math.PI / 7))
      g.lineTo(s.x2 - len * Math.cos(a + Math.PI / 7), s.y2 - len * Math.sin(a + Math.PI / 7))
      g.closePath()
      g.fill()
    }
  } else if (s.t === 'rect') {
    const r = norm(s)
    g.strokeRect(r.x, r.y, r.w, r.h)
  } else if (s.t === 'ellipse') {
    const r = norm(s)
    g.beginPath()
    g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2)
    g.stroke()
  } else if (s.t === 'text') {
    g.font = `600 ${s.size}px "Segoe UI", system-ui, sans-serif`
    g.textBaseline = 'top'
    s.text.split('\n').forEach((line, i) => g.fillText(line, s.x, s.y + i * s.size * 1.2))
  } else if (s.t === 'blur') {
    const r = norm(s)
    if (r.w >= 2 && r.h >= 2) {
      const cell = Math.max(6, Math.round(Math.min(r.w, r.h) / 12))
      const small = makeCanvas(Math.ceil(r.w / cell), Math.ceil(r.h / cell))
      const sg = small.getContext('2d')
      sg.imageSmoothingEnabled = true
      sg.drawImage(base, r.x, r.y, r.w, r.h, 0, 0, small.width, small.height)
      g.imageSmoothingEnabled = false
      g.drawImage(small, 0, 0, small.width, small.height, r.x, r.y, r.w, r.h)
    }
  } else if (s.t === 'crop') {
    const r = norm(s)
    g.fillStyle = 'rgba(0,0,0,.5)'
    g.fillRect(0, 0, base.width, r.y)
    g.fillRect(0, r.y + r.h, base.width, base.height - r.y - r.h)
    g.fillRect(0, r.y, r.x, r.h)
    g.fillRect(r.x + r.w, r.y, base.width - r.x - r.w, r.h)
    g.strokeStyle = '#ffc400'
    g.lineWidth = Math.max(2, base.width / 600)
    g.setLineDash([10, 6])
    g.strokeRect(r.x, r.y, r.w, r.h)
  }
  g.restore()
}

function render() {
  if (!base) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(base, 0, 0)
  for (const s of shapes) drawShape(ctx, s)
  if (draft) drawShape(ctx, draft)
}

function flatten() {
  const c = makeCanvas(base.width, base.height)
  const g = c.getContext('2d')
  g.drawImage(base, 0, 0)
  for (const s of shapes) drawShape(g, s)
  return c
}

// ---------- tools ----------

const scaleFactor = () => canvas.width / canvas.getBoundingClientRect().width

function toImg(e) {
  const r = canvas.getBoundingClientRect()
  return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) }
}

function lineWidth() {
  // Keep strokes readable on large screenshots by scaling with the on-screen zoom.
  return size * Math.max(1, scaleFactor())
}

function commit(s) {
  shapes.push(s)
  undoStack.push({ type: 'add', s })
  redoStack = []
}

function applyCrop(d) {
  const r = norm(d)
  if (r.w < 8 || r.h < 8) return
  const flat = flatten()
  const nb = makeCanvas(r.w, r.h)
  nb.getContext('2d').drawImage(flat, r.x, r.y, r.w, r.h, 0, 0, nb.width, nb.height)
  undoStack.push({ type: 'swap', base, shapes })
  redoStack = []
  base = nb
  shapes = []
  resizeToBase()
  setTool('arrow')
}

function undo() {
  const a = undoStack.pop()
  if (!a) return
  if (a.type === 'add') {
    shapes = shapes.filter((s) => s !== a.s)
    redoStack.push(a)
  } else {
    redoStack.push({ type: 'swap', base, shapes })
    base = a.base
    shapes = a.shapes
    resizeToBase()
  }
  render()
}

function redo() {
  const a = redoStack.pop()
  if (!a) return
  if (a.type === 'add') {
    shapes.push(a.s)
    undoStack.push(a)
  } else {
    undoStack.push({ type: 'swap', base, shapes })
    base = a.base
    shapes = a.shapes
    resizeToBase()
  }
  render()
}

canvas.addEventListener('pointerdown', (e) => {
  if (!base || e.button !== 0) return
  const p = toImg(e)
  if (tool === 'text') {
    openText(p)
    e.preventDefault()
    return
  }
  canvas.setPointerCapture(e.pointerId)
  const w = tool === 'highlight' ? lineWidth() * 4 : lineWidth()
  draft =
    tool === 'pen' || tool === 'highlight'
      ? { t: tool, c: tool === 'highlight' && color === '#141414' ? '#ffc400' : color, w, pts: [p] }
      : { t: tool, c: color, w, x1: p.x, y1: p.y, x2: p.x, y2: p.y }
  render()
})
canvas.addEventListener('pointermove', (e) => {
  if (!draft) return
  const p = toImg(e)
  if (draft.pts) draft.pts.push(p)
  else {
    draft.x2 = p.x
    draft.y2 = p.y
    if (e.shiftKey && (draft.t === 'rect' || draft.t === 'ellipse')) {
      const m = Math.max(Math.abs(p.x - draft.x1), Math.abs(p.y - draft.y1))
      draft.x2 = draft.x1 + Math.sign(p.x - draft.x1 || 1) * m
      draft.y2 = draft.y1 + Math.sign(p.y - draft.y1 || 1) * m
    }
  }
  render()
})
canvas.addEventListener('pointerup', () => {
  if (!draft) return
  const d = draft
  draft = null
  if (d.t === 'crop') applyCrop(d)
  else if (d.pts || Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 3) commit(d)
  render()
})

// Text: a floating textarea over the canvas, committed on Enter or blur.
let textAt = null
function openText(p) {
  const ta = $('text-input')
  const k = 1 / scaleFactor()
  const px = (16 + size * 4) * Math.max(1, scaleFactor())
  textAt = { ...p, size: px, c: color }
  ta.style.left = p.x * k + 'px'
  ta.style.top = p.y * k + 'px'
  ta.style.fontSize = px * k + 'px'
  ta.style.color = color
  ta.value = ''
  ta.classList.remove('hidden')
  setTimeout(() => ta.focus(), 0)
}
function closeText(keep) {
  const ta = $('text-input')
  if (ta.classList.contains('hidden')) return
  const text = ta.value.replace(/\s+$/, '')
  ta.classList.add('hidden')
  if (keep && text && textAt) commit({ t: 'text', x: textAt.x, y: textAt.y, size: textAt.size, c: textAt.c, text })
  textAt = null
  render()
}
$('text-input').addEventListener('blur', () => closeText(true))
$('text-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    closeText(true)
  } else if (e.key === 'Escape') closeText(false)
  e.stopPropagation()
})
$('text-input').addEventListener('input', (e) => {
  e.target.style.height = 'auto'
  e.target.style.height = e.target.scrollHeight + 'px'
})

function setTool(t) {
  tool = t
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === t)
  canvas.style.cursor = t === 'text' ? 'text' : 'crosshair'
}
for (const b of document.querySelectorAll('[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool))

for (const c of COLORS) {
  const b = document.createElement('button')
  b.style.background = c
  b.title = c
  b.setAttribute('aria-label', `Colour ${c}`)
  b.addEventListener('click', () => {
    color = c
    for (const x of $('swatches').children) x.classList.toggle('active', x === b)
  })
  if (c === color) b.classList.add('active')
  $('swatches').appendChild(b)
}
for (const s of SIZES) {
  const b = document.createElement('button')
  b.title = `Stroke ${s}`
  b.innerHTML = `<span style="height:${Math.max(2, s / 1.5)}px"></span>`
  b.addEventListener('click', () => {
    size = s
    for (const x of $('sizes').children) x.classList.toggle('active', x === b)
  })
  if (s === size) b.classList.add('active')
  $('sizes').appendChild(b)
}
$('undo').addEventListener('click', undo)
$('redo').addEventListener('click', redo)

// ---------- export ----------

const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/png'))

async function download() {
  const blob = await toBlob(flatten())
  const url = URL.createObjectURL(blob)
  try {
    await api.downloads.download({ url, filename: `Rekoto/${fileName()}.png`, saveAs: false, conflictAction: 'uniquify' })
    toast('Saved to Downloads\\Rekoto')
  } catch (e) {
    toast(`Download failed: ${e.message || e}`, { error: true })
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
}

async function saveToPc() {
  if (saveTo === 'downloads') return download()
  toast('Saving…', { sticky: true })
  const r = await api.runtime.sendMessage({ type: 'img:save', name: fileName(), dataUrl: flatten().toDataURL('image/png') })
  if (r && r.ok) {
    toast('Saved to Pictures\\Rekoto', { action: { label: 'Show in folder', run: () => api.runtime.sendMessage({ type: 'img:reveal', path: r.path }) } })
  } else {
    // Desktop app not running: keep the image anyway.
    await download()
    toast(`${(r && r.error) || 'Rekoto app not available'} Saved to Downloads\\Rekoto instead.`, { error: true })
  }
}

async function copy() {
  try {
    const blob = await toBlob(flatten())
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    toast('Image copied')
  } catch (e) {
    toast(`Could not copy: ${e.message || e}`, { error: true })
  }
}

async function extractText() {
  if (!base) return
  toast('Reading text…', { sticky: true })
  // Windows OCR handles up to 10,000 px per side; slice very tall full-page shots.
  const MAX = 9000
  const parts = []
  const scale = base.width > MAX ? MAX / base.width : 1
  for (let y = 0; y < base.height; y += MAX / scale) {
    const h = Math.min(MAX / scale, base.height - y)
    const c = makeCanvas(base.width * scale, h * scale)
    c.getContext('2d').drawImage(base, 0, y, base.width, h, 0, 0, c.width, c.height)
    const r = await api.runtime.sendMessage({ type: 'img:ocr', dataUrl: c.toDataURL('image/png') })
    if (!r || !r.ok) {
      toast((r && r.error) || 'Text extraction failed', { error: true })
      return
    }
    parts.push(r.text || '')
  }
  const text = parts.join('\n').trim()
  $('ocr-text').value = text || 'No text found in this image.'
  $('ocr-panel').classList.remove('hidden')
  document.body.classList.add('ocr-open')
  toast(text ? 'Text extracted' : 'No text found')
}

$('save').addEventListener('click', saveToPc)
$('download').addEventListener('click', download)
$('copy').addEventListener('click', copy)
$('ocr').addEventListener('click', extractText)
$('ocr-close').addEventListener('click', () => {
  $('ocr-panel').classList.add('hidden')
  document.body.classList.remove('ocr-open')
})
$('ocr-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('ocr-text').value)
  toast('Text copied')
})

// ---------- sources: desktop, file, clipboard ----------

async function captureDesktop() {
  let stream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
  } catch {
    return // user cancelled the picker
  }
  try {
    const v = document.createElement('video')
    v.muted = true
    v.srcObject = stream
    await v.play()
    await new Promise((r) => setTimeout(r, 250)) // first frames can be black
    const c = makeCanvas(v.videoWidth, v.videoHeight)
    c.getContext('2d').drawImage(v, 0, 0)
    setBase(c)
  } finally {
    stream.getTracks().forEach((t) => t.stop())
  }
}

async function loadBlob(blob) {
  const url = URL.createObjectURL(blob)
  try {
    setBase(await fromImage(url))
    if (blob.name) $('name').value = blob.name.replace(/\.[a-z0-9]+$/i, '')
  } catch (e) {
    toast(e.message, { error: true })
  } finally {
    URL.revokeObjectURL(url)
  }
}

$('pick-desktop').addEventListener('click', captureDesktop)
$('open-file').addEventListener('click', () => $('file').click())
$('file').addEventListener('change', (e) => e.target.files[0] && loadBlob(e.target.files[0]))
$('paste').addEventListener('click', async () => {
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (type) return loadBlob(await item.getType(type))
    }
    toast('No image on the clipboard', { error: true })
  } catch {
    toast('Press Ctrl+V to paste the image', { error: true })
  }
})
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
  if (item) loadBlob(item.getAsFile())
})
window.addEventListener('dragover', (e) => {
  e.preventDefault()
  document.body.classList.add('drag-over')
})
window.addEventListener('dragleave', () => document.body.classList.remove('drag-over'))
window.addEventListener('drop', (e) => {
  e.preventDefault()
  document.body.classList.remove('drag-over')
  const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'))
  if (f) loadBlob(f)
})

// ---------- keyboard ----------

window.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey && !typing) { e.preventDefault(); undo() }
    else if ((k === 'y' || (k === 'z' && e.shiftKey)) && !typing) { e.preventDefault(); redo() }
    else if (k === 's') { e.preventDefault(); if (base) saveToPc() }
    else if (k === 'c' && !typing && base && !window.getSelection()?.toString()) { e.preventDefault(); copy() }
    return
  }
  if (typing) return
  const map = { p: 'pen', h: 'highlight', a: 'arrow', l: 'line', r: 'rect', e: 'ellipse', t: 'text', b: 'blur', c: 'crop' }
  if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()])
  if (e.key === 'Escape' && draft) { draft = null; render() }
})

// ---------- start ----------

;(async () => {
  const v = await api.storage.local.get('rkSaveTo')
  saveTo = v.rkSaveTo || 'pc'
  $('save').lastChild.textContent = saveTo === 'downloads' ? ' Save to Downloads' : ' Save to PC'
  const id = location.hash.slice(1)
  const job = id ? await takeShot(id) : null
  $('name').value = job?.name || 'Screenshot'
  document.title = `${$('name').value} · Rekoto`
  if (!job || job.kind === 'open') {
    $('empty-open').classList.remove('hidden')
    return
  }
  if (job.kind === 'desktop') {
    $('empty-desktop').classList.remove('hidden')
    return
  }
  try {
    setBase(job.kind === 'pieces' ? await stitch(job) : await fromImage(job.image, job.crop))
    if (job.truncated) toast('This page is very long, so the capture stops at the browser’s image size limit.')
    if (job.ocr) await extractText()
  } catch (e) {
    toast(e.message || String(e), { error: true, sticky: true })
  }
})()
