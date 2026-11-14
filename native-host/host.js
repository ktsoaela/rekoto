// Native messaging host for the Rekoto browser extensions.
// Browsers start this process and speak length-prefixed JSON over stdin/stdout.
// It relays messages to the running desktop app over a named pipe.
'use strict'
const net = require('net')

const PIPE = '\\\\.\\pipe\\Rekoto-bridge'
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

let inBuf = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  inBuf = Buffer.concat([inBuf, chunk])
  while (inBuf.length >= 4) {
    const len = inBuf.readUInt32LE(0)
    if (inBuf.length < 4 + len) break
    const body = inBuf.subarray(4, 4 + len).toString('utf8')
    inBuf = inBuf.subarray(4 + len)
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
