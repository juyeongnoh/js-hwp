/**
 * `@js-hwp/cfb` — 복합 파일 바이너리(OLE2) 리더와 라이터.
 *
 * HWP 5.x 문서는 OLE2 복합 파일이다. `FileHeader`, `DocInfo`,
 * `BodyText/Section0`, `BinData/*` 따위를 담은 작은 파일 속 파일 시스템이다.
 * 이 패키지는 그 컨테이너를 읽고 쓸 만큼만 MS-CFB를 구현하고, Node API에
 * 의존하지 않아서 브라우저에서도 돈다.
 *
 * 포맷은 `docs/spec/07-compound-file-binary.md`에 문서화돼 있고, 이 패키지가
 * 의도적으로 구현하지 않는 것도 거기 기록돼 있다.
 *
 * @preserve
 * 본 제품은 한글과컴퓨터의 한글 문서 파일(.hwp) 공개 문서를 참고하여
 * 개발하였습니다.
 */

export { read, readStream, listStorage, lookup, CfbError } from './reader.js'
export { write } from './writer.js'
export { compareEntryNames, foldName } from './names.js'
export { ObjectType, ColorFlag, ENDOFCHAIN, FREESECT, NOSTREAM } from './constants.js'
export type { CfbContainer, CfbEntry, CfbInput } from './types.js'
