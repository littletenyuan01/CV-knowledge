"""交叉检查：JS 里用到的 #id 选择器，是否都存在于引用它的 HTML 页面中。

支持子目录页面（例如 rcnn/index.html 引用 ../assets/rcnn.js）。
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")

ID_SELECTOR = re.compile(r"""\$\(\s*['"]#([A-Za-z0-9_\-]+)['"]""")
ID_ATTR = re.compile(r"""id=["']([^"']+)["']""")

# 收集每个 js 文件用到的 #id
js_ids = {}
for fn in sorted(os.listdir(ASSETS)):
    if not fn.endswith(".js"):
        continue
    with open(os.path.join(ASSETS, fn), encoding="utf-8") as f:
        src = f.read()
    js_ids[fn] = set(ID_SELECTOR.findall(src))

# 收集所有页面（含子目录）
pages = {}
for dirpath, _dirs, files in os.walk(ROOT):
    for fn in sorted(files):
        if not fn.endswith(".html"):
            continue
        path = os.path.join(dirpath, fn)
        with open(path, encoding="utf-8") as f:
            src = f.read()
        rel = os.path.relpath(path, ROOT)
        used = set()
        for ref in re.findall(r"""<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']""", src):
            used.add(os.path.basename(ref))
        pages[rel] = {"ids": set(ID_ATTR.findall(src)), "js": used}

bad = 0
for js, want in sorted(js_ids.items()):
    for page, info in sorted(pages.items()):
        if js not in info["js"]:
            continue
        missing = sorted(want - info["ids"])
        if missing:
            bad += 1
            print(f"[FAIL] {page} 加载 {js}，但页面缺少 id: {', '.join(missing)}")
        else:
            print(f"[ OK ] {page} + {js}: {len(want)} 个 #id 引用全部命中")

# 反向提示：页面中存在但没有任何脚本引用的 id（仅提示，不算错误）
all_used = set()
for s in js_ids.values():
    all_used |= s
for page, info in sorted(pages.items()):
    unused = sorted(i for i in info["ids"] - all_used
                    if not re.fullmatch(r"s\d+", i) and not i.startswith("demo-"))
    if unused:
        print(f"[info] {page}: 未被脚本引用的 id -> {', '.join(unused)}")

raise SystemExit(1 if bad else 0)
