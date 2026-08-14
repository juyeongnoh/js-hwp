/**
 * 자원 인터닝.
 *
 * HWP 서식은 텍스트가 인덱스로 참조하는 문서 전역 표에 산다. 애플리케이션
 * 코드는 "진하게, 12pt, 빨강"이라고 말하고 싶지 인덱스를 생각하고 싶지 않다.
 * 그래서 모든 변형이 여기를 지난다. 동일한 기존 항목을 찾거나 새 항목을
 * 덧붙인다.
 *
 * 중복 제거는 정규 JSON 키를 쓰는 구조적 방식이다. 그래서 파일이 작게 유지된다.
 * 모든 문단이 진하게인 문서는 run마다 글자 모양이 하나씩 생기는 게 아니라
 * 정확히 하나만 더 생긴다.
 */

import { defaultCharShape, defaultParaShape } from './defaults.js'
import type {
  BorderFill,
  CharShape,
  FontFace,
  Numbering,
  ParaShape,
  Style,
  TabDef,
} from './model/docinfo.js'
import type { HwpDocument } from './model/document.js'

/**
 * 안정적인 문자열화. 객체 키를 정렬해서 구조적으로 같은 모양 둘이 만들어진
 * 순서와 무관하게 항상 같은 키를 내게 한다.
 */
export function canonicalKey(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const record = val as Record<string, unknown>
      const sorted: Record<string, unknown> = {}
      for (const key of Object.keys(record).sort()) {
        // `undefined`와 키가 없는 것을 같은 것으로 취급한다.
        if (record[key] !== undefined) sorted[key] = record[key]
      }
      return sorted
    }
    return val
  })
}

/** `table`에서 `entry`를 찾고 없으면 덧붙인다. 그 인덱스를 반환한다. */
export function intern<T>(table: T[], entry: T): number {
  const key = canonicalKey(entry)
  for (let i = 0; i < table.length; i++) {
    if (canonicalKey(table[i]) === key) return i
  }
  table.push(entry)
  return table.length - 1
}

/**
 * 문서 자원 표에 대한 색인. 색인을 한 번 만들어 재사용하면 인터닝이 조회당
 * O(n)에서 O(1)이 된다. run이 수천 개인 문서에서 중요하다.
 *
 */
export class Resources {
  readonly #doc: HwpDocument
  readonly #indices = new Map<string, Map<string, number>>()

  constructor(doc: HwpDocument) {
    this.#doc = doc
  }

  get document(): HwpDocument {
    return this.#doc
  }

  #index<T>(name: string, table: T[]): Map<string, number> {
    let index = this.#indices.get(name)
    if (!index) {
      index = new Map()
      for (let i = 0; i < table.length; i++) index.set(canonicalKey(table[i]), i)
      this.#indices.set(name, index)
    }
    return index
  }

  #intern<T>(name: string, table: T[], entry: T): number {
    const index = this.#index(name, table)
    const key = canonicalKey(entry)
    const existing = index.get(key)
    if (existing !== undefined) return existing
    const id = table.length
    table.push(entry)
    index.set(key, id)
    return id
  }

  /** 이름으로 글꼴을 찾고, 새것이면 표에 추가한다. */
  font(name: string): number {
    const existing = this.#doc.fonts.findIndex((f) => f.name === name)
    if (existing !== -1) return existing
    const face: FontFace = { name }
    this.#doc.fonts.push(face)
    this.#index('fonts', this.#doc.fonts).set(canonicalKey(face), this.#doc.fonts.length - 1)
    return this.#doc.fonts.length - 1
  }

  charShape(shape: CharShape): number {
    return this.#intern('charShapes', this.#doc.charShapes, shape)
  }

  paraShape(shape: ParaShape): number {
    return this.#intern('paraShapes', this.#doc.paraShapes, shape)
  }

  borderFill(fill: BorderFill): number {
    return this.#intern('borderFills', this.#doc.borderFills, fill)
  }

  tabDef(def: TabDef): number {
    return this.#intern('tabDefs', this.#doc.tabDefs, def)
  }

  numbering(numbering: Numbering): number {
    return this.#intern('numberings', this.#doc.numberings, numbering)
  }

  /** 한국어나 영어 이름으로 스타일을 찾는다. */
  styleByName(name: string): number | undefined {
    const id = this.#doc.styles.findIndex((s) => s.name === name || s.englishName === name)
    return id === -1 ? undefined : id
  }

  style(style: Style): number {
    const existing = this.styleByName(style.name)
    if (existing !== undefined) return existing
    this.#doc.styles.push(style)
    return this.#doc.styles.length - 1
  }

  /** `id`의 글자 모양, 또는 문서 기본값. */
  getCharShape(id: number): CharShape {
    return this.#doc.charShapes[id] ?? this.#doc.charShapes[0] ?? defaultCharShape()
  }

  getParaShape(id: number): ParaShape {
    return this.#doc.paraShapes[id] ?? this.#doc.paraShapes[0] ?? defaultParaShape()
  }

  /** 기존 글자 모양에서 새것을 유도하고 인터닝한다. */
  deriveCharShape(baseId: number, changes: Partial<CharShape>): number {
    return this.charShape({ ...this.getCharShape(baseId), ...changes })
  }

  deriveParaShape(baseId: number, changes: Partial<ParaShape>): number {
    return this.paraShape({ ...this.getParaShape(baseId), ...changes })
  }

  /** 표를 직접 변형한 뒤 캐시된 색인을 버린다. */
  invalidate(): void {
    this.#indices.clear()
  }
}
