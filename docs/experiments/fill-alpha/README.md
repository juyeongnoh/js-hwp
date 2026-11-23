# 채우기 끝 바이트(투명도)가 화면에 적용되는지

채우기 정보(표 28) 끝에는 켜진 종류마다 1바이트가 붙는다. 한글 2024 그리기 개체 "채우기" 탭의 투명도 30%가 77로 저장되는 것은 확인했지만(`experiments/shape-fill`), 그 값이 실제로 그려지는지, 값의 방향, 두 바이트가 어느 종류의 것인지, 셀 배경에서도 쓰이는지는 확인하지 않았다. 바이트만 바꾼 파일을 Windows 한글로 열어 확인했다.

- 날짜: 2026-11-24
- 환경: Windows용 한글 2024(파일 버전 5.1.2.0). 파일 열기, 대화상자, 저장은 computer use로 직접 조작했다.
- 만든 방법: `patch-record.mjs`로 레코드 페이로드의 바이트만 바꿨다.
  - `shape-red-<n>`: `experiments/shape-fill/color-alpha.hwp`의 SHAPE_COMPONENT에서 면 색(오프셋 213)을 빨강 `ff 00 00 00`, 투명도(오프셋 229)를 n으로.
  - `shape-red-image-<색>-<그림>`: `experiments/shape-fill/color-image.hwp`(색 + 그림, 그림은 파란 `solid-64.bmp`)의 면 색을 빨강, 오프셋 235·236의 두 바이트를 각각 색·그림 값으로.
  - `shape-gradient-<n>`: `experiments/shape-fill/gradient.hwp`(흰색→검정 그러데이션)의 투명도(오프셋 247)를 n으로.
  - `shape-gradient-image-<그러데이션>-<그림>`: `experiments/shape-fill/gradient-image.hwp`의 오프셋 253·254를 각각 그러데이션·그림 값으로.
  - `cell-red-<n>`: `experiments/fill-multi-kind-priority/1-color.hwp`의 네 번째 BorderFill에서 배경(오프셋 36)을 빨강, 투명도(오프셋 52)를 n으로.
  - `para-page-base`: 새 문서에 문단 하나를 쓰고 문단 모양 › 테두리/배경의 면 색을 빨강, 쪽 테두리/배경 › 배경을 색(파랑)으로 저장한 것. BorderFill 2가 문단, 3이 쪽 배경이다. `para-red-<n>`, `page-blue-<n>`은 각 BorderFill의 투명도(오프셋 52)를 n으로.
  - `char-base`: `resaved-para-red-255`에서 문단 글자 전체의 글자 모양 › 테두리/배경 면 색을 노랑으로 저장한 것. BorderFill 4가 글자 배경이다. `char-yellow-<n>`은 그 투명도를 n으로.
  - `resaved-*`: 위 파일을 한글로 열고 아무것도 바꾸지 않고 다시 저장한 것.

## 그리기 개체

| 파일 | 투명도 바이트 | 화면 | 대화상자 투명도 |
| --- | --- | --- | --- |
| `shape-red-0` | 0 | 진한 빨강 | |
| `shape-red-77` | 77 | 조금 옅은 빨강 | |
| `shape-red-200` | 200 | 옅은 분홍 | 78% |
| `shape-red-255` | 255 | 보이지 않음(테두리만) | 100% |
| `shape-red-image-0-200` | 색 0, 그림 200 | 빨강이 비친다(그림이 거의 투명) | |
| `shape-red-image-200-0` | 색 200, 그림 0 | 파란 그림만 | |

- **값은 투명한 정도다.** 0이 불투명, 255가 완전히 투명하다. 대화상자는 값/255를 %로 보인다(200 → 78%).
- **두 바이트는 블록 순서대로 각 종류의 투명도다.** 첫째가 색, 둘째가 그림에 적용됐다.
- `resaved-shape-red-200.hwp`: 한글이 다시 저장해도 200 그대로였다.

그러데이션도 같았다.

| 파일 | 투명도 바이트 | 화면 | 대화상자 투명도 |
| --- | --- | --- | --- |
| `shape-gradient-0` | 0 | 흰색→검정 | |
| `shape-gradient-200` | 200 | 옅은 회색 그러데이션 | 78% |
| `shape-gradient-255` | 255 | 보이지 않음(테두리만) | |
| `shape-gradient-image-0-200` | 그러데이션 0, 그림 200 | 그러데이션이 비친다(그림이 거의 투명) | |
| `shape-gradient-image-200-0` | 그러데이션 200, 그림 0 | 파란 그림만 | |

## DocInfo 테두리/배경 (셀, 문단, 쪽, 글자)

| 파일 | 대상 | 투명도 바이트 | 화면 |
| --- | --- | --- | --- |
| `cell-red-0`, `-200`, `-255` | 셀 배경 빨강 | 0, 200, 255 | 셋 다 진한 빨강 |
| `para-page-base`, `para-red-200`, `-255` | 문단 배경 빨강 | 0, 200, 255 | 셋 다 진한 빨강 |
| `para-page-base`, `page-blue-200`, `-255` | 쪽 배경 파랑 | 0, 200, 255 | 셋 다 진한 파랑 |
| `char-base`, `char-yellow-200`, `-255` | 글자 배경 노랑 | 0, 200, 255 | 셋 다 진한 노랑 |

- 네 곳 모두 투명도를 그리지 않았다. macOS 한글 셀 배경 실험(`experiments/fill-trailing-unknown-byte`)과 같다.
- 네 곳의 대화상자 모두 투명도 칸이 없다. 셀·쪽 배경은 색·그러데이션·그림을, 문단·글자 배경은 면 색과 무늬만 고른다.
- `resaved-cell-red-255`, `resaved-para-red-255`, `resaved-page-blue-255`, `resaved-char-yellow-255`: 한글이 다시 저장해도 255 그대로였다.

## 결론

- 채우기 끝 바이트는 투명도(0 불투명 ~ 255 완전 투명)이고, 켜진 종류마다 블록 순서(단색, 그러데이션, 그림)로 각 종류에 적용된다.
- 화면에 적용되는 곳은 그리기 개체의 채우기뿐이었다. DocInfo 테두리/배경(셀, 문단, 쪽, 글자)은 값을 그리지 않지만 보존한다.
