// 把 lib/ 下的构建产物同步到 DSH profile 的插件目录。
// 开发机上的 profile 条目通常是「指回本工作区」的软链，此时无需复制（编译即生效）；
// 只有 profile 是真实副本时才需要拷贝，避免出现「改了源码但线上跑旧文件」的错觉。
import { copyFileSync, existsSync, lstatSync, readlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

const here = resolve('lib')
const prof = process.env.DSH_PROFILE_DIR
  ? join(process.env.DSH_PROFILE_DIR, 'node_modules', 'dsh-memory-gateway', 'lib')
  : 'C:\\Users\\13966\\.dsh\\profiles\\desktop\\node_modules\\dsh-memory-gateway\\lib'

if (!existsSync(prof)) {
  console.log(`skip: profile lib dir not found (${prof})`)
  process.exit(0)
}

// 软链检测：链接目标解析后与本工作区相同 ⇒ 已经是同一份文件
const profRoot = resolve(prof, '..')
try {
  if (lstatSync(profRoot).isSymbolicLink()) {
    const target = resolve(profRoot, '..', readlinkSync(profRoot))
    if (target.toLowerCase() === resolve('.').toLowerCase()) {
      console.log('skip: profile entry symlinks back to this workspace')
      process.exit(0)
    }
  }
} catch { /* 非软链，继续复制 */ }

const files = ['index.js', 'mcp-server.js', 'client.js', 'admin.html']
for (const f of files) {
  copyFileSync(join(here, f), join(prof, f))
  console.log(`synced ${f}`)
}
