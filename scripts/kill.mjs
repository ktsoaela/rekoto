import { execSync } from 'node:child_process'
import process from 'node:process'

const isWin = process.platform === 'win32'

function run(command) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    })
  } catch {
    return ''
  }
}

function killPid(pid) {
  if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return false
  try {
    if (isWin) {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true })
    } else {
      process.kill(pid, 'SIGTERM')
    }
    return true
  } catch {
    return false
  }
}

function listWindowsPids(imageName) {
  const raw = run(`tasklist /FI "IMAGENAME eq ${imageName}" /FO CSV /NH`)
  if (!raw || /No tasks are running/i.test(raw)) return []
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cols = line.match(/"(?:[^"]|"")*"/g) || []
      return Number((cols[1] || '').replaceAll('"', ''))
    })
    .filter((pid) => Number.isFinite(pid) && pid > 0)
}

let killed = 0

if (isWin) {
  for (const image of ['electron.exe', 'Rekoto.exe']) {
    for (const pid of listWindowsPids(image)) {
      if (killPid(pid)) {
        console.log(`Killed ${image} PID ${pid}`)
        killed += 1
      }
    }
  }
} else {
  const raw = run('ps -ax -o pid=,command=')
  const pids = [
    ...new Set(
      raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /loom_clone/.test(line))
        .filter((line) => /electron-vite|Electron|Rekoto/i.test(line))
        .map((line) => Number(line.split(/\s+/)[0]))
        .filter((pid) => Number.isFinite(pid) && pid > 0)
    )
  ]
  for (const pid of pids) {
    if (killPid(pid)) {
      console.log(`Killed PID ${pid}`)
      killed += 1
    }
  }
}

console.log(killed ? `Stopped ${killed} process(es).` : 'No Rekoto / electron processes found.')
