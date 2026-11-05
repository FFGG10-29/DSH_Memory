/**
 * MCP server test — in-process (no child spawn; sandbox blocks spawn).
 * Imports handleMessage from the compiled lib/mcp-server.js and drives it
 * against a real fake gateway HTTP server (fetch is allowed under the sandbox).
 */
import assert from 'node:assert'
import { createServer } from 'node:http'

const TOKEN = 'test-token-' + Math.random().toString(36).slice(2)
let PORT = 0
const received = []

const gw = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const auth = req.headers['authorization']
  let body = ''
  for await (const c of req) body += c
  received.push({ path: url.pathname, auth, body: body ? JSON.parse(body) : null })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true, path: url.pathname }))
})
await new Promise((r) => gw.listen(0, '127.0.0.1', r))
PORT = gw.address().port

// Point the MCP server's discovery at our fake gateway via env.
process.env.DSMG_NO_STDIO = '1'
process.env.DSMG_TOKEN = TOKEN
process.env.DSMG_PORT = String(PORT)
process.env.DSMG_HOST = '127.0.0.1'

const { handleMessage } = await import('../lib/mcp-server.js')

const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
assert.equal(init.result.serverInfo.name, 'dsh-memory-gateway')
assert(init.result.capabilities.tools, 'exposes tools capability')
console.log('PASS: initialize -> serverInfo + tools capability')

const tl = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
assert.equal(tl.result.tools.length, 5, '5 tools')
const names = tl.result.tools.map((t) => t.name).sort()
assert.deepEqual(names, ['memory_forget', 'memory_recall', 'memory_remember', 'memory_spaces', 'memory_write_direct'])
console.log('PASS: tools/list -> 5 tools (remember/recall/write_direct/spaces/forget)')

const call = await handleMessage({
  jsonrpc: '2.0', id: 3, method: 'tools/call',
  params: { name: 'memory_remember', arguments: { content: '用户偏好 pnpm', source: 'cursor' } },
})
assert(!call.result.isError, 'remember not error')
const fwd = received.find((r) => r.path === '/api/remember')
assert(fwd, 'gateway /api/remember hit')
assert.equal(fwd.auth, 'Bearer ' + TOKEN, 'Bearer token forwarded')
assert.equal(fwd.body.content, '用户偏好 pnpm')
assert.equal(fwd.body.source, 'cursor')
assert(!fwd.body.hintSpace, 'no space -> no hintSpace (coordinator decides)')
console.log('PASS: memory_remember -> POST /api/remember w/ Bearer token, content+source, no forced space')

const call2 = await handleMessage({
  jsonrpc: '2.0', id: 4, method: 'tools/call',
  params: { name: 'memory_recall', arguments: { query: 'pnpm 偏好' } },
})
assert(!call2.result.isError, 'recall not error')
const fwdR = received.find((r) => r.path === '/api/recall')
assert(fwdR && fwdR.body.query === 'pnpm 偏好', 'recall forwarded query')
console.log('PASS: memory_recall -> POST /api/recall w/ query')

const call3 = await handleMessage({
  jsonrpc: '2.0', id: 5, method: 'tools/call',
  params: { name: 'memory_write_direct', arguments: { content: 'raw note', space: 'work', source: 'vscode' } },
})
assert(!call3.result.isError, 'write_direct not error')
const fwdW = received.find((r) => r.path === '/api/write-direct')
assert(fwdW && fwdW.body.hintSpace === 'work', 'write_direct forwards space as hintSpace')
console.log('PASS: memory_write_direct -> POST /api/write-direct w/ hintSpace=work')

gw.close()
console.log('\nMCP in-process E2E done. Exit: 0')
process.exit(0)
