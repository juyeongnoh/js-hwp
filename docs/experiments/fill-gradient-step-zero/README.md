# 그러데이션 번짐 정도 0은 그려지지 않는다

`../fill-gradient-field-sizes`의 그러데이션 파일이 속성 창 값은 정상인데 셀에 칠해지지 않았다. 넣은 값 중 번짐 정도가 0이었으므로 그 값만 바꿔 비교했다.

- 날짜: 2026-10-30
- 환경: macOS용 한컴오피스 한글 12.30.0(6544)
- 기반: `base-orange.hwp`(1×1 표, 셀 배경 주황 `#E9AE2B` 단색). 원본 `fill.hwp`를 이 라이브러리로 다시 묶은 사본이고 `../fill-gradient-field-sizes/control.hwp`와 같은 파일이다. 레코드와 스트림 내용은 원본과 같다.
- 바꾼 곳: 네 번째 BorderFill의 채우기 부분. 그러데이션 배치는 유형 1B + 나머지 4B
- 고정 값: 선형(1), 기울임 0, 가로·세로 중심 50, 빨강→파랑, 번짐 중심 50

## 파일

| 파일           | 번짐 정도 | 결과                              |
| -------------- | --------- | --------------------------------- |
| `step-0.hwp`   | 0         | 칠해지지 않음 (속성 창 값은 정상) |
| `step-50.hwp`  | 50        | 그러데이션 표시                   |
| `step-255.hwp` | 255       | 그러데이션 표시                   |

## 결론

- 번짐 정도 0이면 그리지 않는다.
- 명세는 범위를 0–100으로 적지만 255도 그린다. 한글이 직접 저장한 그러데이션 파일에도 255가 들어 있었다.

## 재현

저장소 루트에서 실행한다.

```bash
node docs/experiments/scripts/make-fill-variants.mjs "$PWD" docs/experiments/fill-gradient-step-zero/base-orange.hwp <출력 폴더>
```

생성 이름 `fill-04-gradient-ref.hwp`, `fill-04-gradient-ref-step50.hwp`, `fill-04-gradient-ref-step255.hwp`가 각각 `step-0.hwp`, `step-50.hwp`, `step-255.hwp`다. `step-0.hwp`는 `../fill-gradient-field-sizes/gradient-1byte-4byte.hwp`와 같은 파일이다. 2026-10-30에 이 폴더의 기반 파일로 다시 생성해 지금 파일들과 바이트가 같음을 확인했다.
