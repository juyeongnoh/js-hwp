/**
 * 디렉터리 항목 이름 접기와 정렬 — MS-CFB §2.6.4.
 *
 * 두 규칙이 함께 있는 이유는, 리더가 접기를 필요로 하고(포맷이 정한 방식대로
 * 이름을 대조하려고) 라이터가 정렬을 필요로 하기 때문이다(이진 탐색하는
 * 리더가 탐색할 수 있는 디렉터리를 내보내려고).
 */

/**
 * MS-CFB가 이름을 비교하는 방식대로 대문자로 만든다.
 *
 * 이 포맷은 이름을 윈도우의 로케일 독립 대문자 표를 거쳐 접는데, 그 표는
 * **UTF-16 코드 단위 하나를 정확히 코드 단위 하나로** 사상한다. JavaScript의
 * `String.prototype.toUpperCase`는 대신 완전한 유니코드 대소문자 사상을
 * 구현해서 `'ß'`가 `'SS'`가 되고 `'ﬅ'`가 `'ST'`가 된다. 이 포맷은 절대 만들지
 * 않는 길이 변화다. 코드 단위별로 접되 사상이 1대1이 아니면 원본을 유지하면
 * 윈도우 동작이 재현되고, 더 중요하게는 아래 비교가 의존하는
 * `foldName(s).length === s.length`가 유지된다.
 *
 *
 * BMP 밖 이름은 서로게이트 단위로 접힌다. 즉 그대로 둔다. 윈도우도 이 표에서
 * 아스트랄 평면에 대해 같은 일을 하고, 어차피 복합 파일 이름은 최대 31 코드
 * 단위다.
 */
export function foldName(name: string): string {
  let out = ''
  for (let i = 0; i < name.length; i++) {
    const ch = name[i]!
    const upper = ch.toUpperCase()
    out += upper.length === 1 ? upper : ch
  }
  return out
}

/**
 * MS-CFB §2.6.4가 요구하는 방식대로 디렉터리 항목 이름 둘을 비교한다.
 * 짧은 이름이 앞서고, 그다음 UTF-16 코드 단위를 대소문자 무시로 비교한다.
 *
 *
 * 이걸 틀리면 관대한 리더에서는 열리지만 디렉터리 트리를 이진 탐색하는
 * 리더에서는 실패하는 파일이 나온다. 거기에는 윈도우 구조적 저장소가, 따라서
 * 한글이 포함된다.
 */
export function compareEntryNames(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  // 같은 길이가 들어가면 같은 길이가 나온다 — foldName 참조.
  const upperA = foldName(a)
  const upperB = foldName(b)
  for (let i = 0; i < upperA.length; i++) {
    const diff = upperA.charCodeAt(i) - upperB.charCodeAt(i)
    if (diff !== 0) return diff
  }
  return 0
}
