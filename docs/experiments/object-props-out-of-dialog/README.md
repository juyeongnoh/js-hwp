# 대화상자가 만들지 않는 개체 공통 속성 값을 한글에서 열기

개체 공통 속성(표 69, 70)에는 한글 대화상자로 만들 수 없는 값이 있다. 줄 간격에 영향(bit 2), 세로 정렬 3·4, 본문과의 배치 4·5, 세로 기준 3, 뜻을 모르는 bit 1·29·31이 그렇다. 코덱이 이런 값을 읽거나 쓸 때 한글이 어떻게 받아들이는지 알려고, 한글이 저장한 기반 파일에서 비트만 바꿔 한글에서 열었다.

- 날짜: 2026-11-19
- 환경: Windows용 한글 2024. 앱 버전은 기록하지 않았다.
- 기반 파일 (둘 다 한글에서 만들어 저장했다)
  - `base-inline-rect.hwp`: 첫 문단에 글자처럼 취급한 사각형이 있고 뒤에 `가나다 줄 간격 시험`이 온다. 그 아래 두 문단이 있다. 문단 줄 간격은 기본(160%)이다.
  - `base-float-rect.hwp`: 위 문서에 긴 문단을 더하고, 사각형을 떠 있게 바꿨다. 사각형 설정은 어울림, 본문 위치 양쪽, 가로·세로 종이 60mm, 위·왼쪽 정렬이다.
- 바꾼 곳: 첫 `gso ` CTRL_HEADER의 속성(오프셋 4)에서 표의 비트만 바꿨다. 스크립트가 그 레코드 말고는 레코드와 스트림이 기반과 같음을 확인했다.

## 파일

판단 근거는 한글 편집 화면(쪽 윤곽)에 그려진 모습과, 개체 속성 대화상자의 기본 탭이다.

| 파일 | 바꾼 값 | 한글에서 연 결과 |
| --- | --- | --- |
| `inline-bit2-on.hwp` | bit 2 = 1 (기반 `base-inline-rect`) | 연다. 사각형이 있는 줄 아래가 크게 벌어져 둘째 줄이 내려간다. 기반에서는 사각형 바로 아래에 둘째 줄이 붙는다 |
| `float-valign-2.hwp` | 세로 정렬 = 2 (대조군) | 사각형이 쪽 아래쪽으로 간다(아래 정렬) |
| `float-valign-3.hwp` | 세로 정렬 = 3 | 연다. 기반(위 정렬)과 같은 자리에 그린다. 대화상자의 세로 정렬 칸이 비어 있고, 목록에는 위·가운데·아래만 있다 |
| `float-valign-4.hwp` | 세로 정렬 = 4 | 연다. 아래 정렬(2)과 같은 자리에 그린다 |
| `float-wrap-4.hwp` | 본문과의 배치 = 4 | 연다. 본문이 사각형을 피하지 않고 아래로 지나간다(글 앞으로·글 뒤로와 비슷하다). 사각형에 채우기가 없어 앞뒤는 구분하지 못했다 |
| `float-wrap-5.hwp` | 본문과의 배치 = 5 | 4와 같다. 대화상자에서 배치 아이콘이 하나도 선택되지 않는다 |
| `float-vrel-3.hwp` | 세로 기준 = 3 | 연다. 사각형이 앵커 문단에서 60mm 아래에 놓인다(문단 기준과 같은 모습). 대화상자의 세로 기준 칸이 비어 있다 |
| `float-bit1-on.hwp` | bit 1 = 1 | 연다. 기반과 같다 |
| `float-bit29-on.hwp` | bit 29 = 1 | **열지 못한다.** "파일이 손상되었습니다." |
| `float-bit31-on.hwp` | bit 31 = 1 | 연다. 기반과 같다 |

## 결론

- **bit 2(줄 간격에 영향)는 실제로 조판을 바꾼다.** 켜면 개체가 든 줄의 높이에 문단 줄 간격이 적용되는 것으로 보인다. 대화상자에는 이 값을 바꾸는 곳이 없었다. 저장소 HWP 파일 개체 440개(글자처럼 취급 298개 포함)에서도 모두 0이었다.
- **bit 29를 캡션 없이 켜면 한글이 파일을 거부한다.** 한글이 캡션을 넣으면 bit 29가 켜지고 캡션 LIST_HEADER가 생긴다(`object-common-props/rect-caption-bottom.hwp`). 그래서 bit 29는 "캡션 있음"이고, 자식 레코드와 반드시 맞아야 한다.
- 세로 정렬 3·4, 본문과의 배치 4·5, 세로 기준 3은 한글이 열지만 대화상자에 표시하지 못한다(빈 칸). 세로 정렬 3은 위, 4는 아래로 그렸다. 홀수 쪽 하나만 봐서 안쪽·바깥쪽으로 해석하는지는 미확인이다.
- bit 1, 31은 열기와 표시에 영향이 없었다.

**확인하지 않은 것**

- 짝수 쪽에서 세로 정렬 3·4의 위치.
- 본문과의 배치 4·5에서 개체가 글 앞인지 뒤인지(채우기 있는 개체로 다시 봐야 한다).
- 이 파일들을 한글에서 다시 저장할 때 값이 유지되는지.

## 재현

저장소 루트에서 실행한다. 출력 파일 이름은 지금 이름과 같다.

```bash
D=docs/experiments/object-props-out-of-dialog
P="npx tsx docs/experiments/scripts/patch-object-props.ts"
$P $D/base-inline-rect.hwp $D/inline-bit2-on.hwp 'gso ' 2 2 1
$P $D/base-float-rect.hwp $D/float-valign-2.hwp 'gso ' 5 7 2
$P $D/base-float-rect.hwp $D/float-valign-3.hwp 'gso ' 5 7 3
$P $D/base-float-rect.hwp $D/float-valign-4.hwp 'gso ' 5 7 4
$P $D/base-float-rect.hwp $D/float-wrap-4.hwp 'gso ' 21 23 4
$P $D/base-float-rect.hwp $D/float-wrap-5.hwp 'gso ' 21 23 5
$P $D/base-float-rect.hwp $D/float-vrel-3.hwp 'gso ' 3 4 3
$P $D/base-float-rect.hwp $D/float-bit1-on.hwp 'gso ' 1 1 1
$P $D/base-float-rect.hwp $D/float-bit31-on.hwp 'gso ' 31 31 1
$P $D/base-float-rect.hwp $D/float-bit29-on.hwp 'gso ' 29 29 1
```

2026-11-19: 위 명령으로 만든 파일을 그대로 한글에서 열었다. 모든 명령이 "Section0 레코드 일치, 다른 스트림 일치"를 출력했다.
