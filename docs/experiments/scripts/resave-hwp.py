# 한글 자동화(COM)로 HWP 파일을 열어 아무것도 바꾸지 않고 HWP와 HWPX로 다시 저장한다.
# 출력 이름은 resaved-<원래 이름>.hwp, .hwpx다. 한글이 비트를 보존하는지, HWPX의 어느 속성으로 읽는지 볼 때 쓴다.
# 사용: python -I docs/experiments/scripts/resave-hwp.py <출력 폴더> <파일.hwp>...
import os
import sys

import win32com.client

out_dir, *paths = sys.argv[1:]
os.makedirs(out_dir, exist_ok=True)
for path in paths:
    name = os.path.splitext(os.path.basename(path))[0]
    hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
    hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
    try:
        assert hwp.Open(os.path.abspath(path), "HWP", "forceopen:true")
        for ext, fmt in (("hwp", "HWP"), ("hwpx", "HWPX")):
            assert hwp.SaveAs(os.path.abspath(os.path.join(out_dir, f"resaved-{name}.{ext}")), fmt, "")
        print(name)
    finally:
        hwp.Clear(1)
        hwp.Quit()
