/* Test/ops CLI for the dsh-memory-gateway MCP server.
 *
 * Spawns lib/mcp-server.js exactly like a real MCP host (official
 * Content-Length framing) and issues one tool call, so the gateway can be
 * verified without WorkBuddy/CodeBuddy/Cursor in the loop.
 *
 *   node tests/mcp-cli.mjs list
 *   node tests/mcp-cli.mjs recall "某条记忆"
 *   node tests/mcp-cli.mjs remember "some durable fact"
 *   node tests/mcp-cli.mjs forget <full-uuid>
 *
 * Connection: DSMG_TOKEN / DSMG_PORT / DSMG_HOST / DSMG_ADMIN_TOKEN env vars,
 * otherwise the persisted state file is used (same discovery as the server).
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const STATE = join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'desktop', 'memory-gateway.state.json')
const env = { ...process.env }
if (existsSync(STATE)) { env.DSMG_STATE = STATE; if (!env.DSH_HOME) env.DSH_HOME = join(process.env.USERPROFILE || '', '.dsh') }

const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'lib', 'mcp-server.js')], {
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
})
child.stderr.on('data', (d) => process.stderr.write('[srv] ' + d))

let buf = Buffer.alloc(0)
const pending = new Map()
child.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n')
    if (sep < 0) return
    const m = /Content-Length:\s*(\d+)/i.exec(buf.subarray(0, sep).toString('utf8'))
    if (!m) { buf = buf.subarray(sep + 4); continue }
    const start = sep + 4
    const len = Number(m[1])
    if (buf.length < start + len) return
    const body = buf.subarray(start, start + len).toString('utf8')
    buf = buf.subarray(start + len)
    let msg
    try { msg = JSON.parse(body) } catch { continue }
    if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
})

let nextId = 1
function send(method, params) {
  const id = nextId++
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)) } }, 120000)
    timer.unref?.()
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg) })
    child.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`)
  })
}

const [cmd, ...rest] = process.argv.slice(2)
await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcp-cli', version: '1.0' } })

let res
if (cmd === 'list') {
  res = await send('tools/list', {})
  console.log((res.result?.tools || []).map((t) => t.name).join('\n'))
} else if (cmd === 'recall') {
  res = await send('tools/call', { name: 'memory_recall', arguments: { query: rest.join(' '), mode: process.env.MODE || undefined, limit: 8 } })
  console.log(res.result?.content?.[0]?.text || JSON.stringify(res))
} else if (cmd === 'remember') {
  res = await send('tools/call', { name: 'memory_remember', arguments: { content: rest.join(' '), source: 'workbuddy' } })
  console.log(res.result?.content?.[0]?.text || JSON.stringify(res))
} else if (cmd === 'forget') {
  res = await send('tools/call', { name: 'memory_forget', arguments: { id: rest[0], confirm: true } })
  console.log(res.result?.content?.[0]?.text || JSON.stringify(res))
} else {
  console.log('usage: node tests/mcp-cli.mjs list|recall|remember|forget [args]')
}
child.kill()

child.on("exit", () => process.exit(0))
process.on("exit", () => { try { child.kill() } catch {} })
