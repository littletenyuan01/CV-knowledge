# -*- coding: utf-8 -*-
"""重建 DOCX -> 结构检查 -> 转 PDF -> 校验文本是否越界。"""
import os
import re
import subprocess
import sys
import zlib

BASE = r"D:\CVlearningProject\CV-knowledge"
DOCX = os.path.join(BASE, "图像处理面试150题.docx")
CHECKER = r"D:\Program Files\deepseekHarness\resources\runtime\office-skills\scripts\check_office.py"
CHECK_OUT = os.path.join(BASE, "tools", "checks.json")
NODE = r"D:\Program Files\deepseekHarness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
CLI = r"D:\Program Files\deepseekHarness\resources\app.asar.unpacked\dsh\node_modules\@deepseek-ai\libreoffice-kit\lib\cli.js"
PDF = os.path.join(BASE, "tools", "verify.pdf")

sys.path.insert(0, os.path.join(BASE, "tools"))
import md2docx  # noqa: E402

md2docx.main()
print("docx size:", os.path.getsize(DOCX))

# 统计围栏代码块中最长行的显示宽度（防止 Word 中折行难看）
import unicodedata  # noqa: E402
src = os.path.join(BASE, "图像处理面试150题.md")
in_code = False
max_len = 0
max_line = ""
fences = 0
for line in open(src, encoding="utf-8"):
    if line.strip().startswith("```"):
        in_code = not in_code
        fences += 1
        continue
    if in_code:
        n = sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in line.rstrip("\n"))
        if n > max_len:
            max_len, max_line = n, line.rstrip("\n")
print("code fences:", fences, "| code blocks:", fences // 2)
print("longest code line width:", max_len, "|", max_line[:100])

r = subprocess.run([sys.executable, CHECKER, DOCX, "--out", CHECK_OUT,
                    "--contains", "Q100", "--contains", "Q150",
                    "--contains", "分档评分细则", "--contains", "现场代码题",
                    "--contains", "分方向面试卷组合", "--contains", "def nms",
                    "--contains", "def otsu"], capture_output=True,
                   text=True, encoding="utf-8", errors="replace")
print("checker exit:", r.returncode)
print(r.stdout[-1500:])
if r.stderr:
    print("checker stderr:", r.stderr[-800:])

r2 = subprocess.run([NODE, CLI, "convert", "--input", DOCX, "--output", PDF],
                    capture_output=True, text=True, encoding="utf-8", errors="replace")
print("convert exit:", r2.returncode, r2.stderr[-300:])

data = open(PDF, "rb").read()
print("pdf pages:", len(re.findall(rb"/Type\s*/Page[^s]", data)))
streams = []
for m in re.finditer(rb"stream\r?\n", data):
    start, end = m.end(), data.find(b"endstream", m.end())
    if end < 0:
        continue
    try:
        streams.append(zlib.decompress(data[start:end]))
    except Exception:
        pass

num = rb"[-+]?[0-9]*\.?[0-9]+"
tm_re = re.compile(rb"(" + num + rb")\s+(" + num + rb")\s+(" + num + rb")\s+(" + num + rb")\s+(" + num + rb")\s+(" + num + rb")\s+Tm")
td_re = re.compile(rb"(" + num + rb")\s+(" + num + rb")\s+Td")
tj_re = re.compile(rb"(Tj|TJ|'|\")")
max_global = 0.0
for s in streams:
    events = [(m.start(), float(m.group(5)), "Tm") for m in tm_re.finditer(s)]
    events += [(m.start(), float(m.group(1)), "Td") for m in td_re.finditer(s)]
    events.sort()
    for idx, (pos, x, kind) in enumerate(events):
        nxt = events[idx + 1][0] if idx + 1 < len(events) else len(s)
        if tj_re.search(s[pos:nxt]) and x > max_global:
            max_global = x
print("max text start x (pt):", round(max_global, 1), "| right margin limit 556.0")
print("overflow:", max_global > 556.0)
