import { useEffect, useState } from 'react'

type Phase = { phase: 'prep' | 'count' | 'idle'; n: number }

export default function Countdown() {
  const [phase, setPhase] = useState<Phase>({ phase: 'idle', n: 0 })

  useEffect(() => {
    const off = window.api.on('countdown:phase', (p) => setPhase(p as Phase))
    return off
  }, [])

  if (phase.phase === 'idle') return null

  if (phase.phase === 'prep') {
    return (
      <div className="countdown">
        <div className="countdown-card prep">
          <span className="countdown-spin" aria-hidden />
          <strong>Starting</strong>
          <span className="countdown-sub">Almost there</span>
        </div>
      </div>
    )
  }

  return (
    <div className="countdown">
      <span className="countdown-digit" key={phase.n}>
        {phase.n}
      </span>
    </div>
  )
}
