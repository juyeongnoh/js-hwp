# COLORREF 최상위 바이트의 의미

한글이 저장한 파일에는 `FF FF FF FF`, `00 00 00 FF`, `FF FF FF C0`처럼 최상위 바이트가 0이 아닌 색이 있다. `FFFFFFFF`가 "색 없음"인지, 최상위 바이트가 표시에 영향을 주는지 확인했다.

- 날짜: 2026-11-02
- 환경: macOS용 한컴오피스 한글 12.30.0(6544)
- 기반: `base-orange.hwp`
- 바꾼 곳: 쪽 배경을 주황(BorderFill 4번)으로 깔아 흰색과 투명을 구별한다. 표 셋의 칸에 BorderFill 2, 3, 1번을 주고 값을 바꿨다. 표 자체에는 빈 BorderFill 5번을 새로 붙였다. 마지막 문단에 글자 모양 0, 1, 2번을 쓰는 글자를 넣고 음영을 바꿨다.
- 값은 파일의 바이트 순서(R G B 최상위)로 적는다. 결과는 본문에 그려진 모습이다. 속성 창 값은 따로 적는다.

## 파일

| 파일 | 칸 1 배경 | 칸 2 배경 | 칸 3 배경 |
| --- | --- | --- | --- |
| `compare.hwp` | `FF FF FF FF` → 투명 | `FF FF FF 00` → 흰색 | `FF 00 00 FF` → 투명 |
| `control.hwp` | 채우기 없음 → 투명 | `FF 00 00 00` → 빨강 | `FF 00 00 01` → 빨강 |
| `lines.hwp` | `FF 00 00 80` → 투명 | `FF 00 00 FF` → 투명 | 채우기 없음 → 투명 |
| `first-try-table-fill-3.hwp` | 무효. 표의 BorderFill이 3번이라 칸 2의 값이 다른 칸 아래에 비쳤다 | | |

`compare.hwp`의 속성 창은 칸 1 "색 없음", 칸 2 흰색, 칸 3 빨강이다. 본문은 투명, 흰색, 투명이다. 이 파일은 사람이 한글에서 직접 확인했다. 나머지 파일의 속성 창은 보지 않았다.

칸 3 테두리(`compare.hwp`, `lines.hwp`):

| 방향 | 값 | 결과 |
| --- | --- | --- |
| 왼쪽 | `FF FF FF FF` | 흰색 |
| 오른쪽 | `FF FF FF 00` | 흰색 |
| 위쪽 | `FF 00 00 FF` | 빨강 |
| 아래쪽 | `00 00 00 FF` | 검정 |

글자 음영(모든 파일):

| 글자 모양 | 값 | 결과 |
| --- | --- | --- |
| 0 | `FF FF FF FF` | 음영 없음. 속성 창에 "색 없음"으로 표시 |
| 1 | `FF FF FF 00` | 흰색 |
| 2 | `FF 00 00 FF` | 빨강 |

## 결론

**확인됨**: 셀 배경의 `FF FF FF FF`는 색 없음, `FF FF FF 00`은 흰색이다. 속성 창과 본문이 일치한다.

**미확인**: 위 두 값 외의 표 내용은 자동화 도구로 캡처한 화면 한 번을 읽은 기록이고, 사람이 다시 확인하지 않았다. 규칙으로 일반화하지 않는다. 최상위 바이트의 의미는 모른다.

코덱은 해석하지 않고 네 바이트를 그대로 보존한다.

## 재현

```bash
npm run build -w packages/core -w packages/hwp
```

```bash
for v in compare control lines; do node docs/experiments/scripts/make-colorref-variants.mjs "$PWD" docs/experiments/colorref-high-byte/base-orange.hwp docs/experiments/colorref-high-byte/$v.hwp $v; done
```

```bash
node docs/experiments/scripts/make-colorref-variants.mjs "$PWD" docs/experiments/colorref-high-byte/base-orange.hwp docs/experiments/colorref-high-byte/first-try-table-fill-3.hwp first-try
```
