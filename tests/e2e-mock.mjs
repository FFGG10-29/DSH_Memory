// Dev-only E2E smoke harness for dsh-memory-gateway.
// Loads the COMPILED lib/index.js with a fake ctx so we exercise the real HTTP
// route + agent-borrow glue without needing a live DSH host or mnemon.
//
// What this PROVES:
//   - /api/health is public (no token)
//   - /api/remember without token -> 401
//   - /api/remember with token -> agents.create -> agents.withInitiator -> tools.execute('mnemon_remember')
// What it CANNOT prove (needs live DSH): that withInitiator actually feeds
// exec.agent into mnemon, and that the row lands in D:\memory\data\default\mnemon.db.

import { apply } from '../lib/index.js'

// ---- fake ctx ---------------------------------------------------------------
const routes = []
let dispose = null
const calls = { create: 0, withInitiator: 0, toolsExecute: [] }

const fakeAgent = {
  session: { id: 'mock-session', header: { origin: 'subagent' } },
  dispose: async () => {},
}

const ctx = {
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  webServer: {
    register: (route) => { routes.push(route); return () => {} },
  },
  agents: {
    async create(opts) {
      calls.create++
      // record the origin we injected
      calls.lastOrigin = opts?.meta?.origin
      return { agent: fakeAgent, async dispose() {} }
    },
    async withInitiator(agent, op) {
      calls.withInitiator++
      calls.withInitiatorAgent = agent
      return op(agent)
    },
  },
  tools: {
    async execute(exec) {
      calls.toolsExecute.push(exec)
      return { ok: true, echoed: exec.arguments }
    },
  },
  effect: (fn) => { dispose = fn; return () => {} },
}

import { tmpdir } from 'node:os'
const stateFile = join(tmpdir(), `gw-test-state-${process.pid}.json`)

const config = {
  port: 18991,
  token: '',
  tokenFile: stateFile,
  defaultSpace: 'default',
  asyncWrite: false, // synchronous so the handler awaits the write
}

// ---- drive it ---------------------------------------------------------------
apply(ctx, config)

function findRoute(path) {
  return routes.find((r) => r.kind === 'exact' && r.path === path)
}

// minimal node req/res
function makeReq(headers = {}, body = '') {
  const chunks = Buffer.from(body)
  const req = {
    headers,
    url: '',
    method: 'POST',
    [Symbol.asyncIterator]: async function* () { yield chunks },
  }
  return req
}
function makeRes() {
  const res = { statusCode: 0, body: '', headers: {} }
  res.writeHead = (s, h) => { res.statusCode = s; res.headers = h || {}; return res }
  res.end = (b) => { res.body = b; return res }
  return res
}

const token = ctx // token is generated inside; we cannot read it directly.
// The plugin persists token to tokenFile only if set; here tokenFile='' and
// DSH_HOME unset -> falls back to cwd/memory-gateway.state.json. Read it back.
import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
let realToken
try { realToken = JSON.parse(readFileSync(stateFile, 'utf8')).token } catch { realToken = '' }

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1 }
  else console.log('PASS:', msg)
}

async function run() {
  // 1. health is public
  const health = findRoute('/api/health')
  assert(!!health, 'health route registered')
  const hres = makeRes()
  await health.handler(makeReq(), hres)
  assert(hres.statusCode === 200, '/api/health returns 200 without token')

  // 2. remember without token -> 401
  const remember = findRoute('/api/remember')
  assert(!!remember, 'remember route registered')
  const r1 = makeRes()
  await remember.handler(makeReq({}, JSON.stringify({ content: 'hi' })), r1)
  assert(r1.statusCode === 401, '/api/remember without token -> 401')

  // 3. remember with token -> agent borrow + tools.execute
  const r2 = makeRes()
  await remember.handler(
    makeReq({ authorization: `Bearer ${realToken}` }, JSON.stringify({ content: '用户偏好 pnpm', hintSpace: 'work' })),
    r2,
  )
  assert(r2.statusCode === 202, '/api/remember with token -> 202 accepted (async write)')
  await new Promise((r) => setTimeout(r, 80))
  assert(calls.create === 1, 'agents.create called exactly once')
  assert(calls.withInitiator === 1, 'agents.withInitiator called exactly once')
  assert(calls.toolsExecute.length === 1, 'tools.execute called once')
  const exec = calls.toolsExecute[0]
  assert(exec.name === 'mnemon_remember', "tools.execute name == 'mnemon_remember'")
  assert(exec.arguments.memoryBodyId === 'work', "memoryBodyId passed through as target space 'work'")
  assert(exec.arguments.source === 'external' || exec.arguments.source === undefined, 'source defaults to external')
  assert(exec.agent === fakeAgent, 'agent bound onto the execution input (exec.agent)')

  // cleanup persisted token so repeat runs are clean
  try { unlinkSync(stateFile) } catch {}
  if (dispose) dispose() // close raw server
  console.log('\nE2E mock harness done. Exit code:', process.exitCode || 0)
  process.exit(process.exitCode || 0)
}

run()
