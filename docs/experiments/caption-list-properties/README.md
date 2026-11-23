# 캡션 LIST_HEADER 리스트 속성(표 65)의 비트

셀 LIST_HEADER의 리스트 속성(오프셋 4 UINT32)은 bit 0~2가 글자 방향, bit 3~4가 줄바꿈, bit 5~6이 세로 정렬이고 bit 16~20이 셀 속성이다(`../list-header-properties`, 정정 85). 캡션 LIST_HEADER도 같은 배치인지 확인한다. 같으면 모델의 `Caption`이 `ListProperties`를 확장하고 원본 숫자 `listProperties` 대신 필드로 읽고 쓸 수 있다(BACKLOG "셀이 아닌 LIST_HEADER의 속성 해석").

- 날짜: 2026-11-20. 세로 정렬은 사용자가 한글에서 확인했다(아래 "결과"). 비트를 바꾼 파일을 한글로 다시 저장하는 단계는 아직 하지 않았다.
- 환경: Windows용 한글 2024
- 바꾼 곳: `BodyText/Section0` 첫 LIST_HEADER(캡션)의 오프셋 4(bit 0~15) 또는 6(bit 16~31). 나머지 레코드와 스트림은 기반과 같다(`patch-list-header.ts`가 확인).

## 기반

한글이 저장한 `../object-common-props/table-caption-bottom.hwp`를 `base-table-caption.hwp`로 복사했다. 표(`tbl `)에 캡션 "표 1 측정 결과"가 있고, 캡션 리스트 속성은 `0x00000000`, 캡션 속성은 `0x00000003`(아래)이다.

사각형(`gso `) 캡션도 같은 LIST_HEADER지만 넣지 않았다. 코덱이 `gso `의 자식 레코드를 버려서 저장소 HWP 왕복 테스트가 실패한다(BACKLOG "unknown 컨트롤의 자식 레코드 손실"). 그 문제를 고친 뒤 `../object-common-props/rect-caption-bottom.hwp`로 같은 파일을 만든다.

셀의 기본 리스트 속성은 `0x00000020`(세로 정렬 가운데)인데, 캡션은 0(위)이다.

## 비트를 바꾼 파일

| 파일 | 캡션 리스트 속성 | 셀에서의 뜻 | HWPX(셀) |
| --- | --- | --- | --- |
| `table-textdir-1.hwp` | `0x00000001` | 글자 방향 세로·영문 눕힘 | `textDirection="VERTICAL"` |
| `table-textdir-2.hwp` | `0x00000002` | 글자 방향 세로·영문 세움 | `textDirection="VERTICALALL"` |
| `table-linewrap-1.hwp` | `0x00000008` | 줄바꿈 자간 조정 | `lineWrap="SQUEEZE"` |
| `table-linewrap-2.hwp` | `0x00000010` | 줄바꿈 폭 늘림 | `lineWrap="KEEP"` |
| `table-valign-1.hwp` | `0x00000020` | 세로 정렬 가운데 | `vertAlign="CENTER"` |
| `table-valign-2.hwp` | `0x00000040` | 세로 정렬 아래 | `vertAlign="BOTTOM"` |
| `table-bit16.hwp` ~ `table-bit20.hwp` | bit 16~20 하나씩 | `hasMargin`, `protect`, `header`, `editable`, `dirty` | 같은 이름 속성 |
| `table-bit24.hwp`, `table-bit26.hwp` | bit 24, 26 | 뜻 모름 | 없음 |

## 할 일

