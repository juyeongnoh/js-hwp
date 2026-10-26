/**
 * 문서 루트.
 *
 * `HwpDocument`는 이 프로젝트의 모든 코덱이 읽고 쓰는 단일 인메모리 표현이다.
 *
 *
 * ```text
 *   .hwp  (CFB + records)  ─┐                     ┌─ .hwp
 *   .hwpx (ZIP + OWPML XML) ─┼─▶  HwpDocument  ─┼─ .hwpx
 *   builder API             ─┘                     ├─ HTML
 *                                                  └─ PDF
 * ```
 *
 * 일부러 HWP 자신의 모델에 가깝게 만들었다. 공유 자원 표에 문단 스트림을 더한
 * 구조다. 거기서 더 멀어지면 어느 한 방향에서 정확도를 잃기 때문이다.
 *
 */

import type {
  BinDataItem,
  BorderFill,
  Bullet,
  CharShape,
  FontFace,
  Numbering,
  ParaShape,
  Style,
  TabDef,
} from "./docinfo.js";
import type { Section } from "./section.js";

export interface DocumentVersion {
  major: number;
  minor: number;
  build: number;
  revision: number;
}

/** 한글 2018 이후가 쓰는 버전이자 우리가 기본으로 목표하는 버전. */
export const DEFAULT_VERSION: DocumentVersion = {
  major: 5,
  minor: 1,
  build: 1,
  revision: 0,
};

export interface DocumentMeta {
  title?: string;
  subject?: string;
  author?: string;
  lastSavedBy?: string;
  keywords?: string[];
  description?: string;
  creator?: string;
  /** ISO-8601 타임스탬프. */
  createdAt?: string;
  modifiedAt?: string;
  language?: string;
}

export interface DocumentProperties {
  /** 문서 전체의 시작 번호. */
  startPage: number;
  startFootnote: number;
  startEndnote: number;
  startPicture: number;
  startTable: number;
  startEquation: number;
  /** 문서와 함께 저장되는 캐럿 위치. */
  caret?: { list: number; paragraph: number; position: number };
}

export const DEFAULT_DOCUMENT_PROPERTIES: DocumentProperties = {
  startPage: 1,
  startFootnote: 1,
  startEndnote: 1,
  startPicture: 1,
  startTable: 1,
  startEquation: 1,
};

export interface CompatibilityOptions {
  /** 0 = HWP 네이티브, 1 = MS 워드 호환, 2 = 구 HWP. */
  targetProgram?: number;
  /** 원시 레이아웃 호환성 플래그. 왕복을 위해 보존한다. */
  layoutFlags?: {
    char?: number;
    para?: number;
    section?: number;
    object?: number;
    field?: number;
  };
}

/**
 * 읽을 수는 있지만 아직 모델링하지 않는 데이터. 이걸 보관하면 읽고-고치고-쓰는
 * 주기가 이 라이브러리가 이해하지 못하는 정보를 보존한다. 실제 문서에서는 그게
 * 아주 중요하다.
 */
export interface PreservedData {
  /** 파싱하지 않은 DocInfo 레코드. 태그 id를 키로, 스트림 순서대로. */
  docInfoTail?: { tagId: number; level: number; payload: Uint8Array }[];
  /** 그대로 복사한 스트림 전체. 예: `Scripts/DefaultJScript`. */
  streams?: Record<string, Uint8Array>;
  /** HWPX 왕복을 위한 원본 `settings.xml` / `content.hpf`. */
  hwpxParts?: Record<string, string>;
}

export interface HwpDocument {
  version: DocumentVersion;
  meta: DocumentMeta;
  properties: DocumentProperties;

  fonts: FontFace[];
  charShapes: CharShape[];
  paraShapes: ParaShape[];
  borderFills: BorderFill[];
  styles: Style[];
  numberings: Numbering[];
  bullets: Bullet[];
  tabDefs: TabDef[];
  binData: BinDataItem[];

  sections: Section[];

  compatibility?: CompatibilityOptions;
  /** 파일에 저장된 평문 미리보기(`PrvText`). 저장할 때 다시 만든다. */
  preview?: string;
  preserved?: PreservedData;
}
