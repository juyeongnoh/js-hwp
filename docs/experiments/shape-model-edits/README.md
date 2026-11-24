# 모델에서 고친 그리기 개체를 한글이 받아들이는지

지금까지는 한글 파일을 읽어 그대로 쓰는 것만 검증했다. 여기서는 모델 값을 고치거나 끝 바이트를 지워 코덱 기본값으로 쓴 파일을 Windows용 한글 2024로 열고, 일부는 다시 저장해 한글이 값을 바꾸는지 봤다.

- 날짜: 2026-11-25
- 환경: Windows용 한글 2024(원격 데스크톱, computer use). 파일은 Windows에서 이 저장소를 SMB 공유(`\\<Mac>\juyeongnoh\js-hwp`)로 열었다.
- 만든 방법: `npx tsx docs/experiments/scripts/make-shape-model-edits.ts`. 모든 개체의 `lineTrailing`, `polygonTrailing`, `curveTrailing`을 지워 코덱 기본값(0 2B, 0 4B, 0 4B)으로 쓰게 하고, 아래를 고쳐 `serializeHwp`로 썼다. 다시 읽어 고친 값이 그대로인지 확인한다.

| 파일 | 기반 | 고친 것 |
| --- | --- | --- |
| `line.hwp` | `shape-line/directions.hwp` | 첫 선의 시작점과 끝점을 맞바꿈 |
| `arc-polygon-curve.hwp` | `shape-ellipse-arc-polygon-curve/shapes.hwp`(macOS용 한글) | 호 종류 0 → 2(활), 열린 다각형의 셋째 점 (16443, 10008) → (8000, 12868), 곡선 구간 종류 `1 1 1` → `1 0 1`. 첫 점으로 닫은 다각형의 끝 4바이트 `01 00 00 00`도 기본값 0으로 바뀐다 |
| `textbox-added.hwp` | `shape-ellipse-arc-polygon-curve/polygon-curve-textbox-caption-rotate.hwp` | 글상자가 없던 셋째 개체(다각형)에 첫 개체의 글상자를 복사하고 `textBoxTrailing`을 지움(기본값 0 13B). 개체 요소 속성 bit 24를 켬(정정 101) |

## 결과

- 세 파일 모두 오류 없이 열렸고, 고친 대로 그렸다. 바꾼 선은 같은 자리에 그려졌고, 호는 활 모양, 다각형은 옮긴 점, 곡선은 가운데 구간이 직선이었다. 글상자를 붙인 다각형에는 복사한 글자 "1"이 보였다.
- `arc-polygon-curve`와 `textbox-added`는 글자를 하나 넣었다 지워 한글로 다시 저장했다(`*-hangul-saved.hwp`). 두 파일 모두 그리기 개체의 모델 값(`dump-shapes.ts`)이 저장 전과 같았다. 호 종류 2, 옮긴 점, 구간 종류 0, 끝 바이트 기본값, 글상자 끝 13바이트, bit 24를 한글이 그대로 썼다.
  - `textbox-added`는 `dump-record-tree.ts`로 본 첫 개체 트리도 같았다. `arc-polygon-curve`는 macOS용 한글 파일이 기반이라 한글 2024가 CTRL_HEADER를 2바이트 늘려 썼다(형식 올리기). 고친 값과는 관계없다.
- `line.hwp`는 열기만 했다.

## 확인하지 않은 것

- 처음부터 새로 만든 개체(빌더). 여기서는 한글이 만든 개체의 값만 고쳤다.
- 곡선 구간 종류 0을 한글 UI로 만드는 조작. 파일로 넣은 0은 한글이 직선으로 그리고 저장해도 유지한다.