1. 모든 파일을 한글로 열어 HWP와 HWPX로 다시 저장한다(`resaved/`). 아래 "재현"의 `resave-hwp.py` 줄이다.
2. `dump-caption-list-props.ts`로 다시 저장한 HWP의 캡션 리스트 속성과 HWPX `hp:caption > hp:subList`의 속성을 뽑아 위 표의 "HWPX(셀)" 열과 대조한다.
3. 손으로: 한글에서 캡션 안에 커서를 두고 글자 방향, 세로 정렬을 바꾸는 메뉴가 있는지 본다. 있으면 바꿔 저장해 같은 비트가 켜지는지 본다. 셀과 달리 대화상자가 없을 수 있다.
4. 손으로(선택): `table-textdir-*.hwp`, `table-valign-*.hwp`를 열어 캡션이 그렇게 그려지는지 본다. 아래 캡션은 높이가 문단에 맞춰지므로 세로 정렬은 왼쪽·오른쪽 캡션이어야 차이가 보일 수 있다.

## 결과

### 한글에서 캡션 방향을 바꿔 저장 (사용자, 2026-11-20)

사용자가 한글 2024에서 표를 만들고 캡션을 넣은 뒤 캡션 방향을 바꿔 가며 저장하고, 앞 파일과 바이트를 비교했다. 마지막 상태만 `table-caption-right-bottom.hwp`로 남겼다(리스트 속성 `0x48`, 캡션 속성 1).

| 바꾼 것 | 리스트 속성(오프셋 4) | 다른 변화 |
| --- | --- | --- |
| 아래 → 오른쪽 가운데 | `0x08` → `0x28` (세로 정렬 0 → 1) | 캡션 속성 3 → 1, 텍스트 최대 길이 41954 → 8504, 캡션 줄 폭 41952 → 8504, 표 다음 본문 줄 세로 위치 2948 → 1848 |
| 오른쪽 가운데 → 오른쪽 아래 | `0x28` → `0x48` (세로 정렬 1 → 2) | 없음 |

- **캡션 대화상자의 가운데·아래는 리스트 속성 bit 5~6의 세로 정렬이다.** 값(0 위, 1 가운데, 2 아래)은 셀과 같다. 명세 표 71이 캡션 리스트를 문단 리스트 헤더(표 65)로 시작한다고 적은 것과 맞는다(정정 86, E34).
- 이 캡션은 처음부터 bit 3(줄바꿈 1)이 켜져 있었다. `base-table-caption.hwp`의 캡션은 0이었다. 켜지는 조건은 모른다.
- 비트를 바꾼 파일을 한글로 다시 저장하는 대조(할 일 1~2)는 아직 하지 않았다. 코덱은 이 결과와 명세 표 71을 근거로 캡션의 bit 0~6을 `ParagraphList` 필드로 읽고 쓴다.

## 재현

저장소 루트에서 실행한다. 다시 저장하려면 한글 2024, pywin32, 자동화 보안 모듈 등록이 필요하다.

```bash
D=docs/experiments/caption-list-properties
P="npx vite-node docs/experiments/scripts/patch-list-header.ts"
cp docs/experiments/object-common-props/table-caption-bottom.hwp $D/base-table-caption.hwp
B=$D/base-table-caption.hwp
$P $B $D/table-textdir-1.hwp 0 4 1
$P $B $D/table-textdir-2.hwp 0 4 2
$P $B $D/table-linewrap-1.hwp 0 4 8
$P $B $D/table-linewrap-2.hwp 0 4 16
$P $B $D/table-valign-1.hwp 0 4 32
$P $B $D/table-valign-2.hwp 0 4 64
# 비트 n(16~31)을 켠 파일: 오프셋 6의 UINT16에 1 << (n - 16)
for n in 16 17 18 19 20 24 26; do $P $D/base-table-caption.hwp $D/table-bit$n.hwp 0 6 $((1 << (n - 16))); done
python -I docs/experiments/scripts/resave-hwp.py $D/resaved $D/base-*.hwp $D/table-textdir-*.hwp $D/table-linewrap-*.hwp $D/table-valign-*.hwp $D/table-bit*.hwp
npx vite-node docs/experiments/scripts/dump-caption-list-props.ts $D/*.hwp $D/resaved/*.hwp $D/resaved/*.hwpx
```
