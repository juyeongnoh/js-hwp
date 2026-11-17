import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import CFB from 'cfb'
import { inflate, parseRecords, DocInfoTag, parseFileHeader } from '../packages/hwp/src/index.js'
const files = execSync(`find . ../rhwp ../hwp-test /Users/juyeongnoh/Downloads/kogl_type1 -name '*.hwp' -not -path '*/node_modules/*' 2>/dev/null`).toString().trim().split('\n')
for (const f of files) {
  try {
    const cfb = CFB.read(readFileSync(f), { type: 'buffer' })
    const get = (p: string) => new Uint8Array(CFB.find(cfb, '/' + p)!.content as any)
    const h = parseFileHeader(get('FileHeader')); const v = h.version
    if (v.major !== 5 || v.minor !== 0) continue
    const d = get('DocInfo'); const recs = parseRecords(h.flags.compressed ? inflate(d) : d)
    const lens = [...new Set(recs.filter((r) => r.tagId === DocInfoTag.ParaShape).map((r) => r.payload.length))]
    console.log([v.major, v.minor, v.build, v.revision].join('.'), lens.join(','), f)
  } catch {}
}
