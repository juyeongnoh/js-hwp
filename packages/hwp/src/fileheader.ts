/**
 * `FileHeader` 스트림: 256바이트, 절대 압축되지 않고 절대 암호화되지 않는다.
 *
 * 무엇보다 먼저 읽을 수 있어야 한다. 파일의 나머지가 압축됐는지 암호화됐는지를
 * 선언하는 게 이것이기 때문이다.
 */

import type { DocumentVersion } from "@js-hwp/core";
import {
  ByteReader,
  ByteWriter,
  HwpFormatError,
  bit,
  setBit,
} from "./bytes.js";

export const FILE_HEADER_SIZE = 256;

/** HWP 파일 시그니처 */
export const SIGNATURE = "HWP Document File";

/** 속성 1 — 오프셋 36의 기능·보호 비트필드. */
export interface HwpFlags {
  /** bit 0: 압축 여부(bit 레코드 스트림이 raw DEFLATE로 압축돼 있다.) */
  compressed: boolean;
  /** bit 1: 암호 설정 여부 */
  passwordProtected: boolean;
  /** bit 2: 배포용 문서 여부(본문이 `ViewText/`에 있고 암호화돼 있다.) */
  distribution: boolean;
  /** bit 3: 스크립트 저장 여부 */
  hasScripts: boolean;
  /** bit 4: DRM 보안 문서 여부 */
  drm: boolean;
  /** bit 5: XMLTemplate 스토리지 존재 여부 */
  hasXmlTemplate: boolean;
  /** bit 6: 문서 이력 관리 존재 여부 */
  hasDocumentHistory: boolean;
  /** bit 7: 전자 서명 정보 존재 여부 */
  hasSignature: boolean;
  /** bit 8: 공인 인증서 암호화 여부 */
  certificateEncrypted: boolean;
  /** bit 9: 전자 서명 예비 저장 여부 */
  signatureReserved: boolean;
  /** bit 10: 공인 인증서 DRM 보안 분서 여부 */
  certificateDrm: boolean;
  /** bit 11: CCL 문서 여부 */
  ccl: boolean;
  /** bit 12: 모바일 최적화 여부 */
  mobileOptimized: boolean;
  /** bit 13: 개인 정보 보안 문서 여부 */
  privacyProtected: boolean;
  /** bit 14: 변경 추적 문서 여부 */
  trackChanges: boolean;
  /** bit 15: 공공누리(KOGL) 저작권 문서 */
  kogl: boolean;
  /** bit 16: 비디오 컨트롤 포함 여부 */
  hasVideoControl: boolean;
  /** bit 17: 차례 필드 컨트롤 포함 여부 */
  hasTableOfContentsField: boolean;
}

/** 속성 2 — 오프셋 40의 라이선스 비트필드. */
export interface LicenseFlags {
  /** bit 0: CCL, 공공누리 라이선스 정보 */
  hasLicenseInfo: boolean;
  /** bit 1: 복제 제한 여부 */
  copyRestricted: boolean;
  /** 동일 조건 하에 복제 허용. 제한이 걸려 있으면 무시된다. */
  shareAlike: boolean;
}

export interface FileHeader {
  version: DocumentVersion;
  flags: HwpFlags;
  license: LicenseFlags;
  /** 0: None, 1: 한글 2.5 버전 이하, 2: 한글 3.0 버전 Enhanced, 3: 한글 3.0 버전 Old, 4: 한글 7.0 버전 이후 */
  encryptVersion: number;
  /** KOGL 라이선스 문서의 국가 코드: 6 = 한국, 15 = 그 외. */
  koglCountry: number;
}

/**
 * @todo 추후 한글에서 새 문서 만들어보고 실제 산출물과 일치시킬 것
 */
export const DEFAULT_FLAGS: HwpFlags = {
  compressed: true,
  passwordProtected: false,
  distribution: false,
  hasScripts: false,
  drm: false,
  hasXmlTemplate: false,
  hasDocumentHistory: false,
  hasSignature: false,
  certificateEncrypted: false,
  signatureReserved: false,
  certificateDrm: false,
  ccl: false,
  mobileOptimized: false,
  privacyProtected: false,
  trackChanges: false,
  kogl: false,
  hasVideoControl: false,
  hasTableOfContentsField: false,
};

