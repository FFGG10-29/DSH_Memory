// Verify /api/forget sweeps every Memory Space when the caller names no space.
import { apply } from '../lib/index.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

// 不带参数时用一条肯定不存在的 id 做「全空间扫描」自检：
// 期望 HTTP 404 + status=not_found + 非空 searchedSpaces。
const id = process.argv[2] || '00000000-0000-0000-0000-000000000000'
const space = process.argv[3]
const probeMode = !process.argv[2]

const stateFile = join(tmpdir(), `gw-forget-${process.pid}.json`)
const routes = []
const ctx = {
  config: { defaultSpace: 'default' },
  logger: { info: () => {}, warn: () => {}, error: (...a) => console.error('[log]', ...a) },
  webServer: { register: (r) => { routes.push(r); return () => {} } },
  agents: { async create() { throw new Error('no agent expected') }, async withInitiator() { throw new Error('no agent expected') } },
  tools: { async execute() { throw new Error('no tool expected') } },
  effect: () => () => {},
}
apply(ctx, {
  port: 18995, token: 'forgettoken', adminToken: '', tokenFile: stateFile,
  defaultSpace: 'default', allowExternalDelete: true,
})

const route = routes.find((r) => r.kind === 'exact' && r.path === '/api/forget')
if (!route) { console.error('FAIL: /api/forget route missing'); process.exit(1) }

const payload = JSON.stringify(space ? { id, memoryBodyId: space } : { id })
const req = Object.assign(Readable.from([Buffer.from(payload)]), {
  headers: { authorization: 'Bearer forgettoken' },
  method: 'POST',
})
const res = {
  statusCode: 0, body: '',
  writeHead(s) { this.statusCode = s; return this },
  end(b) { this.body = b; return this },
}
await route.handler(req, res)
console.log('HTTP', res.statusCode)

if (probeMode) {
  // 自检：不传 id ⇒ 网关应扫遍所有空间，全部未命中才 404，并回报扫过哪些空间
  let body
  try { body = JSON.parse(String(res.body)) } catch { body = String(res.body).slice(0, 700) }
  const ok = res.statusCode === 404 && body?.status === 'not_found'
    && Array.isArray(body?.searchedSpaces) && body.searchedSpaces.length > 0
  console.log(ok ? 'PASS: 404 + not_found + searchedSpaces' : 'FAIL: unexpected 404 shape')
  if (!ok) { console.error(String(res.body).slice(0, 700)); process.exitCode = 1 }
  console.log('searchedSpaces:', JSON.stringify(body?.searchedSpaces))
} else {
  console.log(String(res.body).slice(0, 700))
}
process.exit(process.exitCode || 0)
