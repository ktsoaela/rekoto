import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import Bubble from './windows/Bubble'
import Controls from './windows/Controls'
import Countdown from './windows/Countdown'
import { runRecorder } from './windows/recorder'

const route = window.location.hash.replace('#', '') || 'main'
document.documentElement.dataset.route = route

if (route === 'recorder') {
  void runRecorder()
} else {
  const root = createRoot(document.getElementById('root')!)
  if (route === 'bubble') root.render(<Bubble />)
  else if (route === 'controls') root.render(<Controls />)
  else if (route === 'countdown') root.render(<Countdown />)
  else root.render(<App />)
}
