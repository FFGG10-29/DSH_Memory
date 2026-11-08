// Regression: /api/recall must return a FLAT envelope
// `{ query, mode, searchedSpaces, results: [...] }`.
//
// It used to be double-wrapped as `{ results: { results: [...] } }` because the
// route re-wrapped gateway.recall()'s already-complete return value. Callers and
// docs both expect the flat shape, so a nested `results.results` is a bug.
//
// Since v0.4.2 the recall path borrows a live top-level agent and wakes a real
// turn via followup(), then reads the `mnemon_recall` tool result off the session
// surface. The fake ctx below emulates exactly that, so this test stays hermetic
// (no DSH host, no mnemon CLI, no disk reads — we pass `space` to skip the
// on-disk space enumeration).
import { apply } from '../lib/index.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateFile = join(tmpdir(), `gw-recall-shape-${process.pid}.json`)
const routes = []

// The envelope the (fake) mnemon_recall tool would return.
const toolEnvelope = JSON.stringify({
  query: 'envelope shape probe',
  mode: 'smart',
  spaces: [{ id: 'default' }],
  results: [
    { id: 'r1', content: '命中一条', score: 0.9 },
    { id: 'r2', content: '命中二条', score: 0.8 },
  ],
})

// ---- fake agent with a session surface -------------------------------------
let nextSeq = 1
const events = new Map()
const nodes = []
const fakeAgent = {
  session: {
    id: 'mock-session',
    header: {}, // 顶层 agent：不要 origin:'subagent'
    surface: { nodes },
    eventAt: (seq) => events.get(seq),
  },
  // 模拟 driver：followup 后 agent 在 turn 内调用 mnemon_recall，产生 tool/result
  followup() {
    const seq = nextSeq++
    nodes.push(seq)
    events.set(seq, {
      type: 'tool/result',
      data: { meta: { name: 'mnemon_recall' }, message: { content: toolEnvelope } },
    })
  },
  whenIdle: async () => {},
  dispose: async () => {},
}

const ctx = {
  config: { defaultSpace: 'default' },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  webServer: { register: (r) => { routes.push(r); return () => {} } },
  agents: {
    async create() { return { agent: fakeAgent, dispose: async () => {} } },
    async withInitiator(agent, op) { return op(agent) },
  },
  tools: { async execute() { return { ok: true } } },
  effect: () => () => {},
}
apply(ctx, { port: 18995, token: 'shapetoken', tokenFile: stateFile, defaultSpace: 'default' })

const route = routes.find((r) => r.kind === 'exact' && r.path === '/api/recall')
if (!route) { console.error('FAIL: /api/recall route missing'); process.exit(1) }

// 传 space 让 recall 跳过磁盘空间枚举，保持自测与环境无关
const body = JSON.stringify({ query: 'envelope shape probe', limit: 1, space: 'default' })
const res = {
  statusCode: 0, body: '', headers: {},
  writeHead(s, h) { this.statusCode = s; this.headers = h || {}; return this },
  end(b) { this.body = b; return this },
}
await route.handler({
  method: 'POST',
  headers: { authorization: 'Bearer shapetoken', 'content-type': 'application/json' },
  async *[Symbol.asyncIterator]() { yield Buffer.from(body) },
}, res)

console.log('HTTP', res.statusCode)
const out = JSON.parse(String(res.body))
const keys = Object.keys(out)
console.log('top keys:', keys.join(','))

let ok = true
if (res.statusCode !== 200) { console.error('FAIL: status', res.statusCode); ok = false }
if (!keys.includes('results')) { console.error('FAIL: missing results'); ok = false }
if (!Array.isArray(out.results)) {
  console.error('FAIL: results is not an array — got', typeof out.results, '(double-wrapped?)')
  ok = false
}
if (!keys.includes('searchedSpaces')) { console.error('FAIL: missing searchedSpaces'); ok = false }
if (out.results && !Array.isArray(out.results) && Array.isArray(out.results.results)) {
  console.error('FAIL: still double-wrapped at results.results')
  ok = false
}

console.log(ok ? 'PASS: flat envelope { query, mode, searchedSpaces, results[] }' : 'FAIL')
process.exit(ok ? 0 : 1)
