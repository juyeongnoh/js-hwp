# 한글 자동화(COM)로 새 문서에 5×3 표를 만들고 셀마다 셀 속성 하나씩 바꿔 HWP와 HWPX로 저장한다.
# 셀 i(행 우선)에는 텍스트 "c<i>"를 넣고 아래 CELLS[i]의 값을 TablePropertyDialog(셀 탭)로 적용한다.
# 한글 2024와 pywin32, 자동화 보안 모듈(FilePathCheckerModule) 등록이 필요하다.
# 사용: python -I docs/experiments/scripts/make-cell-props.py <출력 폴더> [파일 이름(확장자 제외)]
import os
import sys

import win32com.client

out_dir = os.path.abspath(sys.argv[1])
name = sys.argv[2] if len(sys.argv) > 2 else "cell-props"

ROWS, COLS = 5, 3
CELLS = [
    {},  # c0 기본
    {"Header": 1},  # c1 제목 셀
    {"HasMargin": 1, "MarginLeft": 1000, "MarginRight": 1000, "MarginTop": 500, "MarginBottom": 500},  # c2
    {"HasMargin": 1},  # c3 안 여백 지정, 값은 표 기본과 같음
    {"Editable": 1},  # c4 양식 모드에서 편집 가능
    {"Dirty": 1},  # c5
    {"TextDirection": 1},  # c6 세로쓰기
    {"TextDirection": 2},  # c7
    {"LineWrap": 1},  # c8
    {"LineWrap": 2},  # c9
    {"VertAlign": 0},  # c10 위
    {"VertAlign": 2},  # c11 아래
    {},  # c12 기본
    {"Header": 1, "Editable": 1},  # c13
    # 셀 보호를 켠 셀에서 TableRightCell로 옮기면 커서가 어긋난다(first-try-cell-props.hwp).
    # 그래서 보호 셀은 마지막에 둔다.
    {"Protected": 1},  # c14 셀 보호
]

hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
try:
    t = hwp.HParameterSet.HTableCreation
    hwp.HAction.GetDefault("TableCreate", t.HSet)
    t.Rows, t.Cols, t.WidthType, t.HeightType = ROWS, COLS, 2, 0
    assert hwp.HAction.Execute("TableCreate", t.HSet)

    for i, props in enumerate(CELLS):
        text = hwp.HParameterSet.HInsertText
        hwp.HAction.GetDefault("InsertText", text.HSet)
        text.Text = f"c{i}"
        hwp.HAction.Execute("InsertText", text.HSet)
        if props:
            pset = hwp.HParameterSet.HShapeObject
            hwp.HAction.GetDefault("TablePropertyDialog", pset.HSet)
            pset.HSet.SetItem("ShapeType", 3)
            pset.HSet.SetItem("ShapeCellSize", 0)
            for key, value in props.items():
                setattr(pset.ShapeTableCell, key, value)
            ok = hwp.HAction.Execute("TablePropertyDialog", pset.HSet)
            print(f"c{i} {props} -> {ok}")
        if i < len(CELLS) - 1:
            hwp.Run("TableRightCell")

    os.makedirs(out_dir, exist_ok=True)
    for ext, fmt in (("hwp", "HWP"), ("hwpx", "HWPX")):
        path = os.path.join(out_dir, f"{name}.{ext}")
        print(path, hwp.SaveAs(path, fmt, ""))
finally:
    hwp.Clear(1)
    hwp.Quit()
