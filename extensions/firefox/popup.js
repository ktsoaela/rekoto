const api = globalThis.browser ?? globalThis.chrome
const $ = (id) => document.getElementById(id)

async function refresh() {
  const r = await api.runtime.sendMessage({ type: 'popup:get' })
  if (!r) return
  const status = $('status')
  $('alwaysMask').checked = r.alwaysMask
  $('help').classList.add('hidden')
  if (!r.appConnected) {
    status.textContent = 'Desktop app not connected'
    status.className = 'status bad'
    $('idle').classList.add('hidden')
    $('recording').classList.add('hidden')
    const help = $('help')
    help.classList.remove('hidden')
    help.textContent =
      r.hostError && /not found|not registered|No such native/i.test(r.hostError)
        ? 'Open the Loom Clone desktop app once so it can install the browser connection, then reopen this popup.'
        : 'Start the Loom Clone desktop app. This popup connects automatically.'
    return
  }
  if (r.state.recording) {
    status.textContent = r.state.paused ? 'Paused' : 'Recording…'
    status.className = 'status rec'
    $('idle').classList.add('hidden')
    $('recording').classList.remove('hidden')
    $('pause').textContent = r.state.paused ? 'Resume' : 'Pause'
  } else {
    status.textContent = 'Ready'
    status.className = 'status ok'
    $('idle').classList.remove('hidden')
    $('recording').classList.add('hidden')
  }
}

$('start').addEventListener('click', async () => {
  await api.runtime.sendMessage({ type: 'popup:start' })
  window.close()
})
$('stop').addEventListener('click', async () => {
  await api.runtime.sendMessage({ type: 'popup:stop' })
  window.close()
})
$('pause').addEventListener('click', async () => {
  await api.runtime.sendMessage({ type: 'popup:pause' })
  setTimeout(refresh, 300)
})
$('alwaysMask').addEventListener('change', (e) => api.runtime.sendMessage({ type: 'popup:alwaysMask', value: e.target.checked }))

refresh()
setInterval(refresh, 1000)
