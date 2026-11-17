import { createDocument, type ParaShape } from '@js-hwp/core'
import { parseDocInfo, serializeDocInfo } from '../packages/hwp/src/docinfo.js'
import { parseRecords } from '../packages/hwp/src/record.js'
import { DocInfoTag } from '../packages/hwp/src/tags.js'
const base: ParaShape = { align: 0, marginLeft: 0, marginRight: 0, indent: 0, marginTop: 0, marginBottom: 0, lineSpacing: { kind: 0, value: 160 } }
const cases: [string, Partial<ParaShape>][] = [
  ['align 9 (3비트)', { align: 9 as any }],
  ['lineSpacing.kind 5', { lineSpacing: { kind: 5 as any, value: 160 } }],
  ['lineBreakLatin 4 (2비트)', { lineBreakLatin: 4 as any }],
  ['verticalAlign 6 (2비트)', { verticalAlign: 6 as any }],
  ['marginLeft 2^31', { marginLeft: 2 ** 31 as any }],
  ['marginLeft 1.7', { marginLeft: 1.7 as any }],
  ['lineSpacing.value -1', { lineSpacing: { kind: 1, value: -1 } }],
  ['tabDefId 70000', { tabDefId: 70000 }],
  ['border.offsetLeft 40000', { border: { offsetLeft: 40000, offsetRight: 0, offsetTop: 0, offsetBottom: 0 } as any }],
]
for (const [name, patch] of cases) {
  try {
    const doc = createDocument({ paraShapes: [{ ...base, ...patch }] })
    const out = parseDocInfo(createDocument(), serializeDocInfo(doc))
    const p = parseRecords(serializeDocInfo(doc)).filter(r => r.tagId === DocInfoTag.ParaShape).at(-1)!.payload
    const doc2 = createDocument(); parseDocInfo(doc2, serializeDocInfo(doc)); const s = doc2.paraShapes.at(-1)!
    const back = { align: s.align, kind: s.lineSpacing.kind, value: s.lineSpacing.value, lineBreakLatin: s.lineBreakLatin, verticalAlign: s.verticalAlign, marginLeft: s.marginLeft, tabDefId: s.tabDefId, offsetLeft: s.border?.offsetLeft, unknown3: s.unknownBits3 }
    console.log(name.padEnd(26), '→ 다시 읽으면', JSON.stringify(back))
  } catch (e) { console.log(name.padEnd(26), '→ 오류', (e as Error).message) }
}
