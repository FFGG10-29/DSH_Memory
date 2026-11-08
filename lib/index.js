/**
 * dsh-memory-gateway — Memory-routing Host plugin (v0.4.2).
 *
 * External AI tools write/recall/delete memory over HTTP.
 *
 * WRITE:  external tool -> gateway -> borrow a LIVE TOP-LEVEL agent
 *         (NOT a subagent — subagent origin would bypass the coordinator and
 *         do a blind direct write) -> mnemon_remember, with the coordinator's
 *         distill+classify picking the right Memory Space.
 *
 * RECALL: external tool -> gateway -> borrow a LIVE TOP-LEVEL agent and wake a
 *         REAL turn via followup(), so the agent calls `mnemon_recall` INSIDE a
 *         turn. That tool hardcodes `requirePinnedView:true` (the "View pinned
 *         to the current turn" gate) which ONLY a real running turn can satisfy.
 *         The coordinator then routes across EVERY provider (Mnemon Native +
 *         Hindsight + Mem0 + Honcho + …) — no per-provider adapter needed.
 *         Cost: one LLM generation per recall (token + latency). This is the
 *         only public path that covers all providers without coupling to
 *         dsh-mnemon's private RPC. `--store <uuid|name>` scopes to a Space.
 *
 * DELETE: external tool -> gateway -> borrow a LIVE TOP-LEVEL agent ->
 *         mnemon_forget (coordinator.write does NOT require a pinned view, so it
 *         covers all providers incl. remote banks). Falls back to the native
 *         `mnemon` CLI sweeping local stores when the agent path is unavailable.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import z from '@deepseek-ai/schemastery';
/** Flatten a tool/assistant content block (string | text-part[] | {text}) to a string. */
function textContent(content) {
    if (content == null)
        return '';
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content.map((p) => (p && p.type === 'text' ? String(p.text ?? '') : '')).join('');
    }
    if (typeof content === 'object' && 'text' in content)
        return String(content.text ?? '');
    return String(content);
}
export const name = 'dsh-memory-gateway';
export const inject = ['webServer', 'agents', 'tools', 'agentDefaultModel', 'agentPresets', 'llm'];
export const Config = z.object({
    port: z.number().default(8890).description("Standalone gateway HTTP port (bound to 127.0.0.1). Independent of DSH own web port."),
    token: z.string().default("").description("Bearer token. Empty => auto-generated + persisted."),
    tokenFile: z.string().default("").description("Token state file; defaults to <DSH_HOME>/memory-gateway.state.json."),
    defaultSpace: z.string().default("default").description("Fallback space when the caller names none AND coordinator yields nothing."),
    mnemonCli: z.string().default("").description("Explicit path to the mnemon CLI binary; empty => auto-discovered on PATH / common locations."),
    adminToken: z.string().default("").description("Owner admin token, required for /api/forget when allowExternalDelete is off. Empty + off => delete unavailable."),
    allowExternalDelete: z.boolean().default(false).description("允许外部工具（用共享 Bearer token）DELETE 记忆。关闭时 /api/forget 需独立 adminToken。"),
});
class Gateway {
    ctx;
    config;
    token;
    effectiveAdminToken;
    statePath;
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
        const dshHome = process.env.DSH_HOME || '';
        this.statePath = config.tokenFile || (dshHome ? join(dshHome, 'memory-gateway.state.json') : join(process.cwd(), 'memory-gateway.state.json'));
        // Runtime settings written by the plugin page live NEXT TO the token state
        // file, so both DSH (this plugin) and external tools see one location.
        this.settingsPath = join(dirname(this.statePath), 'memory-gateway.config.json');
        this.overrides = this.readSettings();
        this.token = this.resolveToken();
        // adminToken: prefer explicit plugin config; fall back to the state file so
        // the DSH owner can enable delete without the config UI. Empty => disabled.
        this.effectiveAdminToken = config.adminToken || this.readAdminTokenFromState();
    }
    /** Runtime-mutable settings, persisted by the plugin page (survives reloads). */
    settingsPath;
    overrides = {};
    /** Read persisted runtime settings. Never throws — a corrupt file is ignored. */
    readSettings() {
        try {
            const parsed = JSON.parse(readFileSync(this.settingsPath, 'utf8'));
            return parsed && typeof parsed === 'object' ? parsed : {};
        }
        catch {
            return {};
        }
    }
    /**
     * Merge a settings patch from the plugin page and persist it immediately.
     * These take effect on the NEXT request (no DSH restart) because every reader
     * below resolves through the getters instead of the load-time config object.
     */
    updateSettings(patch) {
        const next = { ...this.overrides };
        if (typeof patch.allowExternalDelete === 'boolean')
            next.allowExternalDelete = patch.allowExternalDelete;
        for (const key of ['adminToken', 'defaultSpace']) {
            if (typeof patch[key] === 'string')
                next[key] = String(patch[key]).trim();
        }
        this.overrides = next;
        this.effectiveAdminToken = next.adminToken || this.config.adminToken || this.readAdminTokenFromState();
        try {
            mkdirSync(dirname(this.settingsPath), { recursive: true });
            writeFileSync(this.settingsPath, JSON.stringify(next, null, 2), 'utf8');
        }
        catch (err) {
            this.ctx.logger?.warn?.('memory-gateway: failed to persist settings', err);
        }
        return this.publicSettings();
    }
    /** Masked, UI-safe view of the effective settings. */
    publicSettings() {
        const adminToken = this.getAdminToken();
        return {
            port: this.config.port,
            tokenHint: this.token.slice(0, 8) + '…',
            allowExternalDelete: this.getAllowExternalDelete(),
            adminTokenSet: !!adminToken,
            adminTokenHint: adminToken ? adminToken.slice(0, 4) + '…' + adminToken.slice(-4) : '',
            defaultSpace: this.getDefaultSpace(),
            settingsPath: this.settingsPath,
            persisted: Object.keys(this.overrides).length > 0,
        };
    }
    getAllowExternalDelete() {
        if (typeof this.overrides.allowExternalDelete === 'boolean')
            return this.overrides.allowExternalDelete;
        return this.config.allowExternalDelete === true;
    }
    getDefaultSpace() {
        return this.overrides.defaultSpace || this.config.defaultSpace || 'default';
    }
    /** Read a persisted adminToken from the state file (owner-managed fallback). */
    readAdminTokenFromState() {
        try {
            const parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
            return parsed.adminToken || '';
        }
        catch {
            return '';
        }
    }
    /** Locate the mnemon CLI binary. Cached after first resolution. */
    _mnemonCli = null;
    async resolveMnemonCli() {
        if (this._mnemonCli)
            return this._mnemonCli;
        const tryPath = (p) => {
            try {
                return statSync(p).isFile() ? p : null;
            }
            catch {
                return null;
            }
        };
        const configPath = this.config.mnemonCli?.trim();
        if (configPath) {
            const f = tryPath(configPath);
            if (f)
                return (this._mnemonCli = f);
        }
        // 1) Official resolver — the exact module dsh-mnemon itself uses to find the binary.
        try {
            const spec = 'dsh-mnemon-source-memory-spaces/native-cli';
            const mod = await import(/* @vite-ignore */ spec);
            const found = mod.findMnemonCommand({ cliPath: undefined });
            if (found && tryPath(found))
                return (this._mnemonCli = found);
        }
        catch { /* module not resolvable in this context */ }
        // 2) Manual PATH search. On Windows execFileSync needs the full path + extension.
        const pathEnv = process.env.PATH || process.env.Path || '';
        for (const dir of pathEnv.split(';').filter(Boolean)) {
            for (const ext of ['.exe', '.cmd', '']) {
                const f = tryPath(join(dir, 'mnemon' + ext));
                if (f)
                    return (this._mnemonCli = f);
            }
        }
        // 3) Common install locations.
        const common = [
            join(process.env.LOCALAPPDATA || '', 'Programs', 'mnemon', 'mnemon.exe'),
            join(process.env.USERPROFILE || '', 'go', 'bin', 'mnemon.exe'),
        ];
        for (const c of common) {
            const f = tryPath(c);
            if (f)
                return (this._mnemonCli = f);
        }
        return (this._mnemonCli = 'mnemon');
    }
    resolveToken() {
        if (this.config.token && this.config.token.length > 0)
            return this.config.token;
        let existingAdminToken = '';
        try {
            const parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
            if (parsed.token) {
                existingAdminToken = parsed.adminToken || '';
                return parsed.token;
            }
        }
        catch { /* no persisted token */ }
        const token = randomUUID().replace(/-/g, '');
        try {
            mkdirSync(dirname(this.statePath), { recursive: true });
            const record = { token, port: this.config.port, createdAt: new Date().toISOString() };
            // Persist the owner-managed admin token (if any) so delete can be enabled
            // from the state file without the config UI. Preserve an existing one so a
            // reload never wipes it.
            const adminToken = this.config.adminToken || existingAdminToken || '';
            if (adminToken)
                record.adminToken = adminToken;
            writeFileSync(this.statePath, JSON.stringify(record), 'utf8');
        }
        catch (err) {
            this.ctx.logger?.warn?.('memory-gateway: failed to persist token', err);
        }
        return token;
    }
    getToken() { return this.token; }
    /** Owner-managed admin token. Re-reads the state file at call time so an
     *  owner can flip delete on/off by editing the file WITHOUT a reload. */
    getAdminToken() {
        if (this.overrides.adminToken)
            return this.overrides.adminToken;
        if (this.config.adminToken)
            return this.config.adminToken;
        try {
            const parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
            if (parsed.adminToken)
                return parsed.adminToken;
        }
        catch { /* ignore */ }
        return this.effectiveAdminToken || '';
    }
    /**
     * Borrow a LIVE TOP-LEVEL agent (no origin:'subagent') so mnemon's coordinator
     * performs smart routing. withInitiator binds it onto the tool-exec context;
     * we also pass `agent` explicitly to guarantee exec.agent is populated.
     */
    async withMemoryAgent(op) {
        const cwd = process.cwd();
        const model = this.resolveModel();
        this.ctx.logger?.info?.(`[memory-gateway] borrowing agent with model=${model ? model.provider + '/' + model.model : 'none'}`);
        const handle = await this.ctx.agents.create({
            sessionId: `memory-gateway-${Date.now()}-${randomUUID().slice(0, 8)}`,
            meta: { cwd }, // NOTE: no origin:'subagent' -> top-level -> coordinator path
            ...(model ? { agentOptions: { provider: model.provider, model: model.model } } : {}),
        });
        try {
            return await this.ctx.agents.withInitiator(handle.agent, () => op(handle.agent));
        }
        finally {
            await handle.dispose();
        }
    }
    /** Invoke a dsh-mnemon tool from within the borrowed agent context. */
    async execTool(name, args, agent) {
        const signal = new AbortController().signal;
        return this.ctx.tools.execute({ name, arguments: args, agent, signal });
    }
    async remember(input) {
        return this.withMemoryAgent(async (agent) => {
            const args = {
                content: input.content,
                source: 'external',
            };
            if (input.hintSpace)
                args.memoryBodyId = input.hintSpace;
            if (input.category)
                args.category = input.category;
            if (input.importance != null)
                args.importance = input.importance;
            if (input.tags)
                args.tags = input.tags;
            if (input.entities)
                args.entities = input.entities;
            const result = await this.execTool('mnemon_remember', args, agent);
            return { routedBy: input.hintSpace ? 'hint' : 'coordinator', receipt: result };
        });
    }
    async recall(input) {
        // 智能召回：借顶层 agent 在其真实 turn 内调用 mnemon_recall，由 coordinator
        // 跨【全部 provider】路由（本地 mnemon + Hindsight + Mem0 + Honcho + …）。
        return this.recallViaAgent(input);
    }
    /**
     * 智能召回（全域通用）：借一个顶层 live agent，用 followup() 唤醒它跑一次真实
     * turn，让 agent 在 turn 内调用 `mnemon_recall`。该工具硬编码
     * `requirePinnedView:true`——只有「正在运行的真实 turn」才过门禁，所以必须靠
     * agent 自身 driver 驱动一个 turn，无法靠 withInitiator 伪造。
     *
     * coordinator 据此把检索路由到【全部 provider】（Mnemon Native + Hindsight +
     * Mem0 + Honcho + …），无需为每个 provider 单独写适配器。
     *
     * 全局召回时显式传入全部 space id（借来的 agent 没有 pinned view，空 pin 搜不
     * 到任何内容）；指定 space 时只传该 space。结果直接截取 mnemon_recall 工具返回
     * 的 JSON 信封，映射成本插件契约 `{query,mode,searchedSpaces,results}`。
     *
     * 代价：每次召回 = 一次 LLM 生成（烧少量 token、延迟数百 ms~数秒）。这是当前 DSH
     * 在不耦合私有 RPC 的前提下，覆盖全部 provider 的唯一公开路径（已与用户确认）。
     */
    async recallViaAgent(input) {
        const mode = input.mode || 'smart';
        const limit = input.limit != null ? input.limit : 5;
        const spaces = input.space
            ? [input.space]
            : (await this.listSpacesFromDisk()).spaces.map((s) => s.id);
        const prompt = `你是一名记忆检索助手。请调用工具 mnemon_recall 检索记忆，不要自己编造内容。\n` +
            `查询：${input.query}\n` +
            `模式：${mode}\n` +
            `召回条数：${limit}\n` +
            (spaces.length ? `仅在以下记忆空间内检索（memoryBodyIds）：${JSON.stringify(spaces)}\n` : '') +
            `要求：调用一次 mnemon_recall 即可，不需要额外说明。`;
        const captured = await this.withMemoryAgent(async (agent) => {
            const tryExtract = () => {
                const session = agent.session;
                const nodes = session?.surface?.nodes || [];
                // 优先：mnemon_recall 工具结果（结构化 JSON，最干净）
                for (const seq of nodes) {
                    const ev = session.eventAt(seq);
                    if (ev?.type === 'tool/result' && ev.data?.meta?.name === 'mnemon_recall') {
                        return textContent(ev.data?.message?.content);
                    }
                }
                // 回退：最后一条 assistant 文本
                for (let i = nodes.length - 1; i >= 0; i--) {
                    const ev = session.eventAt(nodes[i]);
                    if (ev?.type === 'message' && ev.data?.message?.role === 'assistant') {
                        return textContent(ev.data?.message?.content);
                    }
                }
                return null;
            };
            // 唤醒真实 turn（driver 在收到 followup 后自行驱动）
            if (typeof agent.followup === 'function') {
                agent.followup({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } });
            }
            let captured = null;
            let waited = 0;
            while (captured == null && waited < 30000) {
                if (typeof agent.whenIdle === 'function') {
                    await agent.whenIdle();
                }
                else {
                    await new Promise((r) => setTimeout(r, 1000));
                }
                captured = tryExtract();
                if (captured == null) {
                    await new Promise((r) => setTimeout(r, 200));
                    waited += 200;
                }
            }
            return captured;
        });
        if (!captured) {
            return { query: input.query, mode, searchedSpaces: spaces, results: [], note: 'agent recall produced no tool result' };
        }
        // 解析 mnemon_recall 信封
        let env = null;
        try {
            env = JSON.parse(captured.trim());
        }
        catch {
            const m = captured.match(/\{[\s\S]*\}/);
            if (m) {
                try {
                    env = JSON.parse(m[0]);
                }
                catch { /* ignore */ }
            }
        }
        if (!env || !Array.isArray(env.results)) {
            return { query: input.query, mode, searchedSpaces: spaces, results: [{ content: captured, source: 'raw' }] };
        }
        const searchedSpaces = Array.isArray(env.spaces)
            ? env.spaces.map((s) => (s && s.id) ? s.id : s)
            : (Array.isArray(env.searchedSpaces) ? env.searchedSpaces : spaces);
        return {
            query: env.query ?? input.query,
            mode: env.mode ?? mode,
            searchedSpaces,
            results: env.results,
        };
    }
    /** Ids of every Memory Space that has a mnemon database on disk. */
    listStoreIds(dataDir) {
        const root = join(dataDir, 'data');
        let ids = [];
        try {
            ids = readdirSync(root, { withFileTypes: true })
                .filter((d) => d.isDirectory())
                .map((d) => d.name)
                .filter((name) => {
                try {
                    return statSync(join(root, name, 'mnemon.db')).isFile();
                }
                catch {
                    return false;
                }
            });
        }
        catch { /* data dir missing => fall back to the active store only */ }
        return ids.length > 0 ? ids : ['default'];
    }
    async listSpaces() {
        // 外部工具从磁盘真相构建目录（provider state 文件 + 各 space 的 mnemon.db）。
        try {
            return this.listSpacesFromDisk();
        }
        catch {
            // 文件不可读时回退到 host agent 路径。
            return this.withMemoryAgent(async (agent) => {
                return this.execTool('mnemon_memory_bodies', { operation: 'list' }, agent);
            });
        }
    }
    listSpacesFromDisk() {
        const dataDir = (process.env.MNEMON_DATA_DIR || '').trim() || join(homedir(), '.mnemon');
        const spaces = [];
        const seen = new Set();
        // 1) Names / descriptions / provider links live in the provider state file.
        try {
            const raw = readFileSync(join(dataDir, 'state', 'memory-providers.json'), 'utf8');
            const parsed = JSON.parse(raw);
            for (const b of parsed.bodies || []) {
                if (!b || !b.id)
                    continue;
                seen.add(b.id);
                spaces.push({
                    id: b.id,
                    name: b.name || b.id,
                    description: b.description || '',
                    provider: b.providerId || 'mnemon',
                    active: b.active !== false,
                    connection: b.connection,
                });
            }
        }
        catch { /* state file is optional */ }
        // 2) Any store directory the state file does not know about.
        try {
            for (const name of readdirSync(join(dataDir, 'data'))) {
                if (seen.has(name))
                    continue;
                if (!existsSync(join(dataDir, 'data', name, 'mnemon.db')))
                    continue;
                seen.add(name);
                spaces.push({
                    id: name,
                    name: name === 'default' ? 'default（默认库）' : name.slice(0, 8) + '…',
                    description: '',
                    provider: 'mnemon',
                    active: true,
                });
            }
        }
        catch { /* data dir is optional */ }
        return { spaces, source: 'disk' };
    }
    async forget(input) {
        // 借顶层 agent 走 mnemon_forget（coordinator.write 不需 pin，覆盖全部 provider，
        // 含 Hindsight/远端 bank）。已知 space 时精确删除；未知 space 时把所有 space id
        // 交给 coordinator 定位。agent 路径失败（如 source 不可用）则回退 CLI 扫描本地 store。
        try {
            const memoryBodyIds = input.memoryBodyId
                ? [input.memoryBodyId]
                : (await this.listSpacesFromDisk()).spaces.map((s) => s.id);
            const out = await this.withMemoryAgent(async (agent) => {
                return this.execTool('mnemon_forget', { id: input.id, ...(memoryBodyIds.length ? { memoryBodyIds } : {}) }, agent);
            });
            const ok = out && out.ok !== false && out.status !== 'skipped' && out.status !== 'not_found';
            if (ok)
                return { status: 'deleted', id: input.id, space: input.memoryBodyId || 'multi', receipt: out };
        }
        catch { /* fall through to CLI */ }
        return this.forgetViaCli(input);
    }
    /** CLI 回退：逐 store 扫描本地 mnemon.db 软删（仅覆盖 Mnemon Native 本地库）。 */
    async forgetViaCli(input) {
        const cli = await this.resolveMnemonCli();
        const env = { ...process.env };
        if (!env.MNEMON_DATA_DIR || env.MNEMON_DATA_DIR.trim() === '') {
            env.MNEMON_DATA_DIR = join(homedir(), '.mnemon');
        }
        const useShell = /\.cmd$/i.test(cli) || /\.bat$/i.test(cli);
        // Every Memory Space owns a SEPARATE database, so an id is only findable in
        // the store that wrote it. A caller that names no space (the normal case for
        // an external tool, which only has the id from a recall row) must therefore
        // sweep all stores, otherwise the delete falsely reports "not found" for any
        // row living outside the default store.
        const stores = input.memoryBodyId ? [input.memoryBodyId] : this.listStoreIds(env.MNEMON_DATA_DIR);
        const searched = [];
        let lastDetail = '';
        let lastExit;
        for (const store of stores) {
            searched.push(store);
            try {
                const raw = execFileSync(cli, ['forget', input.id, '--store', store], {
                    encoding: 'utf8', env, windowsHide: true, timeout: 20000,
                    stdio: ['ignore', 'pipe', 'pipe'], shell: useShell,
                });
                let parsed = {};
                try {
                    parsed = JSON.parse(raw);
                }
                catch {
                    parsed = { raw: raw.trim() };
                }
                return { status: 'deleted', id: input.id, space: store, cli: parsed };
            }
            catch (e) {
                const stderr = typeof e.stderr === 'string' ? e.stderr : '';
                const stdout = typeof e.stdout === 'string' ? e.stdout : '';
                const detail = (stdout + '\n' + stderr).trim();
                // A store that does not hold the id is the expected miss; anything else
                // is a real failure and must surface immediately instead of being
                // masked by the sweep.
                if (!/not found or already deleted/i.test(detail)) {
                    return { status: 'error', id: input.id, space: store, detail, exitCode: e.status };
                }
                lastDetail = detail;
                lastExit = e.status;
            }
        }
        return { status: 'not_found', id: input.id, detail: lastDetail, exitCode: lastExit, searchedSpaces: searched };
    }
    /** Probe the live host for a usable default provider/model so we can seed our borrowed agent. */
    async probeModels() {
        const out = { services: [] };
        try {
            const keys = Object.keys(this.ctx).filter((k) => /model|agent|llm|preset|provider/i.test(k));
            out.services = keys;
        }
        catch (e) {
            out.servicesError = String(e?.message || e);
        }
        for (const svcName of ['agentDefaultModel', 'agentPresets', 'llm', 'models', 'modelService']) {
            try {
                const svc = this.ctx[svcName];
                if (svc === undefined) {
                    out[svcName] = 'undefined';
                    continue;
                }
                const rec = { type: typeof svc };
                try {
                    rec.currentSelection = svc.currentSelection?.();
                }
                catch (e) {
                    rec.currentSelectionError = String(e?.message || e);
                }
                try {
                    rec.resolve = await svc.resolve?.();
                }
                catch (e) {
                    rec.resolveError = String(e?.message || e);
                }
                try {
                    rec.listModels = typeof svc.listModels;
                }
                catch { }
                out[svcName] = rec;
            }
            catch (e) {
                out[svcName + 'Error'] = String(e?.message || e);
            }
        }
        return out;
    }
    /** Resolve a default provider/model to seed the borrowed top-level agent. */
    resolveModel() {
        try {
            const svc = this.ctx.agentDefaultModel;
            const sel = svc?.currentSelection?.();
            const provider = sel?.provider?.trim();
            const model = sel?.model?.trim();
            if (provider && model)
                return { provider, model };
        }
        catch { /* ignore */ }
        try {
            const presets = this.ctx.agentPresets;
            const resolved = presets?.resolve?.();
            const provider = resolved?.options?.provider?.trim() ?? resolved?.provider?.trim();
            const model = resolved?.options?.model?.trim() ?? resolved?.model?.trim();
            if (provider && model)
                return { provider, model };
        }
        catch { /* ignore */ }
        return null;
    }
}
// ---------- HTTP layer (raw node:http; DSH-agnostic ingress) ----------
async function readJson(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text)
        return {};
    return JSON.parse(text);
}
function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}
function buildHandler(gateway, token, ctx, config) {
    const authOk = (req) => {
        const header = req.headers['authorization'] || '';
        const m = /^Bearer\s+(.+)$/i.exec(String(header));
        return !!m && m[1] === token;
    };
    const authed = (handler) => async (req, res) => {
        if (!authOk(req)) {
            sendJson(res, 401, { error: 'unauthorized', message: 'Missing or invalid Authorization: Bearer <token>' });
            return;
        }
        try {
            await handler(req, res);
        }
        catch (err) {
            ctx.logger?.error?.('memory-gateway: request failed', err);
            sendJson(res, 500, { error: 'internal', message: String(err?.message || err) });
        }
    };
    return {
        health: (_req, res) => {
            sendJson(res, 200, {
                ok: true, plugin: name, version: '0.4.2',
                tokenHint: token.slice(0, 6) + '…',
                port: config.port,
                defaultSpace: gateway.getDefaultSpace(),
                allowExternalDelete: gateway.getAllowExternalDelete(),
                settingsPath: gateway.publicSettings().settingsPath,
            });
        },
        /**
         * Plugin-page settings API.
         *   GET  /api/config -> masked effective settings (no secret leaked).
         *   POST /api/config -> persist a patch and apply it live (no restart).
         *
         * Guarding: writes must carry `confirm: true` (the UI's 保存 button) so no
         * accidental click can flip a destructive switch. The server only listens on
         * 127.0.0.1, and any local process able to call this could already edit the
         * settings file directly — so this is a UX guard, not a privilege boundary.
         * Turning allowExternalDelete ON additionally requires an explicit
         * `allowExternalDelete: true` in the body (never implied by confirm alone).
         */
        configGet: async (_req, res) => {
            sendJson(res, 200, gateway.publicSettings());
        },
        configPost: async (req, res) => {
            let body;
            try {
                body = await readJson(req);
            }
            catch {
                sendJson(res, 400, { error: 'bad_request', message: 'invalid JSON body' });
                return;
            }
            if (body.confirm !== true) {
                sendJson(res, 400, { error: 'confirm_required', message: '插件页保存时必须带 confirm:true' });
                return;
            }
            const out = gateway.updateSettings(body);
            ctx.logger?.info?.(`memory-gateway: settings updated: allowExternalDelete=${out.allowExternalDelete}`);
            sendJson(res, 200, { ok: true, ...out });
        },
        remember: authed(async (req, res) => {
            const body = await readJson(req);
            if (!body.content) {
                sendJson(res, 400, { error: 'bad_request', message: 'content is required' });
                return;
            }
            res.writeHead(202, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'accepted' }));
            try {
                const out = await gateway.remember(body);
                ctx.logger?.info?.(`[memory-gateway] ${out.routedBy} routed write for source=${body.source || 'unknown'}`);
            }
            catch (err) {
                ctx.logger?.warn?.('memory-gateway: async remember failed', err);
            }
        }),
        writeDirect: authed(async (req, res) => {
            const body = await readJson(req);
            if (!body.content) {
                sendJson(res, 400, { error: 'bad_request', message: 'content is required' });
                return;
            }
            if (!body.hintSpace) {
                sendJson(res, 400, { error: 'bad_request', message: 'hintSpace is required for write-direct' });
                return;
            }
            const out = await gateway.remember({ ...body, hintSpace: body.hintSpace });
            sendJson(res, 200, { status: 'stored', space: body.hintSpace, receipt: out.receipt });
        }),
        recall: authed(async (req, res) => {
            const body = await readJson(req);
            if (!body.query) {
                sendJson(res, 400, { error: 'bad_request', message: 'query is required' });
                return;
            }
            const out = await gateway.recall(body);
            // `recall()` already returns the complete envelope
            // `{ query, mode, searchedSpaces, results }`. Re-wrapping it in another
            // `{ results: ... }` produced a doubly nested `{"results":{"results":[]}}`
            // that no caller or doc expects.
            sendJson(res, 200, out);
        }),
        // Built-in settings page. The DSH plugin card lives inside the Electron
        // renderer and depends on DSH's client-half loader; this route guarantees a
        // settings UI that works from any browser on this machine.
        admin: (_req, res) => {
            try {
                const here = dirname(fileURLToPath(import.meta.url));
                const html = readFileSync(join(here, 'admin.html'), 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                res.end(html);
            }
            catch (err) {
                sendJson(res, 500, { error: 'admin_page_missing', message: String(err?.message || err) });
            }
        },
        spaces: async (_req, res) => {
            try {
                const out = await gateway.listSpaces();
                if (out && Array.isArray(out.spaces)) {
                    sendJson(res, 200, { spaces: out.spaces, source: out.source });
                    return;
                }
                sendJson(res, 200, { spaces: Array.isArray(out) ? out : [] });
            }
            catch (err) {
                ctx.logger?.error?.('memory-gateway: spaces failed', err);
                sendJson(res, 500, { error: 'internal', message: String(err?.message || err) });
            }
        },
        debugRemember: authed(async (req, res) => {
            const body = await readJson(req);
            if (!body.content) {
                sendJson(res, 400, { error: 'bad_request', message: 'content is required' });
                return;
            }
            const started = Date.now();
            try {
                const out = await gateway.remember(body);
                sendJson(res, 200, { ok: true, ms: Date.now() - started, routedBy: out.routedBy, receipt: out.receipt });
            }
            catch (err) {
                // Surface the REAL error so we can see why the async write failed in the live host.
                sendJson(res, 200, { ok: false, ms: Date.now() - started, error: String(err?.message || err), stack: String(err?.stack || '').slice(0, 1200) });
            }
        }),
        debugProbe: authed(async (_req, res) => {
            const out = await gateway.probeModels();
            out.mnemonCli = await gateway.resolveMnemonCli();
            out.mnemonDataDir = process.env.MNEMON_DATA_DIR || join(homedir(), '.mnemon');
            out.fetchType = typeof globalThis.fetch;
            out.adminToken = gateway.getAdminToken();
            out.allowExternalDelete = gateway.getAllowExternalDelete();
            out.configAdmin = config.adminToken || '';
            sendJson(res, 200, out);
        }),
        debugRecall: authed(async (req, res) => {
            const body = await readJson(req);
            if (!body.query) {
                sendJson(res, 400, { error: 'bad_request', message: 'query is required' });
                return;
            }
            const started = Date.now();
            try {
                const out = await gateway.recall(body);
                sendJson(res, 200, { ok: true, ms: Date.now() - started, results: out });
            }
            catch (err) {
                sendJson(res, 200, { ok: false, ms: Date.now() - started, error: String(err?.message || err), stack: String(err?.stack || '').slice(0, 1200) });
            }
        }),
        /**
         * DESTRUCTIVE delete (soft-delete one insight by id). Guarded by the
         * SEPARATE `adminToken` — NOT the shared Bearer `token`. External tools
         * (WorkBuddy/CodeBuddy) only ever receive the Bearer token, so they cannot
         * reach this endpoint. The MCP thin-proxy (mcp-server.ts) also never
         * forwards forget. NOTE: this handler is intentionally NOT wrapped by
         * `authed` (which checks the shared Bearer token); it uses its own admin
         * guard below.
         */
        forget: async (req, res) => {
            // 删除门禁（插件页可配 allowExternalDelete）：
            //  开启 -> 外部工具用共享 Bearer token 即可删除；
            //  关闭 -> 仅拥有者用独立 adminToken 可删。
            const header = req.headers['authorization'] || '';
            const m = /^Bearer\s+(.+)$/i.exec(String(header));
            const presented = m ? m[1] : '';
            const adminToken = gateway.getAdminToken() || config.adminToken || '';
            const allowExternal = gateway.getAllowExternalDelete();
            if (allowExternal) {
                // 开关打开后：共享 Bearer token 即可删（拥有者 adminToken 仍然有效，
                // 避免"打开开关反而把拥有者自己锁在外面"）。
                const ok = !!presented && (presented === token || (!!adminToken && presented === adminToken));
                if (!ok) {
                    sendJson(res, 401, { error: 'forbidden', message: 'Missing or invalid Bearer token (external delete allowed).' });
                    return;
                }
            }
            else {
                if (!adminToken) {
                    sendJson(res, 403, { error: 'disabled', message: 'Delete disabled: enable 允许外部删除 in plugin config, or set owner adminToken.' });
                    return;
                }
                if (!presented || presented !== adminToken) {
                    sendJson(res, 401, { error: 'forbidden', message: 'This endpoint requires the owner adminToken while 允许外部删除 is off.' });
                    return;
                }
            }
            try {
                const body = await readJson(req);
                if (!body.id) {
                    sendJson(res, 400, { error: 'bad_request', message: 'id is required' });
                    return;
                }
                const out = await gateway.forget({ id: body.id, ...(body.memoryBodyId ? { memoryBodyId: body.memoryBodyId } : {}) });
                // out.status: 'deleted' | 'not_found' | 'error' (from the CLI path)
                const httpStatus = out.status === 'deleted' ? 200 : out.status === 'not_found' ? 404 : 500;
                sendJson(res, httpStatus, out);
            }
            catch (err) {
                ctx.logger?.error?.('memory-gateway: forget failed', err);
                sendJson(res, 500, { error: 'internal', message: String(err?.message || err) });
            }
        },
    };
}
/**
 * Cross-instance slot so a hot-reload can dispose the PREVIOUS instance's
 * webServer routes and standalone server before re-registering. Without this,
 * a reload re-runs apply() while the old exact routes (and the old port
 * binding) are still live, and ctx.webServer throws "duplicate exact route".
 */
