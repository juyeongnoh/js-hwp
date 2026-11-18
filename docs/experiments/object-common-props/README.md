# 개체 공통 속성(표 69, 70)을 한글 대화상자 값과 대조

표·그림 같은 개체 컨트롤의 CTRL_HEADER는 ctrlId 뒤에 개체 공통 속성(표 69)이 온다. 코덱의 `readObjectPlacement`가 이 값을 제대로 읽는지, 명세가 실제 파일과 맞는지 확인하려고 한글 대화상자에서 값을 바꿔 저장하고 바이트와 비교했다.

- 날짜: 2026-11-18
- 환경: Windows용 한글 2024. 앱 버전은 기록하지 않았다.
- 기반: 한글 새 문서에 2×2 표를 넣었다(만들기 대화상자 기본값). 파일마다 앞 파일의 상태에서 표/셀 속성 대화상자를 다시 열어 바꾸고 다른 이름으로 저장했다. 마지막 파일에는 사각형 도형을 더 그렸다.
- 바꾼 곳: 없음. 모든 파일은 한글이 저장한 그대로다.

## 파일

대화상자 값은 표/셀 속성(사각형은 개체 속성) 기본·여백/캡션 탭에서 고른 값이다. "속성"은 CTRL_HEADER 오프셋 4의 UINT32다.

| 파일 | 대화상자에서 바꾼 값 | 속성 | 오프셋 40 | 길이 |
| --- | --- | --- | --- | --- |
| `table-wrap-square.hwp` | 크기 고정 켬, 본문과의 배치 어울림, 본문 위치 오른쪽, 가로 쪽의 가운데 12mm, 세로 쪽의 아래 34mm, 번호 종류 그림, 개체 보호하기 켬, 바깥 여백 왼쪽 1.5·오른쪽 2.5·위쪽 3.5·아래쪽 4.5mm. "쪽 영역 안으로 제한"은 켜진 채 비활성 | `0x461A2548` | 0 | 48B |
| `table-topbottom-para.hwp` | 위에서 배치 자리 차지, 세로 문단의 위 5mm, 쪽 영역 안으로 제한 끔, "개체와 조판 부호를 항상 같은 쪽에 놓기" 켬. "서로 겹침 허용"은 비활성 | `0x463A0510` | 1 | 48B |
| `table-behind-para.hwp` | 위에서 배치 글 뒤로(네 번째 아이콘) | `0x465A0510` | 1 | 48B |
| `shape-rect-desc.hwp` | 위 표에 더해 사각형을 그림. 사각형은 기본값(글 앞으로, 종이 기준, 서로 겹침 허용 켬, 번호 종류 그림)이고 개체 설명문만 `Desc가나`로 바꿈 | `0x046A4000` | 0 | 60B |

2026-11-19에 새 문서에서 사각형 하나를 그려 아래 파일을 더 저장했다. 파일마다 앞 파일의 상태에서 개체 속성 기본·여백/캡션 탭을 다시 열어 바꿨다. 사각형은 처음에 글 앞으로·종이 기준이었고, 첫 파일에서 어울림으로 바꿨다.

| 파일 | 대화상자에서 바꾼 값 | 속성 |
| --- | --- | --- |
| `rect-size-paper-flow-left-num-none.hwp` | 너비 종이에 따라, 높이 종이에 따라, 어울림, 본문 위치 왼쪽, 번호 종류 없음 | `0x01004000` |
| `rect-size-page-flow-largest-num-eq-protect.hwp` | 너비·높이 쪽에 따라, 본문 위치 큰 쪽, 번호 종류 수식, 개체 보호하기 켬 | `0x4F04C000` |
| `rect-size-page-flow-largest-num-eq-unprotect.hwp` | 위 파일에서 편집 > 개체 보호 > "모든 보호 개체 해제하기"만 함 | `0x0F04C000` |
| `rect-size-column-flow-right-num-table.hwp` | 너비 단에 따라, 높이 고정값, 본문 위치 오른쪽, 번호 종류 표 | `0x0A094000` |
| `rect-size-para-flow-right.hwp` | 너비 문단에 따라. 본문 위치를 양쪽으로 바꾸려 했으나 반영되지 않아 오른쪽 그대로다(처음 이름 `rect-size-para-flow-both.hwp`에서 바꿨다) | `0x0A09C000` |
| `rect-treat-as-char.hwp` | 글자처럼 취급 켬 | `0x0A09C311` |
| `table-caption-bottom.hwp` | 새 문서에 만들기 대화상자 기본값으로 표를 넣고 캡션 넣기(Ctrl+N, C). 캡션 "표 1" 뒤에 ` 측정 결과`를 입력 | `0x282A2210` |
| `rect-caption-bottom.hwp` | (`object-props-out-of-dialog/base-float-rect.hwp` 상태에서) 캡션 아래 가운데 | `0x2809C000` |

