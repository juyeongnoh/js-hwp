# 한글 자동화(COM)로 HWP 파일을 열어 첫 쪽을 48dpi BMP(<출력 폴더>/<이름>.bmp)로 그린다. 한글이 파일을 어떻게 그리는지 볼 때 쓴다.
# 사용: python -I docs/experiments/scripts/render-hwp-page.py <출력 폴더> <파일.hwp>...
import os, sys
import win32com.client
out_dir, *paths = sys.argv[1:]
for path in paths:
    name = os.path.splitext(os.path.basename(path))[0]
    hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
    hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
    try:
        print(name, hwp.Open(os.path.abspath(path), "HWP", "forceopen:true"))
        print(hwp.CreatePageImage(os.path.abspath(os.path.join(out_dir, name + ".bmp")), 0, 48, 24, "bmp"))
    finally:
        hwp.Clear(1); hwp.Quit()
