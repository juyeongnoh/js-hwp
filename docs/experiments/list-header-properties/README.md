# 셀 LIST_HEADER 속성(표 65)의 비트

명세 표 65는 문단 리스트 속성에 글자 방향(bit 0~2), 줄바꿈(bit 3~4), 세로 정렬(bit 5~6)만 적었다. 저장소 HWP의 셀 LIST_HEADER에는 bit 3, 16, 24, 26도 켜져 있었다. HWPX 셀(`hp:tc`)에는 `header`, `hasMargin`, `protect`, `editable`, `dirty` 속성이 있다. 그래서 한글에서 셀 속성을 하나씩 바꿔 HWP와 HWPX로 저장해 대조했다. 이어서 비트를 하나씩 켠 파일을 한글로 열고 다시 저장했다.

- 날짜: 2026-11-20
- 환경: Windows용 한글 2024(자동화 `Version` 13.0.0.4226). 한글 자동화(COM, `HWPFrame.HwpObject`)로 문서를 만들고 저장했다. 손으로 대화상자를 열지 않았다.
- 바꾼 곳: `BodyText/Section0` 표 셀 LIST_HEADER의 오프셋 4(속성 UINT32)

셀 속성은 `TablePropertyDialog` 액션의 `ShapeTableCell` 파라미터로 바꿨다. 이 파라미터 셋의 항목은 `Header`, `HasMargin`, `Protected`, `Editable`, `Dirty`, `TextDirection`, `VertAlign`, `LineWrap`, 여백 네 개, `Width`, `Height`, `CellCtrlData`였다.

## 셀마다 속성을 바꿔 저장한 파일

`cell-props.hwp`와 `cell-props.hwpx`는 같은 문서다. 5×3 표의 셀 i(행 우선)에 텍스트 `c<i>`를 넣고 속성 하나를 바꿨다.

| 셀 | 바꾼 항목 | HWP 속성 | 켜진 비트 | HWPX |
| --- | --- | --- | --- | --- |
| c0 | (없음) | `0x00000020` | 5 | 모두 기본 |
| c1 | `Header=1` | `0x00040020` | 5, **18** | `header="1"` |
| c2 | `HasMargin=1`, 여백 1000/1000/500/500 | `0x00010020` | 5, **16** | `hasMargin="1"` |
| c3 | `HasMargin=1`, 여백은 표 기본과 같음 | `0x00010020` | 5, **16** | `hasMargin="1"` |
| c4 | `Editable=1` | `0x00080020` | 5, **19** | `editable="1"` |
| c5 | `Dirty=1` | `0x00100020` | 5, **20** | `dirty="1"` |
| c6 | `TextDirection=1` | `0x00000021` | **0**, 5 | `textDirection="VERTICAL"` |
| c7 | `TextDirection=2` | `0x00000022` | **1**, 5 | `textDirection="VERTICALALL"` |
| c8 | `LineWrap=1` | `0x00000028` | **3**, 5 | `lineWrap="SQUEEZE"` |
| c9 | `LineWrap=2` | `0x00000030` | **4**, 5 | `lineWrap="KEEP"` |
| c10 | `VertAlign=0` | `0x00000000` | | `vertAlign="TOP"` |
| c11 | `VertAlign=2` | `0x00000040` | 6 | `vertAlign="BOTTOM"` |
| c12 | (없음) | `0x00000020` | 5 | 모두 기본 |
| c13 | `Header=1`, `Editable=1` | `0x000c0020` | 5, 18, 19 | `header="1" editable="1"` |
| c14 | `Protected=1` | `0x04020020` | 5, **17**, **26** | `protect="1"` |

