# 구역 정의 오프셋 30은 메모 모양 ID(UINT16, 1부터)다

E27에서 구역 정의(표 129)의 26B 뒤 영역 오프셋 30이 메모 모양 ID로 보였다. 근거는 HWPX의 `memoShapeIDRef`와 문서 정보의 메모 모양(MEMO_SHAPE) 수뿐이었다. 이번에는 구역마다 다른 메모 모양을 쓰는 문서를 한글에서 만들고, 그 값을 바꾼 파일을 한글에서 열었다.

- 날짜: 2026-11-17
- 환경: Windows용 한글 2024. 파일 버전 5.1.2.0. 앱 버전은 기록하지 않았다.
- 기반: `base-two-memo-shapes.hwp`. 한글 새 문서에 "가나다 ABC 123"과 메모 "memo one"을 넣었다. 구역 나누기 뒤 "section two"와 메모 "memo two"를 넣었다. 둘째 구역에서 메모 모양 대화상자의 너비를 80mm로 바꿨다(적용 범위 "현재 구역"). 그 뒤 HWP로 저장했다.
- 바꾼 곳: `BodyText/Section0` 첫 `secd` CTRL_HEADER 페이로드의 바이트 34, 35(표 129 오프셋 30, 31)

## 한글에서 저장한 파일

| 파일 | 문서 정보 메모 모양 | Section0 바이트 34~35 | Section1 바이트 34~35 |
| --- | --- | --- | --- |
| `saved-memo-default.hwp` | 1개: 너비 `0x3CE7`(15591, 55mm) | `01 00` | (구역 하나) |
| `base-two-memo-shapes.hwp` | 2개: 55mm, `0x5895`(22677, 80mm) | `01 00` | `02 00` |

`saved-memo-default.hwp`는 첫 구역에 메모를 넣고 구역을 나누기 전에 저장한 파일이다. 두 메모 모양 레코드는 너비 4B만 달랐다.

## 바이트를 바꾼 파일

본문 오른쪽 메모 칸의 너비를 1쪽(Section0)과 2쪽(Section1)에서 비교해 판단했다. 그 뒤 아무것도 바꾸지 않고 `resaved-…`로 다시 저장했다.

| 파일 | 바이트 34~35 | 읽은 값 | 1쪽 메모 칸 | 다시 저장 |
| --- | --- | --- | --- | --- |
| `base-two-memo-shapes.hwp` (대조) | `01 00` | 1 | 55mm (2쪽보다 좁음) | — |
| `section0-byte34-02.hwp` | `02 00` | 2 | 80mm (2쪽과 같음) | (저장 안 함) |
| `section0-byte34-00.hwp` | `00 00` | 0 | 55mm | `resaved-section0-byte34-00.hwp` |
| `section0-byte34-03.hwp` | `03 00` | 3 (범위 밖) | 55mm | `resaved-section0-byte34-03.hwp` |
| `first-try-section0-byte35-01.hwp` | `01 01` | UINT8이면 1, UINT16이면 257 | 55mm | (저장 안 함) |
| `section0-byte34-02-byte35-01.hwp` | `02 01` | UINT8이면 2, UINT16이면 258 | 55mm | `resaved-section0-byte34-02-byte35-01.hwp` |

`first-try-…`은 두 해석 모두 55mm가 되어 구별하지 못한 시도다. 그래서 두 해석의 결과가 갈리는 `02 01`로 다시 만들었다.

다시 저장한 세 파일은 모두 같았다.

- 문서 정보의 메모 모양이 80mm 하나로 줄었다. 아무 구역도 가리키지 않게 된 55mm 레코드를 한글이 지웠다.
- Section0의 바이트 34~35는 `00 00`, Section1은 `01 00`이 됐다. 한글이 남은 메모 모양에 맞춰 ID를 다시 매겼다.

## 결론

- 표 129 오프셋 30(페이로드 바이트 34)은 이 구역이 쓰는 메모 모양 ID다. 문서 정보의 메모 모양을 1부터 가리킨다. ID 2를 넣자 첫 구역도 둘째 메모 모양(80mm)으로 그려졌다.
- 길이는 UINT16이다. 바이트 35를 켜면 ID 2가 258로 읽혀 범위 밖처럼 그려졌다. 다시 저장하면 0이 됐다. 바로 뒤 오프셋 32(바이트 36)는 글자 방향 속성이다(E27). 따라서 4B가 아니다.
- 0과 범위 밖의 ID는 "메모 모양 없음"으로 다룬다. 본문은 55mm 메모 칸으로 그렸고, 다시 저장하면 0으로 썼다. 문서 정보에 메모 모양이 없는 파일이 모두 0이었던 것(E27)과 맞는다.
- 한글은 저장할 때 쓰이지 않는 메모 모양 레코드를 지우고 구역의 ID를 다시 매긴다.
- 미확인: 0일 때 쓰는 55mm가 한글의 기본값인지 첫 메모 모양인지는 구별하지 못했다. 이 파일들에서는 둘이 같은 55mm다.

## 재현

저장소 루트에서 실행한다.

```bash
npx tsx docs/experiments/scripts/patch-section-def-byte.ts docs/experiments/section-memo-shape-id/base-two-memo-shapes.hwp <출력 폴더>/section0-byte34-02.hwp 34 2
npx tsx docs/experiments/scripts/patch-section-def-byte.ts docs/experiments/section-memo-shape-id/base-two-memo-shapes.hwp <출력 폴더>/section0-byte34-00.hwp 34 0
npx tsx docs/experiments/scripts/patch-section-def-byte.ts docs/experiments/section-memo-shape-id/base-two-memo-shapes.hwp <출력 폴더>/section0-byte34-03.hwp 34 3
npx tsx docs/experiments/scripts/patch-section-def-byte.ts docs/experiments/section-memo-shape-id/base-two-memo-shapes.hwp <출력 폴더>/first-try-section0-byte35-01.hwp 35 1
npx tsx docs/experiments/scripts/patch-section-def-byte.ts <출력 폴더>/section0-byte34-02.hwp <출력 폴더>/section0-byte34-02-byte35-01.hwp 35 1
```

2026-11-17에 이 폴더의 기반 파일로 다시 생성해 다섯 파일 모두 바이트가 같음을 확인했다. `saved-…`, `resaved-…`, `base-…` 파일은 한글에서 손으로 만든 파일이라 다시 생성할 수 없다. 메모 모양과 26B 뒤 영역은 `docs/experiments/scripts/dump-section-def.ts <파일…>`로 볼 수 있다.
