// Regression: /api/recall must return a FLAT envelope
// `{ query, mode, searchedSpaces, results: [...] }`.
//
// It used to be double-wrapped as `{ results: { results: [...] } }` because the
// route re-wrapped gateway.recall()'s already-complete return value. Callers and
// docs both expect the flat shape, so a nested `results.results` is a bug.
import { apply } from '../lib/index.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateFile = join(tmpdir(), `gw-recall-shape-${process.pid}.json`)
const routes = []

// A fake gateway is injected through the tool path: recall() shells out to the
// mnemon CLI, which is not what this test is about — the HTTP envelope is.
const boom = () => { throw new Error('agent path must NOT be used for /api/recall') }
const ctx = {
  config: { defaultSpace: 'default' },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  webServer: { register: (r) => { routes.push(r); return () => {} } },
  agents: { async create() { boom() }, async withInitiator() { boom() } },
  tools: { async execute() { boom() } },
  effect: () => () => {},
}
apply(ctx, { port: 18995, token: 'shapetoken', tokenFile: stateFile, defaultSpace: 'default' })

const route = routes.find((r) => r.kind === 'exact' && r.path === '/api/recall')
if (!route) { console.error('FAIL: /api/recall route missing'); process.exit(1) }

const body = JSON.stringify({ query: 'envelope shape probe', limit: 1 })
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
