import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DocumentBuilder, type Control } from '@js-hwp/core'
import CFB from 'cfb'
import { describe, expect, it } from 'vitest'
import { maybeInflate } from '../src/compress.js'
import { parseHwp, serializeHwp } from '../src/document.js'
import { buildRecordTree, flattenRecordTree, parseRecords, type RecordNode } from '../src/record.js'
import { SectionTag } from '../src/tags.js'

const root = join(__dirname, '../../..')
const files = ['docs/experiments', 'fixtures', 'scratch'].flatMap((d) =>
  readdirSync(join(root, d), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.hwp'))
    .map((f) => join(root, d, f)),
)

/** 코덱이 모델로 해석하지 않고 하위 레코드를 보존하는 컨트롤. */
const PRESERVED = new Set(['gso ', 'eqed'])

const ctrlId = (p: Uint8Array): string => String.fromCharCode(p[3]!, p[2]!, p[1]!, p[0]!)

/**
 * `gso `, `eqed` CTRL_HEADER의 하위 트리 전체(자기 자신 포함)를 레코드마다 `태그:상대 레벨:페이로드`로.
 * 바깥 레벨은 문단 중첩에 따라 다르므로 CTRL_HEADER 기준 상대 레벨로 적는다.
 */
function preservedSubtrees(bytes: Uint8Array): string[][] {
  const c = CFB.read(bytes, { type: 'buffer' })
  const header = CFB.find(c, 'FileHeader')!.content as Uint8Array
  const compressed = (header[36]! & 1) === 1
  const out: string[][] = []
  const walk = (n: RecordNode): void => {
    if (n.tagId === SectionTag.CtrlHeader && PRESERVED.has(ctrlId(n.payload))) {
      out.push(
        flattenRecordTree([n]).map(
          (r) => `${r.tagId}:${r.level - n.level}:${Buffer.from(r.payload).toString('hex')}`,
        ),
      )
      return
    }
    n.children.forEach(walk)
  }
  for (const p of c.FullPaths.filter((p) => /BodyText\/Section\d+$/.test(p))) {
    const data = new Uint8Array(CFB.find(c, p.replace(/^[^/]*/, ''))!.content as Uint8Array)
    buildRecordTree(parseRecords(maybeInflate(data, compressed))).forEach(walk)
  }
  return out
}

/**
 * 한글 대화상자가 만들지 않는 값을 넣은 실험 파일(`experiments/object-props-out-of-dialog`)에서 코덱이
 * 개체 공통 속성을 바꿔 쓰는 것. 그리기 개체 CTRL_HEADER도 표처럼 모델(`placement`)로 쓰기 때문이다.
 * - bit 29(캡션 있음)는 캡션을 쓸 때만 켠다. 캡션 없이 켜진 파일은 한글이 거부한다.
 * - 세로 기준 3은 모델에서 문단이라 2로 쓴다. 한글도 문단 기준과 같은 자리에 그렸다.
 */
const PLACEMENT_REWRITES: [RegExp, (props: number) => number][] = [
  [/float-bit29-on\.hwp$/, (p) => (p & ~(1 << 29)) >>> 0],
  [/float-vrel-3\.hwp$/, (p) => ((p & ~(0b11 << 3)) | (2 << 3)) >>> 0],
]

/** CTRL_HEADER 페이로드(16진수)의 개체 공통 속성(오프셋 4)을 `rewrite`로 바꾼다. */
function rewritePlacement(file: string, hex: string): string {
  const rewrite = PLACEMENT_REWRITES.find(([re]) => re.test(file))?.[1]
  if (!rewrite) return hex
  const b = Buffer.from(hex, 'hex')
  b.writeUInt32LE(rewrite(b.readUInt32LE(4)), 4)
  return b.toString('hex')
}

describe('저장소 HWP 파일의 그리기 개체·수식 하위 레코드 왕복', () => {
  // 원본 비트 보존: 그리기 개체(글상자 문단, 캡션 포함)와 수식의 레코드 트리가 원본과 바이트 단위로 같아야 한다.
  it.each(files.map((f) => [f.slice(root.length + 1), f]))('%s', (_, file) => {
    const bytes = new Uint8Array(readFileSync(file))
    const expected = preservedSubtrees(bytes).map((t, i) => {
      if (i !== 0) return t
      const [tag, depth, hex] = t[0]!.split(':')
      return [`${tag}:${depth}:${rewritePlacement(file, hex!)}`, ...t.slice(1)]
    })
    expect(preservedSubtrees(serializeHwp(parseHwp(bytes)))).toEqual(expected)
  })

  it('저장소 파일에 그리기 개체와 글상자 문단이 있다', () => {
    const all = files.flatMap((f) => preservedSubtrees(new Uint8Array(readFileSync(f))))
    const gso = all.filter((t) => t[0]!.includes(':0:' + Buffer.from('gso '.split('').reverse().join('')).toString('hex')))
    expect(gso.length).toBeGreaterThan(0)
    // 글상자: gso 아래 LIST_HEADER와 문단이 있다.
    expect(gso.some((t) => t.some((r) => r.startsWith(`${SectionTag.ParaHeader}:`)))).toBe(true)
  })
})

describe('읽은 그리기 개체의 캡션을 고치면', () => {
  it('고친 캡션을 쓰고 나머지 하위 레코드는 보존한다', () => {
    const path = join(root, 'docs/experiments/object-common-props/rect-caption-bottom.hwp')
    const bytes = new Uint8Array(readFileSync(path))
    const doc = parseHwp(bytes)
    const rect = doc.sections[0]!.paragraphs
      .flatMap((p) => p.runs.flatMap((r) => r.items))
      .find((i): i is Extract<Control, { type: 'unknown' }> => i.type === 'unknown' && i.ctrlId === 'gso ')!
    expect(rect.placement?.caption).toBeDefined()
    const original = preservedSubtrees(bytes)[0]!

    rect.placement!.caption = undefined
    const written = preservedSubtrees(serializeHwp(doc))[0]!
    // 캡션 bit 29가 꺼지고 캡션 LIST_HEADER와 문단이 빠진다.
    const props = (t: string[]) => Buffer.from(t[0]!.split(':')[2]!, 'hex').readUInt32LE(4)
    expect(props(written) & (1 << 29)).toBe(0)
    expect(props(written) | (1 << 29)).toBe(props(original))
    const shapeAt = (t: string[]) => t.findIndex((r) => r.startsWith(`${SectionTag.ShapeComponent}:1:`))
    expect(written.slice(shapeAt(written))).toEqual(original.slice(shapeAt(original)))
    expect(written.slice(1, shapeAt(written))).toEqual([])
  })
})

describe('새로 만든 문서', () => {
  it('unknown 컨트롤이 없으면 영향이 없다', () => {
    const doc = new DocumentBuilder().paragraph('가').build()
    expect(preservedSubtrees(serializeHwp(doc))).toEqual([])
  })
})
