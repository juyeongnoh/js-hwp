/** MS-CFB §2.2가 정의하는 특수 섹터 번호. */
export const MAXREGSECT = 0xfffffffa
/** DIFAT의 일부인 섹터. */
export const DIFSECT = 0xfffffffc
/** FAT의 일부인 섹터. */
export const FATSECT = 0xfffffffd
/** 섹터 체인을 종료한다. */
export const ENDOFCHAIN = 0xfffffffe
/** 할당되지 않은 섹터. */
export const FREESECT = 0xffffffff

/** 디렉터리 항목에 쓰이는 특수 스트림 id. */
export const MAXREGSID = 0xfffffffa
export const NOSTREAM = 0xffffffff

/** `D0 CF 11 E0 A1 B1 1A E1` — 복합 파일 시그니처. */
export const SIGNATURE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

export const HEADER_SIZE = 512
export const DIRECTORY_ENTRY_SIZE = 128
/** 헤더에 인라인으로 저장되는 DIFAT 항목 개수. */
export const HEADER_DIFAT_ENTRIES = 109

export enum ObjectType {
  Unknown = 0,
  Storage = 1,
  Stream = 2,
  RootStorage = 5,
}

export enum ColorFlag {
  Red = 0,
  Black = 1,
}
