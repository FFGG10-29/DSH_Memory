// Phase-2 smoke harness: proves the agent BORROWED for memory ops is TOP-LEVEL
// (origin !== 'subagent'), so dsh-mnemon's coordinator performs smart routing
// rather than a blind direct write. Also keeps the Phase-1 checks (auth, exec
// chain). Uses a plain-object fake ctx (no jest/vitest).

import { apply } from '../lib/index.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync } from 'node:fs'

const stateFile = join(tmpdir(), `gw-p2-state-${process.pid}.json`)

function makeCtx(agentOrigin) {
  const routes = []
  const calls = { create: 0, withInitiator: 0, toolsExecute: [], lastOrigin: null, lastAgent: null }
  const agent = {
    session: { id: 'mock-session', header: { origin: agentOrigin } },
    dispose: async () => {},
  }
  const ctx = {
    config: { defaultSpace: 'default' },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    agents: {
      async create(opts) { calls.create++; calls.lastOrigin = opts?.meta?.origin ?? null; return { agent, async dispose() {} } },
      async withInitiator(a, op) { calls.withInitiator++; calls.lastAgent = a; return op(a) },
    },
    tools: { async execute(exec) { calls.toolsExecute.push(exec); return { ok: true, echoed: exec.input } } },
    effect: (fn) => { ctx._dispose = fn; return () => {} },
  }
  return { ctx, routes, calls, agent }
}

function makeRes() {
  const res = { statusCode: 0, body: '', headers: {} }
  res.writeHead = (s, h) => { res.statusCode = s; res.headers = h || {}; return res }
  res.end = (b) => { res.body = b; return res }
  return res
}
function readJsonReq(body, headers = {}) {
  const chunks = Buffer.from(body || '')
  return { headers, method: 'POST', [Symbol.asyncIterator]: async function* () { yield chunks } }
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1 }
  else console.log('PASS:', msg)
}

async function run() {
  // ---------- TOP-LEVEL agent (smart routing expected) ----------
  const { ctx, routes, calls, agent } = makeCtx('top-level')
  const config = { port: 18992, token: '', tokenFile: stateFile, defaultSpace: 'default' }
  apply(ctx, config)
  let realToken
  try { realToken = JSON.parse(await import('node:fs').then((m) => m.readFileSync(stateFile, 'utf8'))).token } catch { realToken = '' }

  const findRoute = (p) => routes.find((r) => r.kind === 'exact' && r.path === p)

  assert(!!findRoute('/api/health'), 'health route registered')
  const hres = makeRes(); await findRoute('/api/health').handler(readJsonReq(), hres)
  assert(hres.statusCode === 200, '/api/health 200 without token')

  const rem = findRoute('/api/remember')
  const r1 = makeRes(); await rem.handler(readJsonReq(JSON.stringify({ content: 'hi' })), r1)
  assert(r1.statusCode === 401, '/api/remember no token -> 401')

  // remember handler returns 202 then writes in background; give it a tick
  const r2 = makeRes()
  await rem.handler(readJsonReq(JSON.stringify({ content: '我在写 DSH Universal Memory Hub，用 TypeScript', source: 'Cursor' }), { authorization: `Bearer ${realToken}` }), r2)
  assert(r2.statusCode === 202, '/api/remember with token -> 202 accepted')
  await new Promise((r) => setTimeout(r, 50))

  assert(calls.create === 1, 'agents.create called once (top-level)')
  assert(calls.lastAgent?.session?.header?.origin !== 'subagent', "borrowed agent origin is NOT 'subagent' (smart routing enabled)")
  assert(calls.withInitiator === 1, 'agents.withInitiator called once')
  assert(calls.toolsExecute.length === 1, 'tools.execute called once')
  const exec = calls.toolsExecute[0]
  assert(exec.name === 'mnemon_remember', "tools.execute name == 'mnemon_remember'")
  assert(exec.agent === agent, 'agent bound onto exec.agent')
  // 注意：ctx.tools.execute 的载荷字段名是 `arguments`（不是 `input`），
  // 这是 DSH 工具服务的真实契约，写错会报 "arguments must be losslessly JSON-serializable"。
  assert(exec.arguments.source === 'external', 'source forced to external')
  assert(exec.arguments.memoryBodyId === undefined, 'no hintSpace -> coordinator picks space (no memoryBodyId)')

  // ---------- SUBAGENT agent (control group: proves the test would CATCH a dumb-write path) ----------
  const bad = makeCtx('subagent')
  const cfg2 = { port: 18993, token: 'fixedtoken', tokenFile: '', defaultSpace: 'default' }
  apply(bad.ctx, cfg2)
  const badRem = bad.routes.find((r) => r.kind === 'exact' && r.path === '/api/remember')
  const br = makeRes()
  await badRem.handler(readJsonReq(JSON.stringify({ content: 'x', source: 'X' }), { authorization: 'Bearer fixedtoken' }), br)
  await new Promise((r) => setTimeout(r, 50))
  assert(bad.calls.lastAgent?.session?.header?.origin === 'subagent', "control harness: subagent origin recorded (would trigger dumb write in real mnemon)")

  try { unlinkSync(stateFile) } catch {}
  if (ctx._dispose) ctx._dispose()
  console.log('\nPhase-2 E2E done. Exit:', process.exitCode || 0)
  process.exit(process.exitCode || 0)
}

run()
