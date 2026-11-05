/* dsh-memory-gateway client half.
 *
 * DSH serves this to the Web GUI via the `dsh.client` declaration + the
 * `./client` package export. It registers ONE card into the
 * `plugins.bundle.config` slot (keyed by the bundle's package name), which DSH
 * renders on the bundle page BETWEEN the description and the component rows.
 *
 * Two hard requirements that are easy to get wrong:
 *   1. `exports.inject` MUST list "slots". Without it `ctx.slots` is undefined,
 *      `register()` throws, and the card silently never appears.
 *   2. The registered component must be a REACT function component. The slot
 *      renders a react tree; returning a raw DOM node yields nothing.
 *
 * The card is dependency-free apart from `react` (provided by the host):
 *   - live status rows (port / token hint / spaces)
 *   - the 允许外部删除 switch plus the knobs this plugin needs
 *   - reads GET /api/config, writes POST /api/config with confirm:true
 *     (applies immediately, no DSH restart)
 */
window.__ModuleLoader__.load({
  id: "dsh-memory-gateway",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const h = react.createElement;
    const { useState, useEffect, useCallback } = react;

    const BASE = "http://127.0.0.1:8890";

    const S = {
      wrap: { display: "flex", flexDirection: "column", gap: "14px", fontSize: "12.5px", color: "inherit" },
      section: { display: "flex", flexDirection: "column", gap: "8px" },
      row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", minHeight: "22px" },
      label: { opacity: 0.72 },
      mono: { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: "11.5px", opacity: 0.92, wordBreak: "break-all", textAlign: "right" },
      grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))", gap: "10px" },
      field: { display: "flex", flexDirection: "column", gap: "4px" },
      input: {
        padding: "6px 8px", fontSize: "12px", color: "inherit", boxSizing: "border-box", width: "100%",
        background: "rgba(128,128,128,.10)", border: "1px solid rgba(128,128,128,.35)", borderRadius: "6px", outline: "none",
      },
      hint: { fontSize: "11px", opacity: 0.58, lineHeight: 1.4 },
      divider: { height: "1px", background: "rgba(128,128,128,.22)" },
      btn: {
        padding: "5px 14px", fontSize: "12px", font: "inherit", color: "inherit", cursor: "pointer",
        background: "rgba(128,128,128,.12)", border: "1px solid rgba(128,128,128,.35)", borderRadius: "6px",
      },
      status: { fontSize: "11.5px", opacity: 0.72 },
      err: { fontSize: "11.5px", color: "#e5484d" },
    };

    async function getJson(path) {
      const r = await fetch(BASE + path, { method: "GET" });
      return r.json();
    }
    async function postJson(path, body) {
      const r = await fetch(BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      let parsed = {};
      try { parsed = await r.json(); } catch (e) { parsed = {}; }
      return { status: r.status, body: parsed };
    }

    function Row(props) {
      return h("div", { style: S.row },
        h("span", { style: S.label }, props.label),
        h("span", { style: S.mono }, props.value == null || props.value === "" ? "—" : String(props.value)),
      );
    }

    function Field(props) {
      return h("label", { style: S.field },
        h("span", { style: S.label }, props.label),
        h("input", {
          style: S.input,
          type: props.type || "text",
          value: props.value,
          placeholder: props.placeholder || "",
          spellCheck: false,
          autoComplete: "off",
          onChange: (e) => props.onChange(e.target.value),
        }),
        props.hint ? h("span", { style: S.hint }, props.hint) : null,
      );
    }

    function MemoryGatewayCard() {
      const [cfg, setCfg] = useState(null);
      const [spaces, setSpaces] = useState([]);
      const [connErr, setConnErr] = useState("");
      const [note, setNote] = useState("");
      const [busy, setBusy] = useState(false);
      const [form, setForm] = useState({
        allowExternalDelete: true,
        adminToken: "",
        defaultSpace: "",
      });

      const load = useCallback(async () => {
        try {
          const c = await getJson("/api/config");
          setCfg(c);
          setConnErr("");
          setForm((f) => ({
            ...f,
            allowExternalDelete: c.allowExternalDelete === true,
            defaultSpace: c.defaultSpace || "",
          }));
          try {
            const s = await getJson("/api/spaces");
            const list = Array.isArray(s && s.spaces) ? s.spaces : (Array.isArray(s) ? s : []);
            setSpaces(list);
          } catch (e) { /* spaces are informative only */ }
        } catch (e) {
          setConnErr("无法连接网关 127.0.0.1:8890 —— 请确认插件已启用、DSH 正在运行。");
        }
      }, []);

      useEffect(() => { load(); }, [load]);

      const save = useCallback(async () => {
        setBusy(true);
        setNote("保存中…");
        const patch = {
          confirm: true,
          allowExternalDelete: form.allowExternalDelete === true,
          defaultSpace: String(form.defaultSpace || "").trim(),
        };
        const admin = String(form.adminToken || "").trim();
        if (admin) patch.adminToken = admin; // empty => keep the current one
        try {
          const out = await postJson("/api/config", patch);
          if (out.status === 200) {
            setCfg(out.body || cfg);
            setNote("已保存并立即生效");
            setForm((f) => ({ ...f, adminToken: "" }));
            setTimeout(() => setNote(""), 3000);
            load();
          } else {
            setNote("保存失败：" + (out.body && (out.body.message || out.body.error) ? (out.body.message || out.body.error) : "HTTP " + out.status));
          }
        } catch (e) {
          setNote("无法连接网关，保存未生效。");
        } finally {
          setBusy(false);
        }
      }, [form, cfg, load]);

      if (connErr) {
        return h("div", { style: S.wrap },
          h("div", { style: S.err }, connErr),
          h("div", null, h("button", { type: "button", style: S.btn, onClick: load }, "重试")),
        );
      }

      const spaceNames = spaces.map((s) => (s && (s.name || s.id)) || "?").filter(Boolean);

      return h("div", { style: S.wrap },

        // ---- status ----
        h("div", { style: S.section },
          h(Row, { label: "网关状态", value: cfg ? ("v" + (cfg.version || "?") + " · 端口 " + cfg.port) : "读取中…" }),
          h(Row, { label: "共享 Token", value: cfg ? (cfg.tokenHint || "—") : "—" }),
          h(Row, { label: "记忆空间", value: spaceNames.length ? spaceNames.join("、") : "—" }),
        ),

        h("div", { style: S.divider }),

        // ---- delete switch ----
        h("div", { style: S.section },
          h("div", { style: S.row },
            h("div", null,
              h("div", null, "允许外部工具删除记忆"),
              h("div", { style: S.hint }, form.allowExternalDelete
                ? "开启：WorkBuddy / CodeBuddy / Claude Code / Codex 持共享 Token 即可删（adminToken 仍然有效）。"
                : "关闭：只有拥有者 adminToken 能删，外部工具一律 401。"),
            ),
            h("input", {
              type: "checkbox",
              checked: form.allowExternalDelete === true,
              style: { width: "38px", height: "20px", cursor: "pointer", accentColor: "currentColor" },
              onChange: (e) => setForm((f) => ({ ...f, allowExternalDelete: e.target.checked })),
            }),
          ),
        ),

        h("div", { style: S.divider }),

        // ---- settings ----
        h("div", { style: S.grid },
          h(Field, {
            label: "拥有者助记令牌（adminToken）",
            type: "password",
            value: form.adminToken,
            placeholder: cfg && cfg.adminTokenSet ? "已设置 " + (cfg.adminTokenHint || "") + "（留空保持不变）" : "未设置（留空保持不变）",
            hint: "关闭外部删除时，删除接口只认这个令牌。",
            onChange: (v) => setForm((f) => ({ ...f, adminToken: v })),
          }),
          h(Field, {
            label: "默认记忆空间",
            value: form.defaultSpace,
            placeholder: "default",
            hint: "调用方未指定空间时的落点。",
            onChange: (v) => setForm((f) => ({ ...f, defaultSpace: v })),
          }),
        ),

        // ---- actions ----
        h("div", { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" } },
          h("button", { type: "button", style: S.btn, disabled: busy, onClick: save }, busy ? "保存中…" : "保存设置"),
          note ? h("span", { style: S.status }, note) : null,
          cfg && cfg.settingsPath ? h("span", { style: S.hint }, "落盘：" + cfg.settingsPath) : null,
        ),
      );
    }

    // Settings-page wrapper: the section owns its own heading, so the card is
    // rendered without the bundle-page framing.
    function MemoryGatewaySection() {
      return h("div", { style: { padding: "4px 2px 12px" } },
        h("div", { style: { fontSize: "15px", fontWeight: 600, marginBottom: "10px" } }, "记忆网关 Memory Gateway"),
        h(MemoryGatewayCard),
      );
    }

    function apply(ctx) {
      // A KEYED slot registration must go through slots.inject(): register()
      // alone throws when the host page has not DECLARED the slot yet, and the
      // throw used to be swallowed by a try/catch, so the card never appeared.
      // inject() queues the registration until the declaration lands.

      // 1) Plugins page: inside this bundle's own card.
      try {
        ctx.slots.inject("plugins.bundle.config", () =>
          ctx.slots.register({
            name: "plugins.bundle.config",
            key: "dsh-memory-gateway",
            priority: 30,
          }, MemoryGatewayCard),
        );
      } catch (e) {
        console.error("[dsh-memory-gateway] plugins.bundle.config inject failed:", e);
      }

      // 2) Settings page: a first-class section in the settings nav. This is the
      //    location users actually look for, and it does not depend on the
      //    bundle being recognised by the plugin-market card list.
      try {
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register({
            name: "settings.section",
            id: "memory-gateway",
            order: 55,
            label: () => "记忆网关",
          }, MemoryGatewaySection),
        );
      } catch (e) {
        console.error("[dsh-memory-gateway] settings.section inject failed:", e);
      }
    }

    const inject = ["slots"];

    exports.name = "dsh-memory-gateway";
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