아이콘 이름은 마우스를 올려 나온 풍선 도움말로 확인했다. 순서는 어울림, 자리 차지, 글 앞으로, 글 뒤로다. `table-behind-para.hwp`는 처음에 네 번째 아이콘을 글 앞으로로 잘못 알고 `table-front-para.hwp`로 저장했다가, 풍선 도움말을 본 뒤 이름만 바꿨다.

## 결론

속성 비트(표 70)는 대화상자 값과 이렇게 맞았다.

| 비트 | 관찰 |
| --- | --- |
| 0 | 글자처럼 취급. 켜면 1(`rect-treat-as-char.hwp`, 사용자도 따로 확인) |
| 2 | 줄 간격에 영향. 대화상자에서 바꾸는 곳을 찾지 못했다. 글자처럼 취급을 켜도 0이었다. 켜면 조판이 바뀐다(`object-props-out-of-dialog`) |
| 3–4, 5–7 | 세로 기준(쪽 1, 문단 2), 세로 정렬(위 0, 아래 2). 명세대로 |
| 8–9, 10–12 | 가로 기준(쪽 1), 가로 정렬(가운데 1). 가로 기준의 0은 명세에 page로 잘못 적혀 있고 paper(종이)다(정오표 78, 사용자가 따로 확인) |
| 13 | "쪽 영역 안으로 제한". 세로 기준이 쪽이어도 켜진 채 저장된다 |
| 14 | "서로 겹침 허용". 사각형에서 1. 표에서는 대화상자가 비활성이었다 |
| 15–17 | 폭 기준: 0 종이, 1 쪽, 2 단, 3 문단, 4 고정값. 대화상자 이름은 "종이에 따라" 등이다. **고정값이 아니면 폭(오프셋 16)에 HWPUNIT가 아니라 백분율×100이 들어간다**(32.42% → 3242). 이때 "크기 고정"은 비활성이다 |
| 18–19 | 높이 기준: 0 종이, 1 쪽, 2 고정값. 고정값이 아니면 높이(오프셋 20)도 백분율×100이다 |
| 20 | **"크기 고정"이다.** 명세는 "VertRelTo이 para일 때 크기 보호"라고 적었지만 세로 기준이 쪽일 때도 켜졌다 |
| 21–23 | **본문과의 배치: 0 어울림, 1 자리 차지, 2 글 뒤로, 3 글 앞으로.** 명세의 0~5(Square, Tight, Through, TopAndBottom, BehindText, InFrontOfText)와 다르다 |
| 24–25 | 본문 위치: 1 왼쪽, 2 오른쪽, 3 큰 쪽. 명세대로. 0(양쪽)은 기본값 파일에서 봤다 |
| 26–28 | 번호 종류: 0 없음, 1 그림, 2 표, 3 수식. 명세대로 |
| 29 | **명세에 없음. 캡션이 있으면 1이다**(`rect-caption-bottom.hwp`). 캡션 LIST_HEADER가 CTRL_HEADER 바로 아래에 생긴다. 캡션 없이 켜면 한글이 파일을 거부한다(`object-props-out-of-dialog`) |
| 30 | **명세에 없음. "개체 보호하기"다.** 같은 사각형에서 보호만 해제하자 이 비트만 바뀌었다(`…-protect`, `…-unprotect`). 보호된 개체는 두 번 눌러도 선택되지 않았다 |
| 31 | 명세에 없음. 어느 파일에서도 0이었다 |

나머지 필드(표 69)는 이렇다.