const SLOT = Symbol.for('dsh-memory-gateway.instance');
/**
 * Bind a server to 127.0.0.1:port, tolerating EADDRINUSE: the previous
 * instance's server may still occupy the port for a few ms after we asked it
 * to close. Retry instead of throwing so apply() never aborts on reload.
 */
function listenWithRetry(server, port, logger, attempts = 8) {
    return new Promise((resolve, reject) => {
        let tries = 0;
        const tryOnce = () => {
            tries += 1;
            const onErr = (err) => {
                if (err?.code === 'EADDRINUSE' && tries < attempts) {
                    logger?.warn?.(`memory-gateway: port ${port} busy (old instance?), retrying ${tries}/${attempts}`);
                    setTimeout(tryOnce, 250);
                }
                else {
                    reject(err);
                }
            };
            server.once('error', onErr);
            server.listen(port, '127.0.0.1', () => {
                server.removeListener('error', onErr);
                resolve();
            });
        };
        tryOnce();
    });
}
export function apply(ctx, config) {
    const gateway = new Gateway(ctx, config);
    const token = gateway.getToken();
    const handlers = buildHandler(gateway, token, ctx, config);
    // --- hot-reload safety: dispose the previous instance first ---
    const prev = globalThis[SLOT];
    if (prev) {
        for (const d of prev.webDisposers || []) {
            try {
                d();
            }
            catch { /* idempotent */ }
        }
        try {
            prev.server?.close?.();
        }
        catch { /* already closing */ }
    }
    // Register on DSH's own webServer too (bonus; primary ingress is the raw server below).
    // Aliases /api/memory/* (friendlier external-tool path) map to the same handlers.
    // Each wrapped: a duplicate exact route (left over from a reload) must not abort apply().
    const webDisposers = [];
    /** One path, two methods: GET = read settings, POST = save settings. */
    const configRoute = async (req, res) => {
        if (req.method === 'POST')
            return await handlers.configPost(req, res);
        return await handlers.configGet(req, res);
    };
    const routes = [
        ['/api/health', handlers.health],
        ['/api/config', configRoute],
        ['/api/remember', handlers.remember],
        ['/api/memory/remember', handlers.remember],
        ['/api/write-direct', handlers.writeDirect],
        ['/api/memory/write-direct', handlers.writeDirect],
        ['/api/recall', handlers.recall],
        ['/api/memory/recall', handlers.recall],
        ['/api/spaces', handlers.spaces],
        ['/api/memory/spaces', handlers.spaces],
        ['/admin', handlers.admin],
        ['/admin/', handlers.admin],
        ['/api/debug/remember', handlers.debugRemember],
        ['/api/debug/recall', handlers.debugRecall],
        ['/api/forget', handlers.forget],
        ['/api/memory/forget', handlers.forget],
    ];
    for (const [path, handler] of routes) {
        try {
            const d = ctx.webServer?.register?.({ kind: 'exact', path, handler });
            if (typeof d === 'function')
                webDisposers.push(d);
        }
        catch (err) {
            ctx.logger?.warn?.(`memory-gateway: skip webServer route ${path}: ${String(err?.message || err)}`);
        }
    }
    // Standalone gateway server on 127.0.0.1:port — THIS is what external tools hit.
    const server = createServer(async (req, res) => {
        try {
            // The gateway is fetched cross-origin by the DSH plugin page (DSH web port
            // != 8890), so every response must be CORS-readable. The listener is bound
            // to 127.0.0.1 only, so a wildcard origin exposes nothing beyond loopback.
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
            res.setHeader('Access-Control-Max-Age', '600');
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }
            const url = new URL(req.url || '/', `http://127.0.0.1:${config.port}`);
            const route = url.pathname;
            if (route === '/api/health')
                return handlers.health(req, res);
            if (route === '/api/config')
                return await configRoute(req, res);
            if (route === '/api/remember' || route === '/api/memory/remember')
                return await handlers.remember(req, res);
            if (route === '/api/write-direct' || route === '/api/memory/write-direct')
                return await handlers.writeDirect(req, res);
            if (route === '/api/recall' || route === '/api/memory/recall')
                return await handlers.recall(req, res);
            if (route === '/api/spaces' || route === '/api/memory/spaces')
                return await handlers.spaces(req, res);
            if (route === '/admin' || route === '/admin/')
                return handlers.admin(req, res);
            if (route === '/api/debug/remember')
                return await handlers.debugRemember(req, res);
            if (route === '/api/debug/probe')
                return await handlers.debugProbe(req, res);
            if (route === '/api/debug/recall')
                return await handlers.debugRecall(req, res);
            if (route === '/api/forget' || route === '/api/memory/forget')
                return await handlers.forget(req, res);
            sendJson(res, 404, { error: 'not_found' });
        }
        catch (err) {
            sendJson(res, 500, { error: 'internal', message: String(err?.message || err) });
        }
    });
    listenWithRetry(server, config.port, ctx.logger)
        .then(() => ctx.logger?.info?.(`memory-gateway: standalone ingress on 127.0.0.1:${config.port}`))
        .catch((err) => ctx.logger?.error?.(`memory-gateway: standalone server failed: ${String(err?.message || err)}`));
    ctx.logger?.info?.(`memory-gateway: ready. Token (first 6): ${token.slice(0, 6)}…`);
    ctx.effect(() => () => {
        for (const d of webDisposers) {
            try {
                d();
            }
            catch { /* idempotent */ }
        }
        server.close();
    });
    globalThis[SLOT] = { webDisposers, server };
}