export function parseFileHeader(data: Uint8Array): FileHeader {
  if (data.length < FILE_HEADER_SIZE) {
    throw new HwpFormatError(
      `FileHeader must be ${FILE_HEADER_SIZE} bytes, got ${data.length}`,
    );
  }

  // 시그니처 17글자만 의미가 있다. 패딩은 실제로 제각각이라 0을 요구하지 않는다.
  const signature = new TextDecoder("ascii").decode(
    data.subarray(0, SIGNATURE.length),
  );
  if (signature !== SIGNATURE) {
    throw new HwpFormatError(
      `Not an HWP 5 document: FileHeader signature is ${JSON.stringify(signature)}`,
    );
  }

  const reader = new ByteReader(data);
  reader.offset = 32;

  // 0xMMnnPPrr로 묶여 리틀 엔디언으로 저장된다. 최상위 바이트가 메이저다.
  const packed = reader.uint32();
  const version: DocumentVersion = {
    major: (packed >>> 24) & 0xff,
    minor: (packed >>> 16) & 0xff,
    build: (packed >>> 8) & 0xff,
    revision: packed & 0xff,
  };

  const properties = reader.uint32();
  const license = reader.uint32();
  const encryptVersion = reader.optionalUint32();
  const koglCountry = reader.optionalUint8();

  return {
    version,
    flags: {
      compressed: bit(properties, 0),
      passwordProtected: bit(properties, 1),
      distribution: bit(properties, 2),
      hasScripts: bit(properties, 3),
      drm: bit(properties, 4),
      hasXmlTemplate: bit(properties, 5),
      hasDocumentHistory: bit(properties, 6),
      hasSignature: bit(properties, 7),
      certificateEncrypted: bit(properties, 8),
      signatureReserved: bit(properties, 9),
      certificateDrm: bit(properties, 10),
      ccl: bit(properties, 11),
      mobileOptimized: bit(properties, 12),
      privacyProtected: bit(properties, 13),
      trackChanges: bit(properties, 14),
      kogl: bit(properties, 15),
      hasVideoControl: bit(properties, 16),
      hasTableOfContentsField: bit(properties, 17),
    },
    license: {
      hasLicenseInfo: bit(license, 0),
      copyRestricted: bit(license, 1),
      shareAlike: bit(license, 2),
    },
    encryptVersion,
    koglCountry,
  };
}

export function serializeFileHeader(header: FileHeader): Uint8Array {
  const writer = new ByteWriter();

  const signature = new TextEncoder().encode(SIGNATURE);
  writer.bytes(signature);
  writer.zeros(32 - signature.length);

  const { major, minor, build, revision } = header.version;
  writer.uint32(
    (((major & 0xff) << 24) |
      ((minor & 0xff) << 16) |
      ((build & 0xff) << 8) |
      (revision & 0xff)) >>>
      0,
  );

  const f = header.flags;
  let properties = 0;
  properties = setBit(properties, 0, f.compressed);
  properties = setBit(properties, 1, f.passwordProtected);
  properties = setBit(properties, 2, f.distribution);
  properties = setBit(properties, 3, f.hasScripts);
  properties = setBit(properties, 4, f.drm);
  properties = setBit(properties, 5, f.hasXmlTemplate);
  properties = setBit(properties, 6, f.hasDocumentHistory);
  properties = setBit(properties, 7, f.hasSignature);
  properties = setBit(properties, 8, f.certificateEncrypted);
  properties = setBit(properties, 9, f.signatureReserved);
  properties = setBit(properties, 10, f.certificateDrm);
  properties = setBit(properties, 11, f.ccl);
  properties = setBit(properties, 12, f.mobileOptimized);
  properties = setBit(properties, 13, f.privacyProtected);
  properties = setBit(properties, 14, f.trackChanges);
  properties = setBit(properties, 15, f.kogl);
  properties = setBit(properties, 16, f.hasVideoControl);
  properties = setBit(properties, 17, f.hasTableOfContentsField);
  writer.uint32(properties);

  let license = 0;
  license = setBit(license, 0, header.license.hasLicenseInfo);
  license = setBit(license, 1, header.license.copyRestricted);
  license = setBit(license, 2, header.license.shareAlike);
  writer.uint32(license);

  writer.uint32(header.encryptVersion);
  writer.uint8(header.koglCountry);
  writer.zeros(FILE_HEADER_SIZE - 49);

  return writer.finish();
}

export function createFileHeader(
  version: DocumentVersion,
  flags: Partial<HwpFlags> = {},
): FileHeader {
  return {
    version,
    flags: { ...DEFAULT_FLAGS, ...flags },
    license: {
      hasLicenseInfo: false,
      copyRestricted: false,
      shareAlike: false,
    },
    encryptVersion: 0,
    koglCountry: 0,
  };
}

/** 버전을 `5.1.1.0` 형태로 렌더링한다. */
export const formatVersion = (v: DocumentVersion): string =>
  `${v.major}.${v.minor}.${v.build}.${v.revision}`;