- 세로 오프셋, 가로 오프셋 순서다. 34mm → 9637, 12mm → 3401(HWPUNIT, 7200 = 1인치).
- **바깥 여백 네 칸은 왼쪽, 오른쪽, 위쪽, 아래쪽 순서다.** 명세는 순서를 적지 않는다.
- **오프셋 40(쪽나눔 방지)은 "개체와 조판 부호를 항상 같은 쪽에 놓기"다.** 켜면 1.
- 개체 설명문은 길이 WORD와 WCHAR로 들어간다(`Desc가나` → 길이 6).
- **설명문 뒤에 명세에 없는 2바이트(`00 00`)가 더 있다.** 이 폴더 파일 모두 그랬다. 캡션, 번호 종류, 보호, 크기 기준을 바꿔도 `00 00`이었다. 그래서 길이가 46 + 2×len이 아니라 48 + 2×len이다.
- 그리기 개체의 CTRL_HEADER ctrlId는 `gso `였다. 명세 표 67이 적은 `$rec`는 그 아래 SHAPE_COMPONENT 맨 앞에 두 번 들어 있었다.

코덱(`readObjectPlacement`, `writeObjectPlacement`)과 대조한 결과다.

- **바깥 여백을 위·아래·왼쪽·오른쪽 순서로 읽는다.** 쓸 때도 같은 순서라 바이트는 그대로지만 모델 값의 뜻이 틀린다. 왼쪽 1.5mm가 `marginTop`이 된다.
- **본문과의 배치를 명세의 이름으로 읽는다.** 값은 그대로 보존되지만 `TextWrap` 이름이 틀린다. 글 뒤로(2)가 `Through`, 글 앞으로(3)가 `TopAndBottom`이 된다.
- **표를 다시 쓰면 속성의 bit 20(크기 고정), bit 26–28(번호 종류), bit 30(개체 보호)이 사라진다.** 번호 종류는 늘 표(2)로 쓴다. 오프셋 40(쪽나눔 방지)은 0으로 쓰고, 설명문과 끝 2바이트를 버려 48B가 46B가 된다.
- 사각형(`gso `)은 코덱이 `unknown`으로 페이로드를 통째로 보존해서 CTRL_HEADER가 같았다. 대신 자식 레코드는 버린다(별건).

2026-11-19에 위 문제를 고쳤다. bit 29(캡션)는 캡션을 실제로 쓸 때만 켠다. 표 캡션은 `readTable`이 TABLE 앞의 LIST_HEADER를 캡션으로 읽고 `writeTable`이 다시 쓴다(`table-caption-bottom.hwp`로 확인, 코덱으로 다시 쓴 파일과 빌더로 만든 위·오른쪽 캡션 표를 한글에서 열어 캡션이 표시됨을 확인). 그림·그리기 개체 캡션은 BACKLOG "그림·그리기 개체 캡션". 여백 순서를 바로잡고 `TextWrap`을 실제 값(Square 0, TopAndBottom 1, BehindText 2, InFrontOfText 3)으로 바꿨다. bit 20(`fixedSize`), bit 26–28(`numberingKind`), bit 30(`locked`), 나머지 모르는 비트(`unknownBits`), 오프셋 40(`keepWithAnchor`), 설명문, 끝 바이트(`trailing`)를 모델에 담아 다시 쓴다. `packages/hwp/test/object-placement.test.ts`가 저장소 HWP 파일의 개체 CTRL_HEADER 왕복과 이 폴더의 값을 확인한다.

**확인하지 않은 것**

- 표에서 설명문을 넣는 방법(버튼이 비활성이었다).
- 설명문 뒤 2바이트의 뜻. 값이 `00 00`이 아닌 파일을 보지 못했다.
- 줄 간격에 영향(bit 2)을 대화상자 밖에서 켜는 방법(메뉴, 다른 대화상자).
- 캡션 LIST_HEADER(30B) 중 리스트 속성 뒤 UINT16과 끝 8바이트의 뜻. 나머지는 명세 표 71~73대로였다(문단 수, 리스트 속성, 캡션 속성 방향 3 = 아래, 폭 30mm, 간격 3mm, 최대 길이 = 개체 폭).

## 재현

파일은 한글에서 손으로 만들어 다시 생성할 수 없다. 개체 공통 속성은 아래 명령으로 풀어 볼 수 있다.

```bash
npx tsx docs/experiments/scripts/dump-object-common.ts docs/experiments/object-common-props/table-wrap-square.hwp docs/experiments/object-common-props/table-topbottom-para.hwp docs/experiments/object-common-props/table-behind-para.hwp docs/experiments/object-common-props/shape-rect-desc.hwp docs/experiments/object-common-props/rect-*.hwp
npx tsx docs/experiments/scripts/dump-record-tree.ts docs/experiments/object-common-props/rect-caption-bottom.hwp "gso " 3
```
