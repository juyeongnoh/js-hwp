# 빌더가 만든 그림을 한글이 여는지

`DocumentBuilder.image()`로 만든 그림 문서를 Windows용 한글 2024가 열고 그리는지, 다시 저장하면 무엇을 바꾸는지 확인했다. 예전 빌더 그림은 한글이 "파일을 읽거나 저장하는데 오류가 있습니다"로 열지 못했다(BACKLOG). 결과는 정오표 E54에 정리했다.

- 날짜: 2026-11-25
- 환경: Windows용 한글 2024. 한글 자동화(COM, `HWPFrame.HwpObject`)로 열고, 첫 쪽을 그리고, 다시 저장했다. 대화상자는 쓰지 않았다.
- 그림: `shape-picture/quadrants.png`(120×80).
- 만든 방법: `npx tsx docs/experiments/scripts/make-builder-pictures.ts`. 그림 레코드는 한글 기본 그림(`shape-picture/default.hwp`)과 같은 값이고, 인스턴스 ID(개체 공통 속성, 그림 레코드)는 0이다.

## 파일

| 파일 | 만든 것 | 한글에서 |
| --- | --- | --- |
| `inline.hwp` | 글자처럼 취급한 그림 | 그림이 그려짐 |
| `floating.hwp` | `inline: false` | 그림이 그려짐 |
| `caption.hwp` | 아래 캡션 "그림 1. 네 색" | 그림과 캡션이 그려짐 |
| `resized.hwp` | 폭 60mm, 설명문 | 늘린 크기로 그려짐 |
| `hangul-render.png` | 위 네 파일의 첫 쪽(`render-hwp-page.py`, 위 1/3) | — |
| `resaved/resaved-*.hwp`, `.hwpx` | 위 파일을 한글로 열어 그대로 HWP·HWPX로 저장(`resave-hwp.py`) | 아래 표 |

## 결과

- **처음 만든 파일은 한글이 열었지만 그림 자리에 깨진 그림 표시만 그렸다.** 원인은 BIN_DATA 속성의 유형이었다. 코덱의 `BinDataType`이 `Embedding = 0`, `Link = 1`로 명세(표 17: 0 LINK, 1 EMBEDDING, 2 STORAGE)와 반대였다. 빌더는 그림을 LINK(0)로 썼고, 한글이 만든 그림(속성 `0x0021`, EMBEDDING·압축 안 함)은 LINK로 잘못 읽어 경로 문자열로 해석했다. 값을 명세대로 고치자 네 파일 모두 그림이 그려졌다. 이때 BinData 스트림을 항목의 압축 설정(bit 4~5)대로 쓰도록 함께 고쳤다. 전에는 늘 파일 압축 플래그를 따라 압축하지 않음(2)인 그림도 압축해 썼다.
- 고친 뒤 다시 저장한 파일에서 그림 레코드는 인스턴스 ID 말고는 같았다. 한글은 0인 두 인스턴스 ID(개체 공통 속성, 그림 레코드)를 받아들이고 저장할 때 새 값을 붙였다. BIN_DATA는 빌더가 쓴 `0x0001`(EMBEDDING, 압축은 저장소 기본값) 그대로였다.
- 다시 저장하면서 바뀐 것(네 파일 모두):

  | 값 | 빌더 | 한글 저장 |
  | --- | --- | --- |
  | 개체 공통 속성 번호 종류(bit 26~28) | 1 | 5 |
  | SHAPE_COMPONENT 개체 요소 속성 | `0x24080000`(bit 19, 26, 29) | `0x30090000`(bit 16, 19, 28, 29) |
  | 개체 공통 속성 끝 2바이트(정정 76) | 없음 | `00 00` |

  - HWPX는 `numberingType="PICTURE"`로 같았다.
  - 번호 종류 5와 bit 16은 빌더 파일에만 생기는 것이 아니었다. 한글이 만든 `shape-picture/default.hwp`를 같은 방법으로 다시 저장해도 한 번은 1·`0x24080000` 그대로였고, 그 뒤 몇 번은 5·`0x24090000`이 됐다. 같은 파일을 같은 방법으로 저장해도 결과가 달라 원인을 정하지 못했다.
  - bit 26 → 28은 문서에 `\005HwpSummaryInformation` 스트림이 없을 때 생겼다. 빌더 문서는 이 스트림을 쓰지 않는다. 빌더 문서에 `default.hwp`의 이 스트림만 넣어 다시 저장하자 bit 26이 남았고, 다른 스트림(PrvImage, Scripts, DocOptions)만 넣었을 때는 28이 됐다. 반대로 빌더 문서에 `default.hwp`의 그림 컨트롤을 통째로 넣어도 28이 됐다. 그림 값이 아니라 문서 쪽 차이다. 그림은 어느 쪽이든 같게 그려졌다.

## 확인하지 않은 것

- 한글 UI로 열어 저장한 결과. COM 저장만 봤다. 번호 종류 5가 COM 저장에서만 생기는지도 모른다.
- 번호 종류 5와 개체 요소 속성 bit 16, 28의 뜻.
- 왼쪽·오른쪽 캡션. BACKLOG에 적힌 캡션 폭 문제는 보지 않았다.

## 재현

```sh
npx tsx docs/experiments/scripts/make-builder-pictures.ts
python -I docs/experiments/scripts/resave-hwp.py docs/experiments/builder-picture/resaved docs/experiments/builder-picture/inline.hwp docs/experiments/builder-picture/floating.hwp docs/experiments/builder-picture/caption.hwp docs/experiments/builder-picture/resized.hwp
python -I docs/experiments/scripts/render-hwp-page.py <출력 폴더> docs/experiments/builder-picture/inline.hwp
npx tsx docs/experiments/scripts/dump-pictures.ts docs/experiments/builder-picture/resaved/resaved-inline.hwp
```

`hangul-render.png`는 네 BMP의 위 1/3을 가로로 이어 붙인 것이다.
