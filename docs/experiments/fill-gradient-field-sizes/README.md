# 그러데이션 필드 크기: 명세 INT16 vs 실제 배치

명세 표 28은 그러데이션의 유형, 기울임, 가로·세로 중심, 번짐 정도, 색 수를 모두 INT16으로 적는다. hwplib·rhwp는 유형 1바이트와 나머지 4바이트로 읽는다. 어느 쪽이 맞는지 같은 값을 두 배치로 넣어 비교했다.

- 날짜: 2026-10-30
- 환경: macOS용 한컴오피스 한글 12.30.0(6544)
- 기반: `base-orange.hwp`(1×1 표, 셀 배경 주황 `#E9AE2B` 단색). 원본 `fill.hwp`를 이 라이브러리로 다시 묶은 사본이고 `control.hwp`와 같은 파일이다. 레코드와 스트림 내용은 원본과 같다.
- 바꾼 곳: DocInfo 네 번째 BorderFill의 채우기 부분만. 나머지 레코드와 스트림은 기반과 같다.
- 넣은 값: 선형(1), 기울임 0, 가로·세로 중심 50, 번짐 정도 0, 빨강→파랑

## 파일

| 파일 | 채우기 부분 | 결과 |
| --- | --- | --- |
| `control.hwp` | 기반 그대로 다시 묶음 | 주황 정상. 다시 묶는 과정 자체는 문제없음 |
| `gradient-1byte-4byte.hwp` | 유형 1B + 나머지 4B | 속성 창 값이 넣은 그대로(빨강, 파랑, 50, 50, 0, 0, 번짐 중심 50) |
| `gradient-int16-spec.hwp` | 명세대로 INT16 × 6 | 속성 창 값이 엉뚱함(검정, 검정, 100, 0, 기울임 359) |

두 그러데이션 파일 모두 셀이 칠해지지 않았다. 원인은 번짐 정도 0이다(`../fill-gradient-step-zero`).

## 결론

유형 1바이트에 나머지 4바이트가 맞다. 이후 한글에서 직접 그러데이션을 지정해 저장한 파일도 같은 배치였다.

## 재현

저장소 루트에서 실행한다.

```bash
node docs/experiments/scripts/make-fill-variants.mjs "$PWD" docs/experiments/fill-gradient-field-sizes/base-orange.hwp <출력 폴더>
```

생성 이름 `fill-00-control.hwp`, `fill-04-gradient-ref.hwp`, `fill-04-gradient-spec.hwp`가 각각 `control.hwp`, `gradient-1byte-4byte.hwp`, `gradient-int16-spec.hwp`다. 2026-10-30에 이 폴더의 기반 파일로 다시 생성해 지금 파일들과 바이트가 같음을 확인했다.
