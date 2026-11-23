# 표 속성(표 76)의 비트

명세 표 76은 TABLE 레코드 속성(UINT32)에 쪽 경계에서 나눔(bit 0~1)과 제목 줄 자동 반복(bit 2)만 적었고, 나눔 값 2를 0과 같은 "나누지 않음"으로 적었다. 저장소 HWP의 TABLE 464개에서는 값 2가 가장 흔했고, 명세에 없는 bit 3(167개), 24(27개), 25(148개), 26(322개)이 켜져 있었다. 코덱은 쓸 때 이 비트들을 버린다(BACKLOG). 그래서 한글 대화상자의 값과 HWPX `hp:tbl` 속성을 대조하고, 비트를 하나씩 켠 파일을 한글로 다시 저장해 봤다.

- 날짜: 2026-11-24
- 환경: Windows용 한글 2024(파일 버전 5.1.2.0). 표 만들기와 표/셀 속성 대화상자는 computer use로 직접 조작했다. 다시 저장은 한글 자동화(`resave-hwp.py`)로 했다.
- 기반: `base-2x2.hwp`(새 문서에 "표 만들기" 기본값 2×2 표, 너비 "임의 값"). 같은 문서를 HWPX로도 저장했다(`base-2x2.hwpx`).
- 바꾼 곳: `BodyText/Section0` TABLE 레코드 오프셋 0(속성 UINT32)

## 대화상자 "표" 탭의 값

`base-2x2`에서 하나씩 바꿔 HWP와 HWPX로 저장했다. 각 파일은 앞 파일에 이어서 바꿨고, 바꾼 항목 말고는 기반과 같은 값으로 되돌렸다.

| 파일 | 대화상자 | HWP 속성 | HWPX `hp:tbl` |
| --- | --- | --- | --- |
| `base-2x2` | 쪽 경계에서 **나눔**, 제목 줄 자동 반복 켬 | `0x00000006`(bit 0~1 = 2, bit 2) | `pageBreak="CELL" repeatHeader="1"` |
| `page-cell` | **셀 단위로 나눔** | `0x00000005`(bit 0~1 = 1, bit 2) | `pageBreak="TABLE"` |
| `page-none` | **나누지 않음** | `0x00000004`(bit 0~1 = 0, bit 2) | `pageBreak="NONE"` |
| `no-repeat` | 나눔, 제목 줄 자동 반복 끔 | `0x00000002` | `pageBreak="CELL" repeatHeader="0"` |
| `split-border` | 나눔, 반복 켬, "자동으로 나뉜 표의 경계선 설정" 켬 | `0x00000006` | `borderFillIDRef` 3 → 4. 속성은 그대로 |

- HWPX의 `pageBreak` 이름은 대화상자와 엇갈린다. 대화상자의 "나눔"이 `CELL`(셀 안의 텍스트도 나뉨), "셀 단위로 나눔"이 `TABLE`(표는 나뉘지만 셀은 나뉘지 않음)이다. 괄호는 KS X 6101 표 194의 설명이다.
- 자동으로 나뉜 표의 경계선은 속성 비트가 아니라 표의 테두리/배경 참조를 바꿨다.

## 표를 고친 뒤의 값 (HWP만)

`split-border` 상태에서 이어서 고쳐 저장했다.

| 파일 | 바꾼 것 | TABLE 속성 | 셀 LIST_HEADER 속성 |
| --- | --- | --- | --- |
| `edit-1-text` | 첫 셀에 `a` 입력 | `0x04000006`(**bit 26** 켜짐) | 모두 `0x00000020` |
| `edit-2-aschar` | 기본 탭 "글자처럼 취급" 켬(개체 공통 속성 bit 0 = 1 확인) | `0x04000006`(변화 없음) | 그대로 |
| `edit-3-height` | 첫 셀 블록(F5) 후 Ctrl+↓ 3번으로 첫 줄 높이 늘림 | `0x04000006`(변화 없음) | 첫 줄 두 셀에 bit 24, 첫 셀에 bit 26 (`0x05000020`, `0x01000020`) |
| `create-width-modes` | 문서 끝에 "표 만들기" 너비 "단에 맞춤"으로 두 번째 표 추가 | 둘째 표 `0x00000006` | 둘째 표 모두 `0x00000020` |

"문단에 맞춤"으로 세 번째 표를 만들려다 커서가 둘째 표 셀 안에 있어 취소했다(셀 안에 넣은 문단은 되돌렸다).

## 비트를 하나씩 켠 파일

`bits/bit<n>.hwp`는 `base-2x2.hwp`의 TABLE 속성 `0x00000006`에 bit n만 더 켠 파일이다(`patch-table-props.ts`). 한글로 열어 아무것도 바꾸지 않고 HWP와 HWPX로 다시 저장한 결과가 `bits/resaved/`에 있다.

