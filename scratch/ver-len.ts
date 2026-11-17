import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import CFB from 'cfb'
import { inflate, parseRecords, DocInfoTag, parseFileHeader } from '../packages/hwp/src/index.js'
const files = execSync(`find ${process.argv[2] ?? '. ../rhwp ../hwp-test'} -name '*.hwp' -not -path '*/node_modules/*' 2>/dev/null`).toString().trim().split('\n')
const m = new Map<string, { files: number; lens: Set<number>; ex: string }>()
for (const f of files) {
  try {
    const cfb = CFB.read(readFileSync(f), { type: 'buffer' })
    const get = (p: string) => new Uint8Array(CFB.find(cfb, '/' + p)!.content as any)
    const h = parseFileHeader(get('FileHeader'))
    if (h.flags.passwordProtected || h.flags.distribution) continue
    const d = get('DocInfo'); const recs = parseRecords(h.flags.compressed ? inflate(d) : d)
    const v = h.version; const key = [v.major, v.minor, v.build, v.revision].join('.')
    const e = m.get(key) ?? { files: 0, lens: new Set(), ex: f }
    e.files++
    for (const r of recs) if (r.tagId === DocInfoTag.ParaShape) e.lens.add(r.payload.length)
    m.set(key, e)
  } catch { const k = "not-cfb"; const e = m.get(k) ?? { files: 0, lens: new Set(), ex: f }; e.files++; m.set(k, e) }
}
for (const [k, e] of [...m].sort()) console.log(k, e.files, [...e.lens].join(','), e.ex)
