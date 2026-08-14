import type { ObjectType } from './constants.js'

/** 복합 파일 디렉터리의 파싱된 항목. */
export interface CfbEntry {
  /** 경로 없는 항목 이름. 최대 UTF-16 코드 단위 31개. */
  name: string
  /** 루트부터의 전체 경로. 예: `BodyText/Section0`. 루트 자신은 `''`. */
  path: string
  type: ObjectType
  /** 스트림 내용. 저장소면 비어 있다. */
  content: Uint8Array
  /** 16바이트 클래스 id. HWP는 0으로 둔다. */
  clsid?: Uint8Array
  /**
   * 디렉터리 항목에 저장된 그대로의 윈도우 FILETIME 값. 1601-01-01 UTC 이후
   * 100나노초 틱이거나, 라이터가 생략했으면 0이다(한글이 그렇게 한다).
   * 읽기 전용 — {@link write}는 모든 항목에 0을 내보낸다.
   */
  createdAt?: bigint
  modifiedAt?: bigint
  stateBits?: number
}

/** 파싱된 복합 파일. */
export interface CfbContainer {
  entries: CfbEntry[]
  /** 직접 조회를 위한 전체 경로별 항목. */
  byPath: Map<string, CfbEntry>
  /** 512바이트 섹터면 3, 4096바이트 섹터면 4. */
  majorVersion: number
  minorVersion: number
  rootClsid?: Uint8Array
}

/** {@link write}가 받는 입력: 경로에서 스트림 내용으로 가는 평평한 맵. */
export interface CfbInput {
  /** 전체 경로를 키로 하는 스트림. 예: `BodyText/Section0`. */
  streams: Record<string, Uint8Array>
  /**
   * 스트림을 하나도 담지 않아도 존재해야 하는 저장소.
   * 스트림 경로가 함의하는 저장소는 자동으로 만들어진다.
   */
  storages?: string[]
  /** 루트 항목에 쓰는 클래스 id. */
  rootClsid?: Uint8Array
  /** 3(512바이트 섹터, 기본값) 또는 4(4096바이트 섹터). */
  majorVersion?: 3 | 4
}
