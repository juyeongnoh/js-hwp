import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import CFB from 'cfb'
import { inflate, parseRecords, DocInfoTag, parseFileHeader } from '../packages/hwp/src/index.js'
const files = execSync(`find . ../rhwp ../hwp-test /Users/juyeongnoh/Downloads/kogl_type1 -name '*.hwp' -not -path '*/node_modules/*' 2>/dev/null`).toString().trim().split('\n')
let n = 0; const hit: Record<string, number> = {}
for (const f of files) {
  try {
    const cfb = CFB.read(readFileSync(f), { type: 'buffer' })
    const get = (p: string) => new Uint8Array(CFB.find(cfb, '/' + p)!.content as any)
    const h = parseFileHeader(get('FileHeader'))
    if (h.flags.passwordProtected || h.flags.distribution) continue
    const d = get('DocInfo')
    for (const r of parseRecords(h.flags.compressed ? inflate(d) : d)) {
      if (r.tagId !== DocInfoTag.ParaShape) continue
      n++
      const p1 = new DataView(r.payload.buffer, r.payload.byteOffset).getUint32(0, true)
      if (p1 & (1 << 30)) hit[f] = (hit[f] ?? 0) + 1
    }
  } catch {}
}
console.log(n, 'records'); console.log(hit)
