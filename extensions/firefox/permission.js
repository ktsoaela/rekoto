// One-time page: browsers cannot show camera/mic prompts inside an extension popup.
document.getElementById('allow').addEventListener('click', async () => {
  const msg = document.getElementById('msg')
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    s.getTracks().forEach((t) => t.stop())
    msg.textContent = 'Done. Open the Rekoto popup again to see your camera.'
    setTimeout(() => window.close(), 1500)
  } catch (e) {
    msg.textContent =
      e && e.name === 'NotAllowedError'
        ? 'Access was blocked. Click the camera icon in the address bar to allow it, then try again.'
        : `Could not access the camera or microphone (${(e && e.message) || e}).`
  }
})
