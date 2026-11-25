# 캡션의 8방향 (표 72, 73, 65)

한글 대화상자는 캡션 위치를 8방향으로 고르는데 명세 표 73의 방향은 4가지(left, right, top, bottom)뿐이다. 8방향이 파일에 어떻게 저장되는지 확인한다.

- 날짜: 2026-11-25
- 환경: Windows용 한글 2024. 에이전트가 화면을 조작했다.

## 만든 파일

| 파일 | 만든 방법 |
| --- | --- |
| `table-caption-positions.hwp`, `.hwpx` | 새 문서에 2×2 표 10개를 만들고(입력 › 표, 기본값) 표마다 캡션 넣기(Ctrl+N, C) 뒤 표/셀 속성 › 여백/캡션에서 위치를 골랐다. 순서대로 왼쪽 위, 왼쪽 가운데, 왼쪽 아래, 위, 아래, 오른쪽 위, 오른쪽 가운데, 오른쪽 아래, 아래 + "한 줄로 입력", 아래 + "여백 부분까지 너비 확대". 캡션 텍스트에 위치 이름을 적었다(첫 표는 `cap`). 먼저 HWPX로 저장한 뒤 같은 문서를 HWP로 다시 저장했다 |
| `rect-caption-right-middle-oneline.hwp` | 새 문서에 사각형을 그리고 캡션 넣기 뒤 개체 속성 › 여백/캡션에서 오른쪽 가운데와 "한 줄로 입력"을 골랐다 |

## 결과

| 대화상자 | 리스트 속성(오프셋 4) | 캡션 속성(오프셋 8) | 텍스트 최대 길이 |
| --- | --- | --- | --- |
| 왼쪽 위 / 가운데 / 아래 | `0x00` / `0x20` / `0x40` | 0 | 8504(캡션 폭) |
| 위 | `0x00` | 2 | 41954(표 폭) |
| 아래 | `0x00` | 3 | 41954 |
| 오른쪽 위 / 가운데 / 아래 | `0x00` / `0x20` / `0x40` | 1 | 8504 |
| 아래 + 한 줄로 입력 | `0x08` | 3 | 41954 |
| 아래 + 여백 부분까지 너비 확대 | `0x00` | 7 | 42520(표 폭 + 바깥 여백 283 × 2) |
| 사각형, 오른쪽 가운데 + 한 줄로 입력 | `0x28` | 1 | 8504 |

모든 캡션의 폭은 8504(30mm), 간격은 850(3mm), 끝 8바이트는 0이었다. HWPX는 `hp:caption side`와 `hp:subList vertAlign`, `lineWrap`, `fullSz`로 같은 값을 적었다.

- 8방향 = 4방향(캡션 속성 bit 0~1) × 리스트 세로 정렬(bit 5~6). 세로 정렬은 왼쪽·오른쪽에서만 고를 수 있다.
- "한 줄로 입력" = 리스트 줄바꿈(bit 3~4) 1(자간 조정). `../caption-list-properties`의 캡션에서 bit 3이 켜져 있던 이유로 보인다.
- "여백 부분까지 너비 확대" = 캡션 속성 bit 2. 위·아래에서만 활성이다.
- 코덱은 두 HWP의 구역 스트림을 원본과 바이트 단위로 같게 다시 쓴다(`packages/hwp/test/object-placement.test.ts`).

정오표 정정 106, E55, `hangul-behavior.md` "캡션".

## 재현

```bash
npx vite-node docs/experiments/scripts/dump-captions.ts docs/experiments/caption-positions/*.hwp
npx vite-node docs/experiments/scripts/dump-caption-list-props.ts docs/experiments/caption-positions/*.hwpx
```
