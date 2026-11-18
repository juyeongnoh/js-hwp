# LIST_HEADER 문단 수가 INT16인지 INT32인지

명세 표 65(문단 리스트 헤더)는 문단 수 INT16, 속성 UINT32, 전체 6바이트라고 적었다. 하지만 저장소 HWP 파일의 LIST_HEADER 8천여 개는 모두 바이트 2–3이 0이었고, 속성의 의미 있는 비트(세로 정렬 등)는 바이트 4부터 읽어야 나왔다. 바이트 2–3이 "의미 없는 2바이트"인지 "문단 수 INT32의 위쪽 절반"인지 가리려고 두 실험을 했다.

- 날짜: 2026-11-19
- 환경: Windows용 한글 2024. 앱 버전은 기록하지 않았다.
- 기반: `base-table-2x2.hwp`. 한글 새 문서에 2×2 표를 넣고 셀에 `가`, `나`, `다`, `라`를 입력해 저장했다. 셀마다 문단 1개다.

## 실험 1: 바이트를 바꿔 한글에서 열기

첫 셀 LIST_HEADER(앞 8바이트 `01000000 20000000`)의 UINT16 하나만 바꿨다. 판단 근거는 한글 편집 화면에 그려진 표다.

| 파일 | 바꾼 값 | 앞 8바이트 | 한글에서 연 결과 |
| --- | --- | --- | --- |
| `cell1-count-2.hwp` | 오프셋 0 = 2 (문단 수를 실제보다 크게) | `02000000 20000000` | 정상. 네 셀 모두 원래 글자 |
| `cell1-count-0.hwp` | 오프셋 0 = 0 | `00000000 20000000` | 정상. 위와 같다 |
| `cell1-bytes2-1.hwp` | 오프셋 2 = 1 (INT32라면 65537) | `01000100 20000000` | 정상. 위와 같다 |
| `cell1-bytes2-ffff.hwp` | 오프셋 2 = 0xFFFF | `0100ffff 20000000` | 정상. 위와 같다 |

한글은 읽을 때 LIST_HEADER의 문단 수를 쓰지 않는 것으로 보인다. 문단 수를 0이나 2로 바꿔도 셀 내용이 그대로였다. 그래서 이 실험으로는 INT16과 INT32를 가릴 수 없다.

## 실험 2: 문단이 65,536개를 넘는 셀을 한글로 저장

`base-table-2x2.hwp`를 열어 첫 셀 `가` 뒤에서 Enter를 치고, `x` 70,000줄(CRLF로 이음)을 붙여 넣은 뒤 `cell-70001-paras.hwp`로 저장했다. 한글 상태 표시줄은 1,751쪽, 70,004글자였다.

| 파일 | 첫 셀 LIST_HEADER 앞 8바이트 | 첫 셀 문단 레코드 수 |
| --- | --- | --- |
| `cell-70001-paras.hwp` | `71110100 20000000` | 70,001 |

`71 11 01 00`은 0x00011171 = 70,001이다.

## 결론

- **LIST_HEADER의 문단 수는 INT32(4바이트)다.** 명세 표 65의 INT16은 틀렸다. 바이트 2–3은 문단 수의 위쪽 절반이다.
- **속성(UINT32)은 오프셋 4에 있다.** 그래서 문단 리스트 헤더는 6바이트가 아니라 8바이트다.
- 한글은 읽을 때 이 문단 수를 쓰지 않는 것으로 보인다(실험 1).
- 코덱은 문단 수를 UINT16으로 읽고 속성을 오프셋 2부터 읽었다. 이 파일을 읽으면 첫 셀 문단이 70,001개가 아니라 4,465개(0x1171)만 남았다. 2026-11-19에 공용 함수(`readListHeader`, `writeListHeader`)로 고쳤다. 문단은 한글처럼 문단 수가 아니라 레코드 구조로 나눈다(`packages/hwp/test/list-header.test.ts`).

**확인하지 않은 것**

- 셀이 아닌 LIST_HEADER(캡션, 글상자, 각주, 머리말 등)에서 65,536개를 넘긴 경우. 같은 구조로 보지만 직접 저장해 보지는 않았다.
- 한글이 문단 수를 쓰지 않는다면 무엇으로 문단을 나누는지(레코드 레벨로 보임).

## 재현

실험 1 파일은 저장소 루트에서 아래 명령으로 만든다. 출력 이름은 지금 이름과 같다.

```bash
D=docs/experiments/list-header-para-count
P="npx tsx docs/experiments/scripts/patch-list-header.ts"
$P $D/base-table-2x2.hwp $D/cell1-bytes2-1.hwp 0 2 1
$P $D/base-table-2x2.hwp $D/cell1-bytes2-ffff.hwp 0 2 65535
$P $D/base-table-2x2.hwp $D/cell1-count-2.hwp 0 0 2
$P $D/base-table-2x2.hwp $D/cell1-count-0.hwp 0 0 0
```

2026-11-19: 모든 명령이 "Section0 레코드 일치, 다른 스트림 일치"를 출력했다.

실험 2 파일은 한글에서 손으로 만들었다. LIST_HEADER는 아래 명령으로 볼 수 있다.

```bash
npx tsx docs/experiments/scripts/dump-record-tree.ts docs/experiments/list-header-para-count/cell-70001-paras.hwp "tbl " 1
```
