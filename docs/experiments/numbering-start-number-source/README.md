# 시작 번호 UINT16과 1수준 시작번호 중 한글이 쓰는 값

문단 번호 레코드에는 1~7수준 반복 뒤의 시작 번호 UINT16과, 그 뒤의 수준별 시작번호 UINT32 7개가 있다. 한글에서 1수준 시작 번호를 바꾸면 두 값이 함께 바뀌었다. 한글이 표시할 때 어느 값을 읽는지 보려고 UINT16만 바꿨다.

- 날짜: 2026-11-12
- 환경: macOS 한글. 앱 버전은 기록하지 않았다. 파일 버전은 5.1.1.0이다.
- 기반 파일: `base-l1-23.hwp`. `numbering-extended-levels/levels-1-9-10.hwp`와 같은 문서에서 1수준 시작 번호를 23으로 바꿔 한글에서 저장했다. 두 번째 문단 번호 레코드의 UINT16과 1수준 UINT32가 모두 23이다.
- 바꾼 곳: 두 번째 문단 번호 레코드의 오프셋 142, UINT16 2바이트.

## 파일

| 파일 | UINT16 | 1수준 UINT32 | 결과 |
| --- | ---: | ---: | --- |
| `base-l1-23.hwp` | 23 | 23 | 기반 |
| `uint16-99.hwp` | 99 | 23 | 1수준 번호가 23으로 표시됨 |

결과는 사용자가 한글에서 열어 확인했다. 본문과 설정 창 중 어디에서 본 값인지는 기록하지 않았다.

## 결론

- 한글은 1수준 번호를 표시할 때 UINT16이 아니라 수준별 시작번호 UINT32를 쓴다.
- UINT16의 뜻은 여전히 모른다. 같은 파일의 기본 번호 레코드는 UINT16이 0, 1수준 UINT32가 1이라 늘 복사본인 것도 아니다.
- 이 파일을 한글에서 다시 저장했을 때 UINT16이 23으로 바뀌는지는 확인하지 않았다.

## 재현

```sh
npx vite-node docs/experiments/scripts/patch-numbering-start.ts docs/experiments/numbering-start-number-source/base-l1-23.hwp docs/experiments/numbering-start-number-source/uint16-99.hwp 1 99
```