- HWPX의 `textWidth`, `textHeight`, `hasTextRef`, `hasNumRef`는 모든 셀에서 0이었다.
- c14의 bit 26은 아래 "bit 26"에서 따로 봤다.
- `first-try-cell-props.hwp`(와 `.hwpx`)는 첫 시도다. c4에 셀 보호를 켠 뒤 `TableRightCell`로 옮기자 커서가 어긋나, 셀의 텍스트와 바꾼 항목이 맞지 않았다. 셀 순서대로 HWP 비트와 HWPX 속성을 맞춰 보면 결론은 같다. 그래서 다시 만들 때 보호 셀을 맨 뒤로 옮겼다.

## 비트를 하나씩 켠 파일

`base-2cell.hwp`는 자동화로 만든 1×2 빈 표다. 첫 셀 속성은 `0x00000020`이다. 첫 셀 LIST_HEADER의 속성만 바꿨다. 한글로 열어 아무것도 바꾸지 않고 HWP와 HWPX로 다시 저장한 결과는 `resaved/`에 있다.

| 파일 | 첫 셀 속성 | 다시 저장한 HWP | 다시 저장한 HWPX |
| --- | --- | --- | --- |
| `bit16.hwp` | `0x00010020` | 같음 | `hasMargin="1"` |
| `bit17.hwp` | `0x00020020` | 같음 | `protect="1"` |
| `bit18.hwp` | `0x00040020` | 같음 | `header="1"` |
| `bit19.hwp` | `0x00080020` | 같음 | `editable="1"` |
| `bit20.hwp` | `0x00100020` | 같음 | `dirty="1"` |
| `bit21.hwp` ~ `bit31.hwp` | bit 21~31 하나씩 | 같음 | 기본과 같음 |
| `textdir-3.hwp` | `0x00000023` (글자 방향 3) | 같음 | `textDirection` 속성이 빠짐 |
| `textdir-4.hwp` | `0x00000024` (글자 방향 4, bit 2) | 같음 | `textDirection` 속성이 빠짐 |
| `linewrap-3.hwp` | `0x00000038` (줄바꿈 3) | 같음 | `lineWrap` 속성이 빠짐 |
| `valign-3.hwp` | `0x00000060` (세로 정렬 3) | 같음 | `vertAlign` 속성이 빠짐 |

"같음"은 다시 저장한 HWP의 첫 셀 속성이 바꾼 값 그대로라는 뜻이다. 둘째 셀은 모든 파일에서 `0x00000020`이었다. 본문에 그려진 모습과 대화상자는 보지 않았다.

## bit 26

| 파일 | 만든 방법 | 첫 셀 | 둘째 셀 |
| --- | --- | --- | --- |
| `protect-first-cell.hwp` | 첫 셀에 `Protected=1` | `0x00020020` | `0x00000020` |
| `protect-last-cell.hwp` | 둘째(마지막) 셀에 `Protected=1` | `0x00000020` | `0x04020020` |
| `header-last-cell.hwp` | 둘째(마지막) 셀에 `Header=1` | `0x00000020` | `0x00040020` |

- 표의 마지막 셀에 셀 보호를 켤 때만 bit 26이 함께 켜졌다. `cell-props.hwp`의 c14도 마지막 셀이었다.
- 첫 셀에 보호를 켜기 전후로 텍스트를 넣거나, 셀 사이를 오가거나, 문단을 나눠도 bit 26은 켜지지 않았다(파일은 남기지 않았다).
- `resaved/resaved-protect-last-cell.hwp`에서도 bit 26은 그대로였다.
- 이 폴더 밖의 저장소 HWP 셀 7,739개 중 2,594개에 bit 26이, 3,560개에 bit 24가 켜져 있었다. 이 셀들은 모두 셀 보호(bit 17)가 꺼져 있었다. 그러니 bit 26이 셀 보호만의 표시는 아니다. 자동화로 만든 표에서는 bit 24가 한 번도 켜지지 않았다.

## 결론

