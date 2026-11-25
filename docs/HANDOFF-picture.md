# 핸드오프: 그림 개체(SHAPE_COMPONENT_PICTURE) 파싱

작업이 끝나면 이 파일을 지운다.

## 목표

그림(`gso ` 아래 SHAPE_COMPONENT `$pic`과 자식 SHAPE_COMPONENT_PICTURE)을 모델로 읽고 써서, 한글이 저장한 파일을 그대로 쓰면 원본과 바이트가 같게 한다. 명세 필드는 한글로 실제 저장해 검증한다(CLAUDE.md의 원본 비트 보존 원칙).

## 지금 상태 (커밋 `wip: 그림 개체…`)

- **빌드가 깨져 있다.** `packages/core/src/builder.ts`의 `image()`가 `rgb`, `ShapeMatrix`, `ImageEffect`를 쓰는데 import가 없다. `npx tsc -b`로 확인한다. `ImageEffect`는 값으로 쓰므로 `./model/docinfo.js`에서 `type` 없이 가져와야 한다.
- 테스트는 돌리지 않았다.
- 코덱(`packages/hwp/src/bodytext.ts`)
  - `readPictureShape`/`writePictureShape`를 추가하고 `SHAPE_KINDS`에 `$pic`을 넣었다. 그림도 다른 도형처럼 `readDrawingObject` → `writeShape` 경로를 탄다.
  - `writeShape`는 그림이면 번호 종류 기본값을 1(그림)로 쓴다.
  - 그림 효과는 다시 썼을 때 원본과 같을 때만 `effects`로 둔다. 아니면 효과부터 끝까지를 `pictureTrailing`에 원본 그대로 둔다.
  - `readShapeLine`/`writeShapeLine`에서 앞 12바이트를 `readLineBody`/`writeLineBody`로 나눠 그림 테두리에 쓴다.
  - 동작하지 않던 그림 분기(`childWithTag(node, ShapeComponentPicture)`, 손자라 못 찾았다), `writePicture`, `findBinDataId`를 지웠다.
- `packages/hwp/src/bytes.ts`에 `float32` 읽기·쓰기를 추가했다.
- 모델(`packages/core/src/model/controls.ts`): `PictureControl`을 `LegacyShapeBase`에서 `ShapeBase`로 옮겼다. 새 타입은 `PictureBorder`, `PictureEffectColor`, `PictureShadow`, `PictureGlow`, `PictureReflection`, `PictureEffects`다. 그림 레코드의 인스턴스 ID는 `pictureInstanceId`다. `ShapeBase.instanceId`는 그리기 개체 그림자와 짝이어야 해서 이름을 나눴다.
- 빌더: `image()`가 한글 기본 그림(`default.hwp`)과 같은 값으로 `PictureControl` 전체를 만든다. 원본 크기는 96dpi 픽셀 × 75로 잡고, 넣는 크기는 현재 크기와 scale matrix로 나타낸다.

## 실험 결과 (`docs/experiments/shape-picture/`, README 아직 없음)

환경: Windows용 한글 2024. Mac에서 원격 데스크톱(Windows App)과 computer use로 조작했다. 그림은 직접 만든 120×80 4색 PNG(`quadrants.png`)다. 파일마다 .hwp와 .hwpx가 짝이다.

| 파일                | 바꾼 것 (앞 파일에 누적)                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `default`           | 그림 넣기만. 레코드 91B                                                                                                                  |
| `picture-line`      | 그림 탭: 자르기 왼1·위2·오른3·아래4mm, 여백 왼1·오른2·위3·아래4mm, 밝기 3, 대비 −2, 투명도 5%. 선 탭: 빨강, 점선(종류 2), 3mm, 투명도 7% |
| `effect-shadow`     | 그림자: 첫 프리셋, 파랑, 53%, 흐리게 8pt, 크기 101%, 기울기 4°, 거리 7pt, 각도 47°                                                       |
| `effect-reflection` | 반사: 가운데 줄 3번째 프리셋, 크기 77%, 거리 7pt                                                                                         |
| `effect-all`        | 네온(주황 프리셋, 52%, 11pt), 옅은 테두리(3번째 프리셋, 8pt)                                                                             |
| `gray-invert`       | 회색조, 그림 반전                                                                                                                        |
| `bw-watermark`      | 흑백, 워터마크                                                                                                                           |

확인한 것(HWPX `hp:pic`와 대조):

- 레코드 앞 78바이트
  - 테두리: 색, 굵기, 속성 12바이트. 표 86에서 Outline style 1바이트를 뺀 것이다.
  - 꼭짓점: (x, y) INT32 쌍 4개. 명세는 x 4개 다음 y 4개로 적었다 → 정정 102. 그림을 넣을 때의 크기이고, 자르거나 크기를 바꿔도 그대로다.
  - 자른 뒤 사각형: left, top, right, bottom 좌표. 원본 이미지 좌표다(`hp:imgClip`).
  - 그림 여백: HWPUNIT16 왼·오른·위·아래(`hp:inMargin`).
  - 그림 정보: 명암, 밝기, 효과, BinItem ID. 명세와 달리 명암이 먼저다(정정 11과 같음).
  - 테두리 투명도 BYTE: 7%가 18이다.
  - 인스턴스 ID: `instid`와 같다.
