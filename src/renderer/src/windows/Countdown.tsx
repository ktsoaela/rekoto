import { useEffect, useState } from 'react'

export default function Countdown() {
  const [n, setN] = useState(3)
  useEffect(() => {
    const t = window.setInterval(() => setN((v) => Math.max(1, v - 1)), 1000)
    return () => window.clearInterval(t)
  }, [])
  return (
    <div className="countdown">
      <span key={n}>{n}</span>
    </div>
  )
}
