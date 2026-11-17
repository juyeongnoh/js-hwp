import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import CFB from 'cfb'
import { createDocument } from '../packages/core/src/index.js'
import { inflate, parseRecords, DocInfoTag, parseFileHeader, parseDocInfo, serializeDocInfo } from '../packages/hwp/src/index.js'
const files = execSync("find . ../rhwp ../hwp-test -name '*.hwp' -not -path '*/node_modules/*' 2>/dev/null").toString().trim().split('\n')
let n = 0, diff = 0, err = 0
for (const f of files) {
  try {
    const cfb = CFB.read(readFileSync(f), { type: 'buffer' })
    const get = (p: string) => new Uint8Array(CFB.find(cfb, '/' + p)!.content as any)
    const h = parseFileHeader(get('FileHeader'))
    if (h.flags.passwordProtected || h.flags.distribution) continue
    const d = get('DocInfo'); const raw = h.flags.compressed ? inflate(d) : d
    const doc = createDocument({ fonts: [], charShapes: [], paraShapes: [], borderFills: [], styles: [], numberings: [], bullets: [], tabDefs: [], binData: [], sections: [] } as any)
    parseDocInfo(doc, raw)
    const a = parseRecords(raw).filter((r) => r.tagId === DocInfoTag.ParaShape)
    const b = parseRecords(serializeDocInfo(doc)).filter((r) => r.tagId === DocInfoTag.ParaShape)
    a.forEach((r, i) => { n++; if (Buffer.compare(Buffer.from(r.payload), Buffer.from(b[i]?.payload ?? [])) !== 0) { diff++; if (diff <= 3) console.log(f, i, r.payload.length, b[i]?.payload.length, [...r.payload].map((x, k) => x !== b[i]?.payload[k] ? k + ":" + x + "→" + b[i]?.payload[k] : "").filter(Boolean).join(" ")) } })
  } catch { err++ }
}
console.log({ n, diff, err })
