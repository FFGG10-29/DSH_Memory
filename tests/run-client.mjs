/* 在 Node 里用假 ModuleLoader + 假 ctx 实际执行 client.js，
 * 目的是把「卡片/设置页不出现」从「代码是否跑得通」里分离出来：
 * 如果这里能正常注册两处 slot，问题就在宿主侧（加载/依赖/页面位置）；
 * 如果这里抛错，问题就在客户端代码本身。 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useCallback: (f) => f,
}

const loaded = []
const fakeWindow = {
  __ModuleLoader__: {
    load(mod) {
      loaded.push(mod)
    },
  },
}

const ctx = {
  slots: {
    calls: [],
    inject(name, fn) {
      this.calls.push(['inject', name])
      fn()
    },
    register(options, Component) {
      this.calls.push(['register', options.name, options.key ?? options.id, typeof Component])
    },
  },
}

const sandbox = {
  window: fakeWindow,
  document: { createElement: () => ({}), head: { appendChild() {} }, querySelector: () => null },
  console,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(src, sandbox, { filename: 'client.js' })

if (loaded.length !== 1) {
  console.error('FAIL: __ModuleLoader__.load 调用次数 =', loaded.length)
  process.exit(1)
}

const mod = loaded[0]
console.log('module id      :', mod.id)
const exp = mod.factory((name) => {
  if (name === 'react') return reactStub
  throw new Error('unexpected require: ' + name)
})
console.log('exports keys   :', Object.keys(exp))
console.log('exports.inject :', JSON.stringify(exp.inject))
console.log('apply is fn    :', typeof exp.apply === 'function')

exp.apply(ctx)
console.log('--- slot 调用 ---')
for (const c of ctx.slots.calls) console.log('  ', c.join(' | '))

const names = ctx.slots.calls.filter((c) => c[0] === 'register').map((c) => c[1])
const want = ['plugins.bundle.config', 'settings.section']
const missing = want.filter((w) => !names.includes(w))
if (missing.length) {
  console.error('FAIL 缺少注册:', missing.join(', '))
  process.exit(1)
}
console.log('PASS: 两处 slot 均已注册，且 client 模块可执行')
