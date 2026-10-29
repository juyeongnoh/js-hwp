# 채우기 종류가 여러 개 켜졌을 때의 우선순위

채우기 종류는 비트 플래그(단색 0x1, 이미지 0x2, 그러데이션 0x4)라 여러 개를 동시에 켤 수 있다. 한글 UI와 저장은 하나만 쓰지만, 여러 개가 켜진 파일을 열 때 무엇을 쓰는지 확인했다.

- 날짜: 2026-10-30
- 환경: macOS용 한컴오피스 한글 12.30.0(6544)
- 기반: `base-image.hwp`(이미지 채우기, `BinData` 포함). `../fill-trailing-unknown-byte/base-image.hwp`와 같은 파일이다. 채우기 부분 전체를 새로 구성하므로 처음에 쓴 `byte-128.hwp`를 기반으로 해도 결과가 같다.
- 바꾼 곳: 네 번째 BorderFill의 채우기 부분 전체를 종류별로 새로 구성
- 블록 값
  - 단색: 주황 `#E9AE2B`, 무늬 없음
  - 그러데이션: 선형, 빨강→파랑, 번짐 정도 50, 번짐 중심 50
  - 이미지: 기반 파일의 블록 그대로
- 블록 순서는 단색, 그러데이션, 이미지. 끝의 알 수 없는 바이트는 켜진 종류마다 하나씩(rhwp 기준) `00`

## 파일

파일 이름 앞의 숫자가 채우기 종류 값이다.

| 파일                                   | 종류 | 결과                                                                                                            |
| -------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| `1-color.hwp`                          | 1    | 대조군                                                                                                          |
| `2-image.hwp`                          | 2    | 대조군                                                                                                          |
| `4-gradient.hwp`                       | 4    | 대조군                                                                                                          |
| `3-color-image.hwp`                    | 3    | 이미지                                                                                                          |
| `5-color-gradient.hwp`                 | 5    | 그러데이션                                                                                                      |
| `6-gradient-image.hwp`                 | 6    | 이미지                                                                                                          |
| `7-all.hwp`                            | 7    | 이미지                                                                                                          |
| `first-try-5-color-gradient-step0.hwp` | 5    | 첫 시도. 속성 창은 그러데이션이었지만 번짐 정도 0이라 그리기 결과는 판단 불가. 기반은 `base-orange.hwp` |

결과가 본문에 그려진 모습인지 속성 창 값인지는 구분해 기록하지 않았다.

## 결론

- 여러 종류가 켜진 파일도 오류 없이 연다.
- **이미지 > 그러데이션 > 단색** 순으로 하나를 쓴다.
- 일곱 파일 모두 정상으로 열렸으므로, 블록 순서(단색, 그러데이션, 이미지)와 꼬리 배치도 한글이 읽는 방식과 맞다.

파서는 이 순서대로 하나만 남긴다(`packages/hwp/src/docinfo.ts`의 `readFill`).

## 재현

저장소 루트에서 실행한다.

```bash
node docs/experiments/scripts/make-combo-variants.mjs "$PWD" docs/experiments/fill-multi-kind-priority/base-image.hwp <출력 폴더>
node docs/experiments/scripts/make-fill-variants.mjs "$PWD" docs/experiments/fill-multi-kind-priority/base-orange.hwp <출력 폴더>
```

첫 명령의 `combo-<종류>-<이름>.hwp`에서 `combo-`를 뺀 것이 1~7번 파일이고, 둘째 명령의 `fill-05-color-gradient.hwp`가 첫 시도 파일이다. 2026-10-30에 이 폴더의 기반 파일로 다시 생성해 지금 파일들과 바이트가 같음을 확인했다.
