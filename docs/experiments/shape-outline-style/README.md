# 그리기 개체 테두리 선의 Outline style(표 88)

명세 표 88은 SHAPE_COMPONENT 테두리 선 정보의 마지막 바이트(Outline style)를 0 normal, 1 outer, 2 inner로 적었다. 한글 2024의 개체 속성 대화상자 "선" 탭에는 이 값을 고르는 곳이 "기타 › 선 굵기 내부 적용" 체크박스 하나뿐이다. 그래서 체크박스가 어느 값을 쓰는지, 그리고 대화상자로 만들 수 없는 1과 범위 밖의 3을 한글이 어떻게 다루는지 확인했다.

- 날짜: 2026-11-24
- 환경: Windows용 한글 2024(파일 버전 5.1.2.0). 사각형 그리기, 대화상자, 저장은 computer use로 직접 조작했다.
- 바꾼 곳: `BodyText/Section0` SHAPE_COMPONENT 오프셋 208(ID 8 + 개체 요소 속성 42 + Rendering 정보 146 + 테두리 선 12). 테두리 선 정보 13바이트의 마지막 바이트다(정정 89).

## 대화상자의 체크박스

새 문서에 기본 사각형을 그리고 HWPX로 저장한 뒤(`base.hwpx`), 체크박스를 켜고 HWPX와 HWP로(`inner.hwpx`, `inner.hwp`), 다시 끄고 HWP로(`unchecked.hwp`) 저장했다.

| 파일 | 체크박스 | HWP Outline style | HWPX `hp:lineShape` |
| --- | --- | --- | --- |
| `base.hwpx` | 대화상자 열기 전 | — | `outlineStyle="NORMAL"`, `headSz`·`tailSz="MEDIUM_MEDIUM"` |
| `inner.hwp`, `inner.hwpx` | 켬 | 2 | `outlineStyle="INNER"`, `headSz`·`tailSz="SMALL_SMALL"` |
| `unchecked.hwp` | 끔 | 0 | — |

- 체크박스는 0과 2만 쓴다. 대화상자로는 1(outer)을 만들 수 없다.
- 대화상자에서 "설정"을 누르면 비활성인 화살표 크기가 중간-중간(4)에서 작은-작은(0)으로 바뀌었다(속성 `0xd1000041` → `0xc0000041`). 사각형에는 화살표가 없어 화면은 같다.

## 대화상자가 만들지 않는 값

`unchecked.hwp`의 Outline style만 1, 3으로 바꾼 파일(`outline-1-patched.hwp`, `outline-3-patched.hwp`, `patch-outline.mjs`)을 한글로 열었다.

| 파일 | 한글에서 | 다시 저장한 HWP | HWPX |
| --- | --- | --- | --- |
| `outline-1-resaved` | 오류 없이 열림. 체크박스는 꺼진 상태로 보임 | 1 유지 | `outlineStyle="OUTER"` |
| `outline-1-dialog-ok.hwp` | 위 파일에서 대화상자를 열고 아무것도 바꾸지 않고 "설정" | 0 | — |
| `outline-3-resaved` | 오류 없이 열림 | 3 유지 | `outlineStyle` 속성 없음 |

- 1은 한글이 아는 값이다. HWPX의 `OUTER`로 내보내고 HWP에서도 보존한다. 다만 대화상자는 1을 체크박스 꺼짐으로 보이고, "설정"을 누르면 0으로 바꾼다.
- 3은 HWP에서는 보존하지만 HWPX에는 대응 값이 없어 속성을 빼고 저장한다.
- 굵기 0.12mm에서는 세 값의 화면 차이를 눈으로 구분하지 못했다.

## 확인하지 않은 것

- 굵은 선에서 outer와 inner가 실제로 선을 도형 바깥·안쪽으로 그리는지.
- HWPX에 `OUTER`를 넣은 파일에서 한글 대화상자가 어떻게 보이는지.
