/**
 * dsh-memory-gateway — MCP stdio shell.
 *
 * This is a THIN stdio <-> HTTP proxy. It does NOT run inside the DSH process.
 * External MCP clients (Cursor, Claude Code, VS Code, …) spawn this as a child
 * process over stdio. It forwards tool calls to the in-DSH gateway's HTTP API
 * (the gateway already borrows a live top-level DSH agent and delegates
 * classification to dsh-mnemon — none of that runs here).
 *
 * Connection discovery (in priority order):
 *   1. env DSMG_TOKEN / DSMG_PORT / DSMG_HOST
 *   2. the gateway's persisted state file (<DSH_HOME>/memory-gateway.state.json)
 *   3. defaults: host 127.0.0.1, port 8890, token "" (must be set somewhere)
 *
 * The MCP transport here is newline-delimited JSON-RPC 2.0 over stdio, which is
 * what the DSH MCP client and most MCP hosts speak on stdio.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

interface GwState { token?: string; port?: number; host?: string }

function discoverConnection(): { token: string; port: number; host: string } {
  const host = process.env.DSMG_HOST || '127.0.0.1'
  const port = process.env.DSMG_PORT ? Number(process.env.DSMG_PORT) : 0
  const token = process.env.DSMG_TOKEN || ''

  // Try the persisted state file if env did not fully specify.
  if (!port || !token) {
    const statePath = process.env.DSMG_STATE ||
      join(process.env.DSH_HOME || '', 'memory-gateway.state.json')
    if (statePath) {
      try {
        const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as GwState
        return {
          token: token || parsed.token || '',
          port: port || parsed.port || 8890,
          host,
        }
      } catch { /* ignore; fall through to defaults */ }
    }
  }
  return { token, port: port || 8890, host }
}

/**
 * The destructive /api/forget endpoint is guarded by a SECOND secret — the
 * adminToken — deliberately not the shared Bearer token. The gateway can also
 * be switched to accept external deletes from its plugin page
 * (`allowExternalDelete`); in that case the shared token is enough and the
 * adminToken is only a fallback for older gateways.
 *
 * Resolution order: env DSMG_ADMIN_TOKEN -> gateway state file (several known
 * locations, since the DSH_HOME layout differs between installs).
 */
function discoverAdminToken(): string {
  const env = process.env.DSMG_ADMIN_TOKEN || ''
  if (env) return env
  const candidates = [
    process.env.DSMG_STATE || '',
    join(process.env.DSH_HOME || '', 'profiles', 'desktop', 'memory-gateway.state.json'),
    join(process.env.DSH_HOME || '', 'memory-gateway.state.json'),
    join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'profiles', 'desktop', 'memory-gateway.state.json'),
    join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'memory-gateway.state.json'),
  ].filter(Boolean)
  for (const p of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as GwState & { adminToken?: string }
      if (parsed.adminToken) return parsed.adminToken
    } catch { /* try next */ }
  }
  return ''
}

const conn = discoverConnection()

const TOOLS = [
  {
    name: 'memory_remember',
    description: 'Store a memory into DSH. DSH (dsh-mnemon) classifies and routes it to the best Memory Space automatically. Omit space to let DSH decide.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The memory content to store.' },
        source: { type: 'string', description: 'Calling tool name, e.g. "cursor".' },
        space: { type: 'string', description: 'OPTIONAL: force a target Memory Space (skips smart routing).' },
        category: { type: 'string', description: 'OPTIONAL:' },
        importance: { type: 'number', description: 'OPTIONAL: 1-5.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'OPTIONAL.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_recall',
    description: 'Recall memories from DSH. Omit space to search ALL active Memory Spaces (smart recall).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language recall query.' },
        space: { type: 'string', description: 'OPTIONAL: restrict to one Space.' },
        limit: { type: 'number', description: 'OPTIONAL: max results, default 5.' },
        mode: { type: 'string', enum: ['smart', 'keyword', 'basic'], description: 'OPTIONAL: recall mode.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_write_direct',
    description: 'Write directly to a named Memory Space with NO smart routing. Requires space.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The memory content to store.' },
        space: { type: 'string', description: 'Target Memory Space name (required).' },
        source: { type: 'string', description: 'OPTIONAL: calling tool name.' },
      },
      required: ['content', 'space'],
    },
  },
  {
    name: 'memory_spaces',
    description: 'List all available DSH Memory Spaces.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'memory_forget',
    description: 'DESTRUCTIVE: soft-delete ONE memory by its exact id (taken from memory_recall results). Requires confirm=true as an explicit second confirmation. One call deletes one id — there is no bulk delete.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Exact memory id (full uuid) to forget.' },
        space: { type: 'string', description: 'OPTIONAL: the Memory Space id that holds this memory (the `space` field of a recall row). Omit to sweep every Space.' },
        confirm: { type: 'boolean', description: 'Must be true. Explicit acknowledgement that this memory will be deleted.' },
      },
      required: ['id', 'confirm'],
    },
  },
]

async function httpPost(path: string, body: unknown, authToken?: string): Promise<any> {
  const url = `http://${conn.host}:${conn.port}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken || conn.token}`,
    },
    body: JSON.stringify(body || {}),
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data }
}

async function httpGet(path: string): Promise<any> {
  const url = `http://${conn.host}:${conn.port}${path}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${conn.token}` },
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data }
}

function toContent(data: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }]
}

