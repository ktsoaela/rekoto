// Masks password and other secret fields while the desktop app is recording,
// and reports the page viewport so the recorder can crop out tabs, address bar and bookmarks.
;(() => {
  if (window.__RekotoContent) return
  window.__RekotoContent = true
  const api = globalThis.browser ?? globalThis.chrome

  const SECRET_SELECTOR = [
    'input[type="password"]',
    'input[data-lc-secret]',
    'input[autocomplete~="current-password"]',
    'input[autocomplete~="new-password"]',
    'input[autocomplete~="one-time-code"]',
    'input[autocomplete~="one-time-code" i]',
    'input[autocomplete~="cc-number"]',
    'input[autocomplete~="cc-csc"]',
    'input[name*="password" i]',
    'input[id*="password" i]',
    'input[name*="passwd" i]',
    'input[autocomplete="otp"]'
  ].join(',')

  const CSS = `
html.lc-mask :is(${SECRET_SELECTOR}) {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  text-shadow: none !important;
  caret-color: transparent !important;
  -webkit-text-security: disc !important;
  background-image: repeating-linear-gradient(-45deg, rgba(128,128,128,.45) 0 6px, rgba(128,128,128,.2) 6px 12px) !important;
}
html.lc-mask :is(${SECRET_SELECTOR})::selection { background: transparent !important; color: transparent !important; }
html.lc-mask :is(${SECRET_SELECTOR})::placeholder { color: transparent !important; }
html.lc-mask :is(${SECRET_SELECTOR}):-webkit-autofill { -webkit-text-fill-color: transparent !important; }
/* Soft-hide common page-level password manager banners drawn in the document */
html.lc-mask [data-lastpass-icon-root],
html.lc-mask [data-dashlane-root],
html.lc-mask [data-bwfilled],
html.lc-mask iframe[src*="chrome-extension://"] { opacity: 0 !important; pointer-events: none !important; }
`

  let styleEl = null
  let masked = false

  // Fields that were ever password fields stay masked, even if a "show password" toggle switches them to text.
  const tag = (root) => {
    if (!root.querySelectorAll) return
    root.querySelectorAll('input[type="password"]').forEach((el) => el.setAttribute('data-lc-secret', ''))
  }

  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes' && m.target instanceof HTMLInputElement && m.target.type === 'password') {
        m.target.setAttribute('data-lc-secret', '')
      }
      for (const n of m.addedNodes) {
        if (n instanceof HTMLInputElement && n.type === 'password') n.setAttribute('data-lc-secret', '')
        else if (n.nodeType === 1) tag(n)
      }
    }
  })

  function setMask(on) {
    masked = !!on
    if (masked && !styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = 'lc-mask-style'
      styleEl.textContent = CSS
      ;(document.head || document.documentElement).appendChild(styleEl)
    }
    document.documentElement.classList.toggle('lc-mask', masked)
  }

  const start = () => {
    tag(document)
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['type'] })
  }
  if (document.documentElement) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })

  api.storage.local.get(['lcMask', 'lcAlwaysMask']).then((v) => setMask(v.lcMask || v.lcAlwaysMask)).catch(() => {})
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if ('lcMask' in changes || 'lcAlwaysMask' in changes) {
      api.storage.local.get(['lcMask', 'lcAlwaysMask']).then((v) => setMask(v.lcMask || v.lcAlwaysMask))
    }
  })

  // ---------- screenshot helpers ----------

  const frames = (n = 2) => new Promise((r) => { const step = () => (n-- <= 0 ? r() : requestAnimationFrame(step)); requestAnimationFrame(step) })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  /** Lets the user drag a rectangle over the page. Resolves with CSS-pixel coordinates in the viewport. */
  function selectArea(label) {
    return new Promise((resolve) => {
      const host = document.createElement('div')
      host.setAttribute('data-rekoto-overlay', '')
      const root = host.attachShadow({ mode: 'closed' })
      root.innerHTML = `
        <style>
          .layer { position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; background: rgba(0,0,0,.35); }
          .box { position: fixed; border: 2px solid #ffc400; box-shadow: 0 0 0 9999px rgba(0,0,0,.45); background: transparent; display: none; }
          .hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); background: #141414; color: #fff;
                  font: 600 13px/1 system-ui, 'Segoe UI', sans-serif; padding: 10px 16px; border-radius: 999px; pointer-events: none; }
          .hint b { color: #ffc400; }
          .size { position: fixed; background: #ffc400; color: #141414; font: 700 11px/1 system-ui, sans-serif; padding: 4px 7px; border-radius: 6px; display: none; pointer-events: none; }
        </style>
        <div class="layer"><div class="box"></div><div class="size"></div><div class="hint">${label} · <b>Esc</b> to cancel</div></div>`
      const layer = root.querySelector('.layer')
      const box = root.querySelector('.box')
      const size = root.querySelector('.size')
      let start = null
      const rectFrom = (e) => {
        const x = Math.min(start.x, e.clientX), y = Math.min(start.y, e.clientY)
        return { x, y, w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) }
      }
      const finish = async (result) => {
        window.removeEventListener('keydown', onKey, true)
        host.remove()
        await frames(2) // make sure the overlay is gone from the next captured frame
        await sleep(30)
        resolve(result)
      }
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish({ cancel: true }) } }
      layer.addEventListener('mousedown', (e) => {
        e.preventDefault()
        start = { x: e.clientX, y: e.clientY }
        layer.style.background = 'transparent'
        box.style.display = 'block'
      })
      layer.addEventListener('mousemove', (e) => {
        if (!start) return
        const r = rectFrom(e)
        Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' })
        Object.assign(size.style, { display: 'block', left: r.x + 'px', top: Math.max(0, r.y - 24) + 'px' })
        size.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`
      })
      layer.addEventListener('mouseup', (e) => {
        if (!start) return
        const r = rectFrom(e)
        if (r.w < 6 || r.h < 6) return finish({ cancel: true })
        finish({ rect: r, vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio })
      })
      window.addEventListener('keydown', onKey, true)
      document.documentElement.appendChild(host)
    })
  }

  // Full page: the background scrolls us step by step and captures each viewport.
  let fp = null
  function fpStart() {
    const se = document.scrollingElement || document.documentElement
    fp = { startY: window.scrollY, startX: window.scrollX, hidden: [], behavior: se.style.scrollBehavior }
    se.style.scrollBehavior = 'auto'
    return {
      total: Math.max(se.scrollHeight, document.body ? document.body.scrollHeight : 0),
      vw: window.innerWidth,
      vh: window.innerHeight,
      dpr: window.devicePixelRatio,
      title: document.title
    }
  }
  function hideFixed() {
    // After the first screen, fixed headers/footers would repeat in every slice: hide them.
    for (const el of document.querySelectorAll('body *')) {
      const pos = getComputedStyle(el).position
      if ((pos === 'fixed' || pos === 'sticky') && el.style.visibility !== 'hidden') {
        fp.hidden.push([el, el.style.visibility])
        el.style.setProperty('visibility', 'hidden', 'important')
      }
    }
  }
  async function fpScroll(y, hide) {
    if (hide && fp && !fp.hidden.length) hideFixed()
    window.scrollTo(0, y)
    await frames(2)
    await sleep(120) // let lazy images and sticky layout settle
    return { y: window.scrollY }
  }
  function fpEnd() {
    if (!fp) return
    for (const [el, v] of fp.hidden) el.style.visibility = v
    const se = document.scrollingElement || document.documentElement
    se.style.scrollBehavior = fp.behavior
    window.scrollTo(fp.startX, fp.startY)
    fp = null
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || window.top !== window) return
    if (msg.type === 'viewport') {
      sendResponse({
        screenX: window.screenX,
        screenY: window.screenY,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight
      })
      return true
    }
    if (msg.type === 'sel:start') {
      selectArea(msg.label || 'Drag to select an area').then(sendResponse)
      return true
    }
    if (msg.type === 'fp:start') {
      sendResponse(fpStart())
      return true
    }
    if (msg.type === 'fp:scroll') {
      fpScroll(msg.y, msg.hideFixed).then(sendResponse)
      return true
    }
    if (msg.type === 'fp:end') {
      fpEnd()
      sendResponse({ ok: true })
      return true
    }
  })

  // Wake the background service worker so it can reconnect to the desktop app.
  try {
    api.runtime.sendMessage({ type: 'app:status' }).catch(() => undefined)
  } catch (_) {
    /* extension context invalidated */
  }
})()
