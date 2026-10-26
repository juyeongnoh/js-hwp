/**
 * 스트림 압축.
 *
 * FileHeader에 `compressed` 플래그가 켜지면 레코드 스트림은 **raw
 * DEFLATE**(RFC 1951)다. zlib 래퍼도 없고 Adler-32 꼬리도 없다.
 * `inflateRawSync` 대신 `inflateSync`를 잡는 게 멀쩡한 HWP 파일에서
 * "incorrect header check"를 얻는 전형적인 방법이다.
 */

import { deflateSync, inflateSync, unzlibSync } from 'fflate'
import { HwpFormatError } from './bytes.js'

/**
 * 레코드 스트림을 inflate한다.
 *
 * 명세와 달리 zlib 래퍼를 내보내는 서드파티 라이터가 몇 있어서, zlib 헤더를
 * 감지하면 호환성 대체 경로로 처리한다.
 */
export function inflate(data: Uint8Array): Uint8Array {
  if (data.length === 0) return data

  try {
    return inflateSync(data)
  } catch (rawError) {
    if (looksLikeZlib(data)) {
      try {
        return unzlibSync(data)
      } catch {
        // 원래의 raw inflate 실패를 보고하도록 흘려보낸다.
      }
    }
    throw new HwpFormatError(
      `스트림 압축 해제에 실패했습니다 (${data.length}바이트): ${(rawError as Error).message}`,
    )
  }
}

/** HWP가 기대하는 raw 형식으로 레코드 스트림을 deflate한다. */
export function deflate(data: Uint8Array, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6): Uint8Array {
  return deflateSync(data, { level })
}

/**
 * zlib 스트림은 CMF/FLG 바이트로 시작하는데, CMF의 하위 니블이 8이고 16비트
 * 값이 31의 배수다.
 */
function looksLikeZlib(data: Uint8Array): boolean {
  if (data.length < 2) return false
  const cmf = data[0]!
  const flg = data[1]!
  return (cmf & 0x0f) === 8 && (((cmf << 8) | flg) % 31 === 0)
}

/** 문서가 스트림이 압축돼 있다고 말할 때만 압축을 푼다. */
export const maybeInflate = (data: Uint8Array, compressed: boolean): Uint8Array =>
  compressed ? inflate(data) : data

export const maybeDeflate = (data: Uint8Array, compressed: boolean): Uint8Array =>
  compressed ? deflate(data) : data
