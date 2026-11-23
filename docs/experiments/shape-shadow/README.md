# 그리기 개체 SHAPE_COMPONENT의 채우기 뒤 22바이트

그리기 개체(사각형)의 SHAPE_COMPONENT는 테두리 선 정보(13바이트, 정정 89)와 채우기 정보(표 28) 뒤에 22바이트가 더 있다. 명세 표 81은 채우기 뒤에 글상자 12바이트만 적었지만, 글상자는 이 레코드가 아니라 자식 LIST_HEADER에 있고, 글상자가 있는 사각형과 없는 사각형의 22바이트는 개체마다 다른 4바이트 말고는 같았다. 그래서 같은 파일의 HWPX와 맞춰 보고, 한글 개체 속성 "그림자" 탭을 바꿔 가며 저장했다.

- 날짜: 2026-11-24
- 환경: Windows용 한글 2024(파일 버전 5.1.2.0). 대화상자와 저장은 computer use로 직접 조작했다.
- 기반: `base.hwp`(`experiments/shape-outline-style/unchecked.hwp`의 사본, 그림자 없는 기본 사각형).
- 바꾼 곳: `BodyText/Section0` SHAPE_COMPONENT 오프셋 230(ID 8 + 개체 요소 속성 42 + Rendering 정보 146 + 테두리 선 13 + 단색 채우기 21)부터 22바이트.

## 배치

| 오프셋 | 자료형 | 뜻 | 근거 |
| --- | --- | --- | --- |
| 0 | UINT32 | 그림자 종류 | 아래 표 |
| 4 | COLORREF | 그림자 색 | 기본 `b2 b2 b2 00` = HWPX `color="#B2B2B2"` |
| 8 | INT32 | 그림자 가로 이동 | 1.0mm → 283 = HWPX `offsetX="283"` |
| 12 | INT32 | 그림자 세로 이동 | 2.0mm → 566 = HWPX `offsetY="566"` |
| 16 | UINT32 | 인스턴스 ID | `2a ff cd 0a` = HWPX `hp:rect`의 `instid="181272362"`(`0x0ACDFF2A`). 개체마다 다르고 다시 저장해도 그대로였다 |
| 20 | BYTE | ? | 모든 파일에서 0 |
| 21 | BYTE | 그림자 투명도 | 30% → 77(255 × 0.3) = HWPX `alpha="77"` |

```
base.hwp     00 00 00 00 | b2 b2 b2 00 | 00 00 00 00 | 00 00 00 00 | 2a ff cd 0a | 00 | 00
shadow-1.hwp 0d 00 00 00 | b2 b2 b2 00 | 1b 01 00 00 | 36 02 00 00 | 2a ff cd 0a | 00 | 4d
```

`shadow-1`은 첫 그림자 종류를 고르고 가로 1.0mm, 세로 2.0mm, 투명도 30%로 바꾼 것이다. 그림자 종류를 고르면 색·이동·투명도 칸이 활성화되고, 이동은 0.0mm 그대로였다.

## 그림자 종류

대화상자의 "종류"는 없음과 두 줄 다섯 칸의 아이콘 10개다. `shadow-1`의 이동·투명도를 둔 채 종류만 바꿔 HWP와 HWPX로 저장했다(`type-r<줄>c<칸>`).

| 아이콘 | 파일 | HWP 값 | HWPX `hp:shadow type` |
| --- | --- | --- | --- |
| 없음 | `base` | 0 | `NONE` |
| 1줄 1칸 | `shadow-1` | 13 | `SCALE_NARROW` |
| 1줄 2칸 | `type-r1c2` | 1 | `PARELLEL_LEFTTOP` |
| 1줄 3칸 | `type-r1c3` | 2 | `PARELLEL_RIGHTTOP` |
| 1줄 4칸 | `type-r1c4` | 5 | `SHEAR_LEFTTOP` |
| 1줄 5칸 | `type-r1c5` | 6 | `SHEAR_RIGHTTOP` |
| 2줄 1칸 | `type-r2c1` | 14 | `SCALE_ENLARGE` |
| 2줄 2칸 | `type-r2c2` | 3 | `PARELLEL_LEFTBOTTOM` |
| 2줄 3칸 | `type-r2c3` | 4 | `PARELLEL_RIGHTBOTTOM` |
| 2줄 4칸 | `type-r2c4` | 7 | `SHEAR_LEFTBOTTOM` |
| 2줄 5칸 | `type-r2c5` | 8 | `SHEAR_RIGHTBOTTOM` |

대화상자로는 9~12를 만들 수 없다. HWPX 이름의 `PARELLEL`은 한글이 쓴 철자 그대로다.

## 확인하지 않은 것

- 오프셋 20의 바이트.
- 그림자 색을 바꿨을 때의 바이트(기본 회색 `#B2B2B2`만 봤다. 바이트 순서는 다른 COLORREF와 같다고 본다).
- 대화상자 화살표 버튼으로 만든 음수 이동.
- 9~12를 넣은 파일을 한글이 어떻게 읽는지.
