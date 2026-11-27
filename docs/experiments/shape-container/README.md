# 묶음 개체(`$con`)

묶음 개체의 레코드 배치를 한글 2024로 만든 파일과 HWPX `hp:container`로 대조했다. 결과는 정오표 정정 107, E56에 정리했다.

- 날짜: 2026-11-27
- 환경: Windows용 한글 2024(13.0.0.4226). `scripts/hangul-repl.py`로 한글 창을 띄우고, 개체 여러 개는 computer use로 Shift+클릭해 골랐다. 묶기(`ShapeObjGroup`), 회전, 대칭, 캡션 넣기, 저장은 COM으로 했다.
- 재료: `shape-ellipse-arc-polygon-curve/shapes.hwp`(타원, 호, 다각형 2개, 곡선)와 `shape-textbox-origin/textbox-and-shape-text.hwp`(글상자 사각형 2개), `shape-picture/quadrants.png`
- 값 보기: `npx tsx docs/experiments/scripts/dump-containers.ts docs/experiments/shape-container/*.hwp`

## 파일

파일마다 .hwp와 .hwpx가 짝이다. 앞 파일에 누적해서 바꿨다(`textbox-picture` 제외).

| 파일 | 만든 방법 |
| --- | --- |
| `two-polygons` | `shapes.hwp`의 사각 다각형과 삼각형을 골라 묶음 |
| `nested` | 위 묶음과 곡선을 다시 묶음. 묶음 안에 묶음이 있다 |
| `nested-rotate-flip` | 바깥 묶음을 오른쪽으로 90° 회전(`ShapeObjRightAngleRotater`)하고 좌우 대칭(`ShapeObjHorzFlip`) |
| `nested-rotate-flip-caption` | 바깥 묶음에 캡션 넣기(`ShapeObjAttachCaption`) |
| `textbox-picture` | `textbox-and-shape-text.hwp`에 그림을 글 앞으로 넣고, 글상자 사각형 A와 그림을 묶음 |

## 결과

- **명세의 SHAPE_COMPONENT_CONTAINER 레코드(태그 70)는 없다.** 묶음 개체 속성(개수, 자식 ID 배열)은 `$con` SHAPE_COMPONENT 레코드 안, 렌더링 정보(행렬) 바로 뒤에 붙는다. 그 뒤에 묶음의 인스턴스 ID(HWPX `instid`) 4바이트가 온다. 선·채우기·그림자는 없다.
- **자식은 `$con` SHAPE_COMPONENT의 자식 레코드다.** 자식마다 SHAPE_COMPONENT가 하나씩 오고, 그 아래에 맨 위 개체와 똑같이 글상자 LIST_HEADER·문단과 도형별 레코드가 온다. 자식 순서는 ID 배열 순서와 같다.
- **자식은 컨트롤 ID를 한 번만 쓴다.** 맨 위 개체는 두 번 쓴다(명세의 GenShapeObject). 그래서 자식 레코드의 모든 필드가 4바이트 앞당겨진다. 자식에는 CTRL_HEADER(개체 공통 속성)가 없다. HWPX에서도 자식 요소에는 `hp:sz`, `hp:pos`가 없다.
- **groupLevel은 묶인 깊이다.** 맨 위 0, 묶음 안 1, 묶음 안 묶음 안 2. scale/rotation 행렬 쌍 수는 groupLevel + 1이다.
- **groupOffsetX·Y는 묶음 안 위치다.** 회전하지 않은 묶음에서 자식의 translation matrix는 (1, 0, groupOffsetX, 0, 1, groupOffsetY)였다. 자식의 처음·현재 폭·높이와 인스턴스 ID는 묶기 전 값 그대로다.
- **캡션은 바깥 CTRL_HEADER에 붙는다.** 다른 그리기 개체처럼 SHAPE_COMPONENT 앞에 LIST_HEADER와 문단이 온다.
- **묶을 때 개체 설명문이 사라진다.** 한글은 "개체를 묶으면 개체 설명문이 사라집니다"라고 묻고, 묶음의 설명문은 "묶음 개체입니다."가 된다(HWPX `hp:shapeComment`). `two-polygons`와 `nested`에서는 묻지 않았고 그림이 든 `textbox-picture`에서만 물었다. 무엇이 묻게 하는지는 확인하지 않았다.
- **개체 요소 속성.** 묶음은 `0x80000`(bit 19)이다. 안쪽 묶음은 bit 16이 켜져 `0x90000`이었고, 바깥 묶음을 회전·대칭하자 `0xB0000`(bit 17 추가)이 됐다. 바깥 묶음을 좌우 대칭하면 바깥 `$con`에 bit 0이 켜진다.
- **회전·대칭한 묶음.** 바깥 묶음을 90° 회전하고 좌우 대칭하자 바깥 `$con`의 회전각은 270, 자식(안쪽 묶음과 그 자식, 곡선)의 회전각은 모두 90이 됐다. 자식마다 groupOffset과 translation, 첫 rotation matrix가 바뀌었다. 행렬들이 어떻게 합쳐지는지는 이 파일들만으로는 정하지 못했다.
- 코덱은 `$con`을 `ContainerControl`로 읽고, 다섯 파일의 구역 스트림을 원본과 바이트 단위로 같게 다시 쓴다(`packages/hwp/test/container.test.ts`). 이 실험을 처음 할 때는 `unknown`으로 읽었고 그때도 바이트가 같았다.

## 확인하지 않은 것

- 크기를 바꾼 묶음(scale matrix가 1이 아닌 경우)
- OLE 개체가 든 묶음
- 묶음 풀기(`ShapeObjUngroup`)를 했을 때 자식에 다시 생기는 개체 공통 속성 값
- 개체 요소 속성 bit 16, 17의 뜻

## 재현

```sh
python -I docs/experiments/scripts/hangul-repl.py   # 백그라운드로
docs/experiments/scripts/hangul-send.sh 'out.append(hwp.Open(os.path.abspath("<작업 파일>.hwp"), "HWP", "lock:false"))'
# 화면에서 개체를 Shift+클릭으로 고른 뒤
docs/experiments/scripts/hangul-send.sh 'out.append(hwp.HAction.Run("ShapeObjGroup"))'
docs/experiments/scripts/hangul-send.sh 'out.append(hwp.SaveAs(os.path.abspath("<이름>.hwp"), "HWP", ""))'
```

COM의 `SelectCtrl`은 인스턴스 ID를 어떤 형식으로 줘도 False를 돌려줘 여러 개체를 고르지 못했다. 열린 파일과 같은 경로로 `SaveAs`하면 HWP 저장이 실패한다. 작업 파일을 따로 두고 다른 이름으로 저장한다.
