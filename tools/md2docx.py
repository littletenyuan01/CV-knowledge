# -*- coding: utf-8 -*-
"""把 图像处理面试100题.md 转换为排版良好的 Word 文档。"""
import re
import os
from docx import Document
from docx.shared import Pt, RGBColor, Twips
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

BASE = r"D:\CVlearningProject\CV-knowledge"
SRC = os.path.join(BASE, "图像处理面试150题.md")
OUT = os.path.join(BASE, "图像处理面试150题.docx")

CN_BODY = "微软雅黑"
CN_HEAD = "微软雅黑"
MONO = "Consolas"
CONTENT_TWIPS = 10000  # 12240 - 1120*2


def display_len(text):
    return sum(2 if ord(ch) > 0x2000 else 1 for ch in text)


def fix_table_layout(table, matrix):
    """按内容长度分配列宽，并锁定表格布局，避免超出版心。"""
    ncol = len(matrix[0])
    weights = []
    for c in range(ncol):
        longest = max([display_len(row[c]) for row in matrix if c < len(row)] or [4])
        weights.append(max(6.0, float(longest)))
    total = sum(weights)
    widths = [max(600, int(CONTENT_TWIPS * w / total)) for w in weights]
    diff = CONTENT_TWIPS - sum(widths)
    widths[0] += diff  # 误差补到第一列

    tbl = table._tbl
    tblPr = tbl.tblPr
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tblPr.append(layout)
    tblW = tblPr.find(qn("w:tblW"))
    if tblW is None:
        tblW = OxmlElement("w:tblW")
        tblPr.append(tblW)
    tblW.set(qn("w:type"), "dxa")
    tblW.set(qn("w:w"), str(sum(widths)))
    grid = tbl.find(qn("w:tblGrid"))
    if grid is not None:
        for gc, w in zip(grid.findall(qn("w:gridCol")), widths):
            gc.set(qn("w:w"), str(w))
    for row in table.rows:
        for cell, w in zip(row.cells, widths):
            cell.width = Twips(w)



def style_east_asia(style, cn_font, size=None):
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.get_or_add_rFonts()
    rfonts.set(qn("w:eastAsia"), cn_font)
    style.font.name = "Calibri" if cn_font == CN_BODY else cn_font
    if size is not None:
        style.font.size = size


def set_run_font(run, mono=False, size=None, bold=None, color=None):
    name = MONO if mono else CN_BODY
    run.font.name = name
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.get_or_add_rFonts()
    rfonts.set(qn("w:eastAsia"), name)
    if size is not None:
        run.font.size = size
    if bold is not None:
        run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color


def shade_paragraph(paragraph, fill="F4F4F4"):
    pPr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    pPr.append(shd)


TOKEN_RE = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")


def add_inline(paragraph, text, size=None):
    """解析 **加粗** 与 `代码` 行内标记。"""
    for part in TOKEN_RE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            r = paragraph.add_run(part[2:-2])
            r.bold = True
            set_run_font(r, size=size)
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            r = paragraph.add_run(part[1:-1])
            set_run_font(r, mono=True, size=(size or Pt(10.5)) - Pt(0.5))
            r.font.color.rgb = RGBColor(0xB0, 0x30, 0x60)
        else:
            r = paragraph.add_run(part)
            set_run_font(r, size=size)


def split_table_row(line):
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def is_sep_row(line):
    cells = split_table_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{2,}:?", c) for c in cells)


def main():
    with open(SRC, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()

    doc = Document()
    normal = doc.styles["Normal"]
    style_east_asia(normal, CN_BODY, Pt(10.5))
    normal.paragraph_format.space_after = Pt(4)
    normal.paragraph_format.line_spacing = 1.25

    for name, size, color in (("Heading 1", Pt(17), RGBColor(0x1F, 0x3B, 0x73)),
                              ("Heading 2", Pt(14), RGBColor(0x1F, 0x3B, 0x73)),
                              ("Heading 3", Pt(12), RGBColor(0x0F, 0x5A, 0x8A))):
        try:
            s = doc.styles[name]
            style_east_asia(s, CN_HEAD, size)
            s.font.color.rgb = color
            s.font.bold = True
        except KeyError:
            pass

    for sec in doc.sections:
        sec.left_margin = Pt(56)
        sec.right_margin = Pt(56)
        sec.top_margin = Pt(60)
        sec.bottom_margin = Pt(60)

    i = 0
    n = len(lines)
    while i < n:
        line = lines[i].rstrip()
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # 围栏代码块
        if stripped.startswith("```"):
            i += 1
            code_lines = []
            while i < n and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i].rstrip())
                i += 1
            i += 1  # 跳过结束围栏
            for cl in code_lines:
                p = doc.add_paragraph()
                pf = p.paragraph_format
                pf.space_before = Pt(0)
                pf.space_after = Pt(0)
                pf.line_spacing = 1.0
                pf.left_indent = Pt(10)
                r = p.add_run(cl if cl else " ")
                set_run_font(r, mono=True, size=Pt(8.5))
                shade_paragraph(p)
            continue

        # 表格
        if stripped.startswith("|") and i + 1 < n and is_sep_row(lines[i + 1]):
            header = split_table_row(stripped)
            rows = []
            j = i + 2
            while j < n and lines[j].strip().startswith("|"):
                rows.append(split_table_row(lines[j]))
                j += 1
            table = doc.add_table(rows=1, cols=len(header))
            table.style = "Table Grid"
            for k, cell_text in enumerate(header):
                cell = table.rows[0].cells[k]
                cell.text = ""
                p = cell.paragraphs[0]
                add_inline(p, cell_text, size=Pt(10))
                for r in p.runs:
                    r.bold = True
            for row in rows:
                cells = table.add_row().cells
                for k in range(len(header)):
                    txt = row[k] if k < len(row) else ""
                    cells[k].text = ""
                    p = cells[k].paragraphs[0]
                    add_inline(p, txt, size=Pt(10))
            table.autofit = False
            fix_table_layout(table, [header] + rows)
            doc.add_paragraph()
            i = j
            continue

        # 分隔线
        if re.fullmatch(r"-{3,}", stripped):
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            r = p.add_run("─" * 46)
            r.font.color.rgb = RGBColor(0xBB, 0xBB, 0xBB)
            i += 1
            continue

        # 标题
        m = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if m:
            level = len(m.group(1))
            text = m.group(2).strip()
            h = doc.add_heading("", level=min(level, 4))
            add_inline(h, text)
            for r in h.runs:
                set_run_font(r, size=None)
            i += 1
            continue

        # 引用
        if stripped.startswith(">"):
            text = stripped.lstrip(">").strip()
            if text:
                p = doc.add_paragraph(style="Intense Quote")
                add_inline(p, text)
                for r in p.runs:
                    set_run_font(r, size=Pt(10))
            i += 1
            continue

        # 列表
        m = re.match(r"^(\s*)([-*+]|\d+\.)\s+(.*)$", line)
        if m:
            indent = len(m.group(1))
            text = m.group(3)
            if m.group(2).endswith("."):
                style = "List Number" if indent < 2 else "List Number 2"
            else:
                style = "List Bullet" if indent < 2 else "List Bullet 2"
            try:
                p = doc.add_paragraph(style=style)
            except KeyError:
                p = doc.add_paragraph(style="List Bullet")
            p.paragraph_format.space_after = Pt(2)
            add_inline(p, text)
            i += 1
            continue

        p = doc.add_paragraph()
        add_inline(p, stripped)
        i += 1

    doc.save(OUT)
    print("saved:", OUT)


if __name__ == "__main__":
    main()
