import { useEffect, useRef, useState } from 'react'

const SIZES = [140, 200, 280, 380]

export default function Bubble() {
  const ref = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    void (async () => {
      try {
        const cfg = await window.api.invoke<{ cameraDeviceId: string }>('bubble:config')
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: cfg.cameraDeviceId ? { exact: cfg.cameraDeviceId } : undefined, width: { ideal: 640 }, height: { ideal: 480 } }
        })
        if (ref.current) {
          ref.current.srcObject = stream
          await ref.current.play()
        }
      } catch (e) {
        setError((e as Error).message || 'Camera unavailable')
      }
    })()
    return () => stream?.getTracks().forEach((t) => t.stop())
  }, [])

  return (
    <div className="bubble">
      <video ref={ref} muted playsInline />
      {error && <div className="bubble-error">{error}</div>}
      <div className="bubble-sizes">
        {SIZES.map((s, i) => (
          <button key={s} title={`Size ${i + 1}`} onClick={() => void window.api.invoke('bubble:size', s)}>
            <span style={{ width: 6 + i * 3, height: 6 + i * 3 }} />
          </button>
        ))}
      </div>
    </div>
  )
}