| 켠 비트 | 다시 저장한 HWP | 다시 저장한 HWPX |
| --- | --- | --- |
| 3 | `0x0000000e`(유지) | `noAdjust="1"`(기반은 0) |
| 24 | `0x00000006`(**지워짐**) | 기반과 같음 |
| 25 | `0x02000006`(유지) | 기반과 같음 |
| 26 | `0x04000006`(유지) | 기반과 같음 |

## 결론

- bit 0~1: 0 나누지 않음(`NONE`), 1 셀 단위로 나눔(`TABLE`), 2 나눔(`CELL`). 명세의 "2 = 나누지 않음"은 틀렸다. 한글이 새 표에 쓰는 기본값은 2다.
- bit 2: 제목 줄 자동 반복(`repeatHeader`). 명세대로다.
- bit 3: HWPX `noAdjust`. KS X 6101 표 194는 "셀 너비/높이 값의 최소 단위(1 pt) 보정 여부"로 설명한다. 한글은 다시 저장할 때 보존한다. 이 값을 켜는 대화상자 항목은 찾지 못했다. 저장소 HWP에서 bit 3이 켜진 표 167개는 모두 글자처럼 취급이었고 줄 높이가 서로 달랐다.
- bit 24: 한글이 열었다 저장하면 지운다. 저장된 상태로만 남는 일시적인 값으로 보인다. 한글 자동화로 만든 표(`list-header-properties/base-2cell.hwp`, `cell-props.hwp`)에 켜져 있었다.
- bit 25: 한글은 보존하지만 HWPX에 대응 속성이 없다. 저장소에서는 글자처럼 취급한 표에 주로 켜져 있었다(148개 중 146개). 켜는 조작은 찾지 못했다.
- bit 26: 셀에 글자를 입력하자 켜졌고, 한글은 보존하지만 HWPX에 대응 속성이 없다. 저장소에서 bit 26이 꺼진 표 142개 중 병합, 셀 크기 차이, 글자처럼 취급이 있는 표는 1개뿐이었다. 손대지 않은 표에만 꺼져 있는 "고친 적 있음" 표시로 보이지만 확인하지 않았다.
- 글자처럼 취급, 줄 높이 바꾸기, "단에 맞춤" 너비, 자동으로 나뉜 표의 경계선은 이 비트들을 바꾸지 않았다.

**확인하지 않은 것**

- bit 3을 켜는 한글 조작과 `noAdjust`의 실제 동작(1 pt 보정이 한글에서 어떻게 나타나는지).
- bit 25를 켜는 조작.
- bit 24, 25, 26이 화면이나 편집 동작에 주는 영향. HWPX로 저장하면 bit 25, 26은 사라지는데, 그 HWPX를 다시 HWP로 저장했을 때의 값.
- 셀 LIST_HEADER bit 24, 26(`edit-3-height`)과 표 bit 24, 26의 관계.

## 재현

```sh
# 파일마다 TABLE 속성과 셀 LIST_HEADER 속성 출력
npx tsx docs/experiments/scripts/dump-table-props.ts docs/experiments/table-property-bits/*.hwp
# HWPX hp:tbl 속성
unzip -p docs/experiments/table-property-bits/page-cell.hwpx Contents/section0.xml | grep -o '<hp:tbl [^>]*>'
# 비트를 하나씩 켠 파일과 한글 자동화로 다시 저장(한글 2024와 pywin32 필요)
for b in 3 24 25 26; do npx tsx docs/experiments/scripts/patch-table-props.ts docs/experiments/table-property-bits/base-2x2.hwp docs/experiments/table-property-bits/bits/bit$b.hwp 0 $(( 0x6 | (1 << b) )); done
py -I docs/experiments/scripts/resave-hwp.py docs/experiments/table-property-bits/bits/resaved docs/experiments/table-property-bits/bits/bit*.hwp
# 저장소 표의 비트 교차표
npx tsx scratch/scan-table-bits-corr.ts <HWP 경로 목록 파일>
```

대화상자로 만든 파일은 한글에서 직접 저장했다. 처음 저장할 때 파일 이름이 이어 붙어 `basebase.hwp`, `basebasepage-cell.hwp`, `basebasepage-cellpage-cell.hwpx`, `base.hwp.hwpx`로 저장됐고, 각각 `base-2x2.hwp`, `page-cell.hwp`, `page-cell.hwpx`, `base-2x2.hwpx`로 이름을 바꿨다. `bits/`는 이름을 바꾸기 전의 `basebase.hwp`로 만들었다(같은 파일).
