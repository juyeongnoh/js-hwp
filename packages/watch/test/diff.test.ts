import { describe, expect, it } from 'vitest'
import { byteLines, diffSnapshots, type Snapshot } from '../src/diff.js'

describe('diff', () => {
  it('바뀐 비트를 켜짐·꺼짐으로 표시한다', () => {
    expect(byteLines(Uint8Array.of(0, 0x21), Uint8Array.of(0, 0x30))).toEqual([
      '    +0x0001 [1]   21→30  00100001→00110000  bit 0↓ 4↑',
    ])
  })

  it('앞뒤 공통 레코드를 건너뛰고 가운데만 보여준다', () => {
    const rec = (tagId: number, ...bytes: number[]) => ({ tagId, level: 0, payload: Uint8Array.from(bytes) })
    const a: Snapshot = new Map([['DocInfo', { kind: 'records', records: [rec(16, 1), rec(25, 0), rec(16, 2)] }]])
    const b: Snapshot = new Map([['DocInfo', { kind: 'records', records: [rec(16, 1), rec(25, 4), rec(16, 2)] }]])
    expect(diffSnapshots(a, b)).toEqual([
      'DocInfo',
      '  #1 ParaShape (lv0, 1B)',
      '    +0x0000 [0]   00→04  00000000→00000100  bit 2↑',
    ])
    expect(diffSnapshots(a, a)).toEqual([])
  })

  it('바뀐 레코드 사이에 낀 같은 레코드는 보여주지 않는다', () => {
    const rec = (tagId: number, ...bytes: number[]) => ({ tagId, level: 0, payload: Uint8Array.from(bytes) })
    const a: Snapshot = new Map([['DocInfo', { kind: 'records', records: [rec(17, 7), rec(21, 0), rec(25, 0)] }]])
    const b: Snapshot = new Map([['DocInfo', { kind: 'records', records: [rec(17, 8), rec(21, 0), rec(21, 1), rec(25, 0)] }]])
    expect(diffSnapshots(a, b)).toEqual([
      'DocInfo',
      '  레코드 3 → 4',
      '  #0 IdMappings (lv0, 1B)',
      '    +0x0000 [0]   07→08  00000111→00001000  bit 0↓ 1↓ 2↓ 3↑',
      '  + #2 CharShape (lv0, 1B)',
    ])
  })
})
