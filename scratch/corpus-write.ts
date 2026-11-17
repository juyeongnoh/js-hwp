import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { parseHwp, serializeHwp } from '../packages/hwp/src/document.js'
const files = execSync("find . ../rhwp ../hwp-test $HOME/Downloads/kogl_type1 -name '*.hwp' -not -path '*/node_modules/*' 2>/dev/null").toString().trim().split('\n')
const s: Record<string, number> = {}
for (const f of files) {
  let doc
  try { doc = parseHwp(new Uint8Array(readFileSync(f))) } catch { s['read fail'] = (s['read fail'] ?? 0) + 1; continue }
  try { serializeHwp(doc); s.ok = (s.ok ?? 0) + 1 } catch (e) { const m = (e as Error).message; s[m] = (s[m] ?? 0) + 1 }
}
console.log(s)
