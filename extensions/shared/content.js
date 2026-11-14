// Masks password and other secret fields while the desktop app is recording,
// and reports the page viewport so the recorder can crop out tabs, address bar and bookmarks.
;(() => {
  if (window.__loomCloneContent) return
  window.__loomCloneContent = true
  const api = globalThis.browser ?? globalThis.chrome

  const SECRET_SELECTOR = [
    'input[type="password"]',
    'input[data-lc-secret]',
    'input[autocomplete~="current-password"]',
    'input[autocomplete~="new-password"]',
    'input[autocomplete~="one-time-code"]',
    'input[autocomplete~="cc-number"]',
    'input[autocomplete~="cc-csc"]'
  ].join(',')

  const CSS = `
html.lc-mask :is(${SECRET_SELECTOR}) {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  text-shadow: none !important;
  caret-color: transparent !important;
  -webkit-text-security: none !important;
  background-image: repeating-linear-gradient(-45deg, rgba(128,128,128,.45) 0 6px, rgba(128,128,128,.2) 6px 12px) !important;
}
html.lc-mask :is(${SECRET_SELECTOR})::selection { background: transparent !important; color: transparent !important; }
html.lc-mask :is(${SECRET_SELECTOR})::placeholder { color: transparent !important; }
html.lc-mask :is(${SECRET_SELECTOR}):-webkit-autofill { -webkit-text-fill-color: transparent !important; }
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
  })
})()
