"""简单的 HTML 结构自检：标签配对、重复 id、空链接目标、引用资源是否存在。"""
import html.parser
import os
import re
import sys
from collections import Counter

VOID = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr", "path", "rect", "circle",
    "line", "polyline", "polygon", "stop", "use", "ellipse",
}


class Checker(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.errors = []
        self.ids = Counter()
        self.anchors = set()
        self.refs = set()
        self.svg_depth = 0

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if "id" in d:
            self.ids[d["id"]] += 1
        if tag == "a" and d.get("href", "").startswith("#"):
            self.anchors.add(d["href"][1:])
        for key in ("href", "src"):
            v = d.get(key, "")
            if v and not v.startswith(("#", "http://", "https://", "mailto:", "data:")):
                self.refs.add(v)
        if tag not in VOID:
            self.stack.append((tag, self.getpos()))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append(f"多余的闭合标签 </{tag}> at {self.getpos()}")
            return
        top, pos = self.stack.pop()
        if top != tag:
            self.errors.append(
                f"标签不匹配: <{top}> (line {pos[0]}) 被 </{tag}> 关闭 (line {self.getpos()[0]})"
            )

    def close(self):
        super().close()
        for tag, pos in self.stack:
            self.errors.append(f"未闭合标签 <{tag}> at line {pos[0]}")


def check(path):
    with open(path, encoding="utf-8") as f:
        src = f.read()
    c = Checker()
    c.feed(src)
    c.close()

    problems = list(c.errors)
    dups = [i for i, n in c.ids.items() if n > 1]
    if dups:
        problems.append("重复 id: " + ", ".join(sorted(dups)))

    missing_anchor = sorted(a for a in c.anchors if a and a not in c.ids)
    if missing_anchor:
        problems.append("页内锚点无对应 id: " + ", ".join(missing_anchor))

    base = os.path.dirname(path)
    for r in sorted(c.refs):
        if not os.path.exists(os.path.join(base, r)):
            problems.append(f"引用的文件不存在: {r}")

    name = os.path.basename(path)
    if problems:
        print(f"[FAIL] {name}")
        for p in problems:
            print("    -", p)
        return 1
    print(f"[ OK ] {name}  (tags balanced, {len(c.ids)} ids unique, {len(c.refs)} refs resolved, {len(c.anchors)} anchors ok)")
    return 0


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    bad = 0
    pages = []
    for dirpath, _dirs, files in os.walk(root):
        for fn in sorted(files):
            if fn.endswith(".html"):
                pages.append(os.path.join(dirpath, fn))
    for p in sorted(pages):
        bad += check(p)
    sys.exit(1 if bad else 0)
