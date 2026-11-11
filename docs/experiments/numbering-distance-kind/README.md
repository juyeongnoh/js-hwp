# 본문과의 거리 종류(bit 4)와 단위

명세 표 40의 bit 4는 "수준별 본문과의 거리 종류"이고 0은 글자 크기에 대한 상대 비율, 1은 "값"이다. 값의 단위가 무엇인지 확인했다.

- 날짜: 2026-11-12
- 환경: macOS용 한컴오피스 한글 12.30.0(6544)
- 기반: `base-right-20mm.hwp`. 두 번째 문단 번호(`numbering[1]`) 1수준이 甲乙丙(16), 정렬 오른쪽, 번호 너비를 자릿수에 맞춤 끔, 자동으로 내어쓰기 끔, 너비 조정 20 mm(5669), 본문과의 간격 70 %, 글자 모양 아이디 7이다(속성 `0x202`). 한글이 저장한 원본은 이후 같은 파일에 다시 저장하면서 남지 않았다. `../numbering-format-high-bits/bit-10.hwp`에서 bit 10을 되돌려 복원했으므로 cfb 라이브러리가 다시 쓴 컨테이너이고 `Sh33tJ5` 스트림이 더해져 있다. 레코드와 다른 스트림 내용은 한글 저장본과 같다.
- 바꾼 곳: `numbering[1]` 1수준 문단 머리 정보 속성의 bit 4

## 파일

| 파일 | bit 4 | 본문과의 거리 | 설정 창 "본문과의 간격" |
| --- | --- | --- | --- |
| `base-right-20mm.hwp` | 0 | 70 | 70 % |
| `distance-kind-1.hwp` | 1 | 70 | 0.7 pt |
| `saved-distance-10mm.hwp` | 1 | 2834 | 한글에서 10 mm로 설정해 저장. 다시 열면 28.3 pt |

`saved-distance-10mm.hwp`는 한글이 직접 저장한 파일이다. 속성이 `0x202`에서 `0x212`로 바뀌어, 길이 단위를 고르면 한글이 bit 4를 켠다는 것을 보여 준다.

## 결론

- bit 4가 1이면 본문과의 거리는 HWPUNIT이다. 70 = 0.7 pt, 2834 = 10 mm = 28.3 pt.
- 설정 창에서 고른 단위(mm, pt 등)는 저장되지 않는다. 다시 열면 pt로 보인다.
- 너비 조정(너비 보정값)도 HWPUNIT이다. 기반의 5669는 20 mm다. 단위가 저장되지 않는 것도 같다.

## 재현

```bash
npx tsx docs/experiments/scripts/patch-numbering-head.ts docs/experiments/numbering-distance-kind/base-right-20mm.hwp <출력 폴더>/distance-kind-1.hwp 1 0 4 4 1
```

2026-11-12에 이 폴더의 기반 파일로 다시 생성해 처음 만든 파일과 바이트가 같음을 확인했다. `saved-distance-10mm.hwp`는 한글에서 저장한 것이라 재현 명령이 없다.
