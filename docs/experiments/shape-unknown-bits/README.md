# 그리기 개체의 뜻을 모르는 값과 변환 행렬

개체 요소 속성 bit 19·25·26·29, 타원 속성 bit 0·16과 start2·end2, 다각형·곡선 끝 4바이트, 회전 중심·translation·scale을 확인했다. 결과는 정오표 E52에 정리했다.

- 날짜: 2026-11-25
- 환경: Windows용 한글 2024(원격 데스크톱, computer use). 파일은 SMB 공유로 저장소를 바로 열고 저장했다.
- 값을 바꾼 파일: `npx tsx docs/experiments/scripts/make-shape-unknown-bits.ts`. 그림은 모델로 읽지 않아 SHAPE_COMPONENT 오프셋 36을 원시 레코드에서 고쳤다.
- 비트 분포: `scripts/scan-shape-bits.ts`. 변환 행렬: `scripts/check-shape-rotation.ts`, `scripts/check-shape-transform.ts`.
- `*-hangul-saved.hwp`는 그 파일을 한글로 열어 글자를 넣었다 지우고(또는 아래 조작을 하고) 저장한 것이다.

## 파일

| 파일 | 기반 | 바꾼 것 | 한글 저장본에서 |
| --- | --- | --- | --- |
| `rect-bits` | `shape-rectangle/rotate-flip` | 사각형 2 bit 19 끔, 3 bit 26 켬, 4 bit 29 켬 | bit 26만 꺼짐 |
| `pic-bit19-off`, `-bit26-off`, `-bit29-off` | `object-overlap-lock/picture-page-nooverlap` | 그림 bit 하나 끔 | bit 26만 다시 켜짐 |
| `pic-original.hwpx`, `pic-bit19-off.hwpx`, `pic-bit29-off.hwpx` | 위 | HWPX로 저장 | bit 19만 `rotateimage`로 달라짐 |
| `pic-original-rotated30-hangul-saved`, `pic-bit19-off-rotated30-hangul-saved` | 위 | 한글에서 회전각 30° | 둘 다 bit 25 켜짐 |
| `gradient-bit19-on`, `-off` | `shape-fill/gradient` | bit 19 그대로 / 끔 | 한글에서 45° 회전. 그림 같음 |
| `ellipse-interval` | `shape-ellipse-arc-polygon-curve/ellipse-edit-angles` | 호 1 start2 아래 끝, 호 2 start2 왼쪽 끝 + bit 0, 호 3 bit 16 끔 | start2 다시 계산, bit 0 꺼짐 |
| `polygon-tail` | `shape-ellipse-arc-polygon-curve/polygon-curve-drawn` | 모두 색 채우기, P1·C1 끝 4바이트 1 | 그대로 |
| `resize-rotate` | 한글에서 새로 그림 | 100×50mm / 70×30mm 뒤 30° / 30° 뒤 90×40mm | — |

## 확인하지 않은 것

- bit 19(`rotateimage`)가 그림에 영향을 주는 경우. 단색 그림과 그러데이션 채우기에서는 차이가 없었다. 무늬가 있는 그림 채우기나 그림 개체로 다시 볼 수 있다.
- bit 29의 뜻. 다각형·곡선 끝 4바이트의 뜻.
- 묶음 안 개체(scaleRotations가 둘 이상)의 변환 행렬. 저장소에 묶음이 없다.
