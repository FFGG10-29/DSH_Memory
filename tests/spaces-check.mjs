// Verify /api/spaces works WITHOUT any pinned DSH View (external-client path).
import { apply } from '../lib/index.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateFile = join(tmpdir(), `gw-spaces-${process.pid}.json`)
const routes = []
const boom = () => { throw new Error('agent path must NOT be used for /api/spaces') }
const ctx = {
  config: { defaultSpace: 'default' },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  webServer: { register: (r) => { routes.push(r); return () => {} } },
  agents: { async create() { boom() }, async withInitiator() { boom() } },
  tools: { async execute() { boom() } },
  effect: () => () => {},
}
apply(ctx, { port: 18994, token: 'spacetoken', tokenFile: stateFile, defaultSpace: 'default' })

const route = routes.find((r) => r.kind === 'exact' && r.path === '/api/spaces')
if (!route) { console.error('FAIL: /api/spaces route missing'); process.exit(1) }

const res = {
  statusCode: 0, body: '', headers: {},
  writeHead(s, h) { this.statusCode = s; this.headers = h || {}; return this },
  end(b) { this.body = b; return this },
}
await route.handler({ headers: { authorization: 'Bearer spacetoken' }, method: 'GET' }, res)
console.log('HTTP', res.statusCode)
console.log(String(res.body).slice(0, 2000))
process.exit(0)