async function callTool(name: string, args: Record<string, any>): Promise<{ content: any[]; isError?: boolean }> {
  try {
    if (name === 'memory_remember') {
      const r = await httpPost('/api/remember', {
        content: args.content,
        source: args.source,
        hintSpace: args.space,
        category: args.category,
        importance: args.importance,
        tags: args.tags,
      })
      return { content: toContent(r.data), isError: r.status >= 400 }
    }
    if (name === 'memory_recall') {
      const r = await httpPost('/api/recall', {
        query: args.query,
        space: args.space,
        limit: args.limit,
        mode: args.mode,
      })
      return { content: toContent(r.data), isError: r.status >= 400 }
    }
    if (name === 'memory_write_direct') {
      const r = await httpPost('/api/write-direct', {
        content: args.content,
        hintSpace: args.space,
        source: args.source,
      })
      return { content: toContent(r.data), isError: r.status >= 400 }
    }
    if (name === 'memory_spaces') {
      const r = await httpGet('/api/spaces')
      return { content: toContent(r.data), isError: r.status >= 400 }
    }
    if (name === 'memory_forget') {
      if (args.confirm !== true) {
        return {
          content: toContent({
            error: 'confirmation_required',
            message: 'Refusing to delete: pass confirm=true to acknowledge that this memory will be soft-deleted.',
          }),
          isError: true,
        }
      }
      if (!args.id || typeof args.id !== 'string') {
        return { content: toContent({ error: 'bad_request', message: 'id (full uuid) is required' }), isError: true }
      }
      // Prefer the shared token: the gateway accepts external deletes when its
      // plugin page switch `allowExternalDelete` is ON. Fall back to adminToken
      // for gateways that keep the old admin-only rule.
      // Omit space => the gateway sweeps every Memory Space database.
      const body: Record<string, unknown> = { id: args.id }
      if (typeof args.space === 'string' && args.space.trim()) body.memoryBodyId = args.space.trim()
      const shared = await httpPost('/api/forget', body)
      if (shared.status !== 401 && shared.status !== 403) {
        return { content: toContent(shared.data), isError: shared.status >= 400 }
      }
      const adminToken = discoverAdminToken()
      if (!adminToken) {
        return { content: toContent(shared.data), isError: true }
      }
      const r = await httpPost('/api/forget', body, adminToken)
      return { content: toContent(r.data), isError: r.status >= 400 }
    }
    return { content: toContent({ error: `unknown tool ${name}` }), isError: true }
  } catch (err: any) {
    return { content: toContent({ error: String(err?.message || err) }), isError: true }
  }
}

/**
 * Core message handler — returns the JSON-RPC response object to send back,
 * or null for notifications that need no reply. Exported so it can be unit
 * tested in-process without spawning a child process.
 */
export async function handleMessage(raw: any): Promise<any | null> {
  let msg = raw
  if (typeof raw === 'string') {
    try { msg = JSON.parse(raw) } catch { return null }
  }
  if (!msg || typeof msg !== 'object') return null
  const id = msg.id
  const method = msg.method

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'dsh-memory-gateway', version: '0.4.2' },
      },
    }
  }
  if (method === 'notifications/initialized') return null
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
  }
  if (method === 'tools/call') {
    const name = msg.params?.name
    const args = msg.params?.arguments || {}
    const result = await callTool(name, args)
    return { jsonrpc: '2.0', id, result }
  }
  if (id !== undefined) {
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } }
  }
  return null
}

/**
 * stdio transport. Two framings are spoken on the same pipe:
 *   - `Content-Length: N\r\n\r\n{json}` — the OFFICIAL MCP stdio framing used by
 *     WorkBuddy / Claude Code / VS Code / Cursor.
 *   - bare newline-delimited JSON — tolerated for hand-rolled clients and for
 *     `echo '{"jsonrpc":...}' | node mcp-server.js`.
 * Replies MIRROR the framing the client used. This matters: the MCP spec
 * mandates newline-delimited JSON over stdio and the official TS/Python/Rust
 * SDKs (Claude Code, Codex, Cursor, Zed) only parse that. WorkBuddy/CodeBuddy
 * send Content-Length, so answering them with newline would break them; and
 * answering the SDK clients with Content-Length breaks them. Per-request
 * framing is the only correct behaviour.
 */
type Framing = 'content-length' | 'newline'

if (process.env.DSMG_NO_STDIO !== '1') {
  let buf = Buffer.alloc(0)

  const writeResponse = (resp: any, framing: Framing) => {
    const body = JSON.stringify(resp)
    if (framing === 'newline') {
      process.stdout.write(body + '\n')
    } else {
      process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    }
  }

  const dispatch = (text: string, framing: Framing) => {
    let parsed: any
    try { parsed = JSON.parse(text) } catch { return }
    handleMessage(parsed)
      .catch(() => null)
      .then((resp) => { if (resp) writeResponse(resp, framing) })
  }

  const pump = () => {
    for (;;) {
      // Try Content-Length framing first.
      const sep = buf.indexOf('\r\n\r\n')
      if (sep >= 0) {
        const header = buf.subarray(0, sep).toString('utf8')
        const m = /Content-Length:\s*(\d+)/i.exec(header)
        if (m) {
          const len = Number(m[1])
          const start = sep + 4
          if (buf.length < start + len) return // wait for the rest
          const body = buf.subarray(start, start + len).toString('utf8')
          buf = buf.subarray(start + len)
          dispatch(body, 'content-length')
          continue
        }
      }
      // Fallback: newline-delimited JSON (MCP spec; Claude Code / Codex / Cursor).
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      const line = buf.subarray(0, nl).toString('utf8').trim()
      buf = buf.subarray(nl + 1)
      if (line) dispatch(line, 'newline')
    }
  }

  process.stdin.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk])
    pump()
  })
  // Signal readiness to the host (used by some MCP launchers).
  process.stderr.write(`dsh-memory-gateway MCP stdio ready (target http://${conn.host}:${conn.port})\n`)
}