- 그림 효과(표 108): 플래그 UINT32의 bit 0 그림자, bit 1 네온, bit 2 옅은 테두리, bit 3 반사. 블록도 이 순서다.
  - 그림자(표 109): 명세 순서가 맞다. "정렬"은 HWPX `alignStyle`이고 4가 CENTER다.
  - 반사(표 112): 명세는 53B지만 INT32·float 14개, 56B다 → 정정 103. 첫 INT32 "반사 스타일"은 alignStyle이고 6이 BOTTOM_LEFT다.
  - 색(표 113): 대화상자가 만든 색은 모두 타입 0(RGB)이었다. 타입 0이면 타입, 0x00rrggbb, 효과 수 순서다. 효과는 (종류 INT32, 값 float) 쌍이다.
  - 네온 프리셋의 색상 효과 HWPX `SAT_MOD`가 명세 표 115의 16이 아니라 516(0x204)으로 저장됐다 → 정정 104.
- 끝 9바이트는 표 116: 원본 크기 HWPUNIT ×2(`hp:imgDim`), 그림 투명도 BYTE(`hp:img alpha`, 5%가 13). 저장소의 오래된 90B 레코드에는 투명도 바이트가 없다.
- "그림 반전"은 그림 레코드가 아니라 SHAPE_COMPONENT 개체 요소 속성 bit 24다(HWPX `reverse="1"`). 그리기 개체에서는 bit 24가 글상자 유무였다(정정 101). 지금은 `unknownBits`로 보존한다.
- 워터마크는 별도 비트가 없다. 밝기 70, 명암 −50 값으로만 저장된다. 회색조는 효과 1, 흑백은 효과 2다.
- 자르면 SHAPE_COMPONENT의 현재 크기가 자른 크기가 되고 scale matrix가 바뀐다. 개체 공통 속성의 폭·높이는 여기에 그림 여백을 더한 값이다.
- 한글 기본 테두리는 검정, 굵기 33, 종류 0, 끝 모양 1, 화살표 크기 4·4, bit 30·31 켜짐이다. 이때 HWPX에는 `hp:lineShape`가 없다.

모델 주석은 정정 102~104와 E53을 가리키지만, `docs/hwp-5.0-errata.md`에는 아직 이 항목들이 없다.

## 남은 일

1. builder.ts import를 고쳐 `npx tsc -b`를 통과시킨다.
2. 테스트
   - `npm test`로 기존 테스트를 확인한다. 특히 `packages/hwp/test/unknown-control.test.ts`, `shape-component.test.ts`, `object-placement.test.ts`, core `builder.test.ts`.
   - 그림 테스트를 추가한다: 실험 파일 7개의 필드 값, 저장소 그림 30개(90B·91B 포함)의 바이트 왕복, 효과를 읽지 못하는 경우(모르는 플래그 비트, RGB가 아닌 색 타입, 짧은 레코드)의 `pictureTrailing` 보존.
   - 저장소 그림 목록은 `npx tsx docs/experiments/scripts/dump-pictures.ts <파일>`로 볼 수 있다.
3. 빌더 그림을 한글에서 확인한다. BACKLOG 21번에 따르면 예전 빌더 그림은 한글이 열지 못했다. 새 빌더로 만든 파일(인라인과 떠 있는 것, 캡션 있는 것)을 한글 2024로 열고 다시 저장해 본다. `pictureInstanceId: 0`과 개체 공통 속성 인스턴스 ID 0을 받아들이는지도 본다.
4. 문서
   - `docs/experiments/shape-picture/README.md`: 실험 README 규칙을 따르고 위 표를 옮긴다. `docs/experiments/README.md` 목록에 한 줄을 넣는다.
   - `docs/hwp-5.0-errata.md`: 정정 102(꼭짓점 쌍), 103(반사 56B), 104(색상 효과 516), E53 실험 기록. 표 107이 표 116(원본 크기, 투명도)을 가리키지 않는 것과 "BinItem의 아이디" 앞 5B의 순서도 적는다.
   - `docs/hwp-format.md`: 그리기 개체 절에 그림 레코드 배치 표를 넣는다.
   - `docs/hangul-behavior.md`: "구현 시" 항목에 대화상자가 만드는 값을 적는다. 효과 색은 RGB만, 그림자 프리셋 3묶음, 투명도는 % → 0~255, 1mm 단위 스핀 버튼 등이다.
   - `docs/BACKLOG.md` 21번(그림 캡션·빌더 그림)을 갱신한다.
5. 아직 확인하지 않은 것: 그림자 스타일 1 이상(두 번째·세 번째 프리셋 묶음), 회전·대칭한 그림의 bit 25, 그림에 캡션을 달았을 때. 편집 API로 효과를 설정할 수 있게 할지는 CLAUDE.md "편집 API는 한글이 만들 수 있는 값만"에 따라 정한다. 지금은 읽은 값의 보존만 한다.

## 원격 조작 메모 (Mac에서 Windows App으로 할 때)

- computer use로 타이핑하면 원격 PC에 모든 글자가 'a'로 들어간다. 클립보드 붙여넣기도 안 됐다. 그래서 파일 이름을 'aa', 'aaa'…로 저장하고 Mac에서 복사해 이름을 붙였다.
- 한글이 열고 있는 파일은 Mac에서 이름을 바꾸면 그 이름으로 다시 저장할 수 없다. 복사(cp)해서 이름을 붙인다.
- 공유 경로는 `\\100.68.223.51\juyeongnoh\js-hwp`다. 빠른 실행의 `js-hwp` 항목은 다른 오래된 사본을 가리킨다.
- Windows에서 직접 작업하면 이 문제들은 없다.
