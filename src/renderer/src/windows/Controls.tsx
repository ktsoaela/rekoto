import { useEffect, useState } from 'react'
import type { RecState } from '@shared/types'
import { formatDuration } from '../util'

export default function Controls() {
  const [state, setState] = useState<RecState | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    void window.api.invoke<RecState>('rec:state').then(setState)
    const off = window.api.on('rec:state', (s) => setState(s as RecState))
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => {
      off()
      window.clearInterval(t)
    }
  }, [])

  const act = (a: string): void => void window.api.invoke('controls:action', a)
  const elapsed = state?.startedAt
    ? (state.pausedAt ?? now) - state.startedAt - state.pausedMs
    : 0
  const paused = state?.status === 'paused'
  const processing = state?.status === 'processing'

  return (
    <div className="controls">
      <span className={`rec-dot ${paused ? 'paused' : ''}`} />
      <span className="timer">{processing ? 'Saving…' : formatDuration(elapsed / 1000)}</span>
      <div className="controls-buttons">
        <button title={paused ? 'Resume (Alt+Shift+P)' : 'Pause (Alt+Shift+P)'} onClick={() => act(paused ? 'resume' : 'pause')} disabled={processing}>
          {paused ? '▶' : '❚❚'}
        </button>
        <button className="stop" title="Stop and save (Alt+Shift+S)" onClick={() => act('stop')} disabled={processing}>
          ■ Stop
        </button>
        <button title="Discard (Alt+Shift+C)" onClick={() => act('cancel')} disabled={processing}>
          ✕
        </button>
      </div>
    </div>
  )
}