- **bit 16~20은 HWPX `hp:tc`의 `hasMargin`, `protect`, `header`, `editable`, `dirty`다.** 저장할 때도, 비트만 켠 파일을 읽을 때도 같았다.
- **bit 0~2는 글자 방향이다**(0 가로, 1 세로·영문 눕힘, 2 세로·영문 세움). HWPX `textDirection`의 `HORIZONTAL`, `VERTICAL`, `VERTICALALL`이다. bit 2만 켠 값 4도 범위 밖 값으로 처리되어 HWPX 속성이 빠졌다. 그래서 bit 2도 이 필드에 속한다.
- **bit 3~4는 줄바꿈이다**(0 `BREAK`, 1 `SQUEEZE`, 2 `KEEP`). 명세의 "일반적인 줄바꿈", "자간을 조종하여 한 줄을 유지", "내용에 따라 폭이 늘어남" 순서와 같다.
- **한글은 범위 밖 값(글자 방향 3·4, 줄바꿈 3, 세로 정렬 3)과 bit 21~31을 다시 저장할 때 지우지 않는다.** HWPX로 내보낼 때는 범위 밖 필드의 속성을 빼고, bit 21~31은 어디에도 쓰지 않는다.
- **bit 24, 26의 뜻은 모른다.** HWPX에 대응 속성이 없다. 마지막 셀에 셀 보호를 켜면 bit 26이 함께 켜지는 것만 확인했다.
- 미확인: 각 비트가 본문 그림과 편집 동작에 주는 영향(셀 보호, 양식 모드 편집 등), `dirty`의 뜻, 셀이 아닌 LIST_HEADER(캡션, 머리말·꼬리말, 바탕쪽, 메모)의 같은 비트.

## 재현

저장소 루트에서 실행한다. 한글 2024, pywin32, 자동화 보안 모듈 등록이 필요하다. 출력 폴더의 파일 이름은 이 폴더의 파일 이름과 같다.

```bash
D=docs/experiments/list-header-properties
python -I docs/experiments/scripts/make-cell-props.py $D                     # cell-props.hwp, .hwpx
python -I docs/experiments/scripts/make-cell-prop-one.py $D/base-2cell.hwp 0
python -I docs/experiments/scripts/make-cell-prop-one.py $D/protect-first-cell.hwp 0 Protected=1
python -I docs/experiments/scripts/make-cell-prop-one.py $D/protect-last-cell.hwp 1 Protected=1
python -I docs/experiments/scripts/make-cell-prop-one.py $D/header-last-cell.hwp 1 Header=1
# 비트 n(16~31)을 켠 파일: 오프셋 6의 UINT16에 1 << (n - 16)
for n in $(seq 16 31); do npx tsx docs/experiments/scripts/patch-list-header.ts $D/base-2cell.hwp $D/bit$n.hwp 0 6 $((1 << (n - 16))); done
npx tsx docs/experiments/scripts/patch-list-header.ts $D/base-2cell.hwp $D/textdir-3.hwp 0 4 35   # 0x23
npx tsx docs/experiments/scripts/patch-list-header.ts $D/base-2cell.hwp $D/textdir-4.hwp 0 4 36   # 0x24
npx tsx docs/experiments/scripts/patch-list-header.ts $D/base-2cell.hwp $D/linewrap-3.hwp 0 4 56  # 0x38
npx tsx docs/experiments/scripts/patch-list-header.ts $D/base-2cell.hwp $D/valign-3.hwp 0 4 96    # 0x60
python -I docs/experiments/scripts/resave-hwp.py $D/resaved $D/base-2cell.hwp $D/bit*.hwp $D/textdir-*.hwp $D/linewrap-3.hwp $D/valign-3.hwp $D/protect-last-cell.hwp
npx tsx docs/experiments/scripts/dump-cell-list-props.ts $D/cell-props.hwp
```

자동화로 만든 파일은 저장할 때마다 바이트가 조금씩 다를 수 있다(문서 요약 정보의 시각 등). 셀 LIST_HEADER의 속성 값으로 비교한다. 2026-11-20에 위 명령으로 다시 만들어 속성 값이 표와 같음을 확인했다.
