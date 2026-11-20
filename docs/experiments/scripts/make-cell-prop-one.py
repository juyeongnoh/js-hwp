# 한글 자동화(COM)로 새 문서에 1×2 표를 만들고, 지정한 셀 하나에 셀 속성을 적용해 HWP로 저장한다.
# 셀에 텍스트는 넣지 않는다. 한글 2024와 pywin32, 자동화 보안 모듈(FilePathCheckerModule) 등록이 필요하다.
# 사용: python -I docs/experiments/scripts/make-cell-prop-one.py <출력.hwp> <셀 0|1> <항목=값>...
#   예: python -I docs/experiments/scripts/make-cell-prop-one.py out/protect-last-cell.hwp 1 Protected=1
import os
import sys

import win32com.client

out, cell, *items = sys.argv[1:]
hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
try:
    t = hwp.HParameterSet.HTableCreation
    hwp.HAction.GetDefault("TableCreate", t.HSet)
    t.Rows, t.Cols = 1, 2
    assert hwp.HAction.Execute("TableCreate", t.HSet)
    for _ in range(int(cell)):
        hwp.Run("TableRightCell")
    pset = hwp.HParameterSet.HShapeObject
    hwp.HAction.GetDefault("TablePropertyDialog", pset.HSet)
    pset.HSet.SetItem("ShapeType", 3)
    pset.HSet.SetItem("ShapeCellSize", 0)
    for item in items:
        key, value = item.split("=")
        setattr(pset.ShapeTableCell, key, int(value))
    assert hwp.HAction.Execute("TablePropertyDialog", pset.HSet)
    print(os.path.abspath(out), hwp.SaveAs(os.path.abspath(out), "HWP", ""))
finally:
    hwp.Clear(1)
    hwp.Quit()
