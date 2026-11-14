// Native messaging host for the Rekoto browser extensions.
// Browsers start this process and speak length-prefixed JSON over stdin/stdout.
// It relays messages to the running desktop app over a named pipe.
'use strict'
const net = require('net')
const fs = require('fs')
const path = require('path')

const PIPE = process.env.REKOTO_PIPE || '\\\\.\\pipe\\Rekoto-bridge'
try {
  const log = path.join(process.env.APPDATA || '', 'Rekoto', 'native-host', 'host.log')
  fs.appendFileSync(log, `${new Date().toISOString()} host.js start\n`)
} catch (_) {
  /* ignore */
}
let socket = null
let connected = false
let queue = []
let hello = null
let lineBuf = ''

function sendToBrowser(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8')
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length, 0)
  process.stdout.write(Buffer.concat([head, body]))
}

function sendToApp(msg) {
  if (msg && msg.type === 'hello') hello = msg
  if (connected) socket.write(JSON.stringify(msg) + '\n')
  else if (msg.type !== 'viewport') queue.push(msg)
  if (queue.length > 50) queue = queue.slice(-50)
}

function connect() {
  socket = net.connect(PIPE)
  socket.setEncoding('utf8')
  socket.on('connect', () => {
    connected = true
    sendToBrowser({ type: 'app', connected: true })
    if (hello) socket.write(JSON.stringify(hello) + '\n')
    for (const m of queue) if (m.type !== 'hello') socket.write(JSON.stringify(m) + '\n')
    queue = []
  })
  socket.on('data', (chunk) => {
    lineBuf += chunk
    let i
    while ((i = lineBuf.indexOf('\n')) >= 0) {
      const line = lineBuf.slice(0, i).trim()
      lineBuf = lineBuf.slice(i + 1)
      if (!line) continue
      try {
        sendToBrowser(JSON.parse(line))
      } catch (_) {
        /* ignore */
      }
    }
  })
  socket.on('error', () => {})
  socket.on('close', () => {
    if (connected) sendToBrowser({ type: 'app', connected: false })
    connected = false
    socket = null
    setTimeout(connect, 2000)
  })
}

// Collect chunks without re-copying: screenshots can be tens of megabytes.
let chunks = []
let have = 0
let need = -1
function take(n) {
  const out = Buffer.allocUnsafe(n)
  let off = 0
  while (off < n) {
    const c = chunks[0]
    const k = Math.min(c.length, n - off)
    c.copy(out, off, 0, k)
    off += k
    if (k === c.length) chunks.shift()
    else chunks[0] = c.subarray(k)
  }
  have -= n
  return out
}
process.stdin.on('data', (chunk) => {
  chunks.push(chunk)
  have += chunk.length
  for (;;) {
    if (need < 0) {
      if (have < 4) break
      need = take(4).readUInt32LE(0)
    }
    if (have < need) break
    const body = take(need).toString('utf8')
    need = -1
    try {
      sendToApp(JSON.parse(body))
    } catch (_) {
      /* ignore */
    }
  }
})
process.stdin.on('end', () => process.exit(0))

sendToBrowser({ type: 'app', connected: false })
connect()
