# CV-knowledge — 工程事实卡片

计算机视觉知识库，**产出为教学材料而非软件**。

## 结构

`deep-learning-frameworks/rcnn/`（R-CNN 逐步详解，交互式 HTML）｜`deep-learning-frameworks/README.md`（目录说明与自检方法）｜`图像处理面试150题.md` / `.docx`｜`tools/`（Markdown → Word 流水线：`md2docx.py`、`run_docx_pipeline.py`）｜`README.md`（总索引表）

## 硬性约定

1. 网页**纯静态、零外部依赖**：不引用任何 CDN 或网络资源，必须能离线双击打开
2. 内容要**图文并茂 + 可交互**（这是本知识库的价值所在），不要产出纯文字长文
3. 中文输出
4. 新增内容后**同步更新 `README.md` 索引表**
5. 需要 Word 版时**复用 `tools/` 的转换管线**，不要另造

## 落点

- 新知识点 → `deep-learning-frameworks/<主题>/`，沿用 `rcnn/` 的组织方式（`index.html` + 资源）
- 配图资源 → 主题目录下的 `assets/`
- 纯文字笔记 → 工作区根目录或对应子目录

## 质量底线（本工程事实性优先于省钱）

每个技术断言可追溯到出处（官方文档 / 原始论文 / 标准 / 经典教材）并标注引用；「有出处的事实」与「自己的推演」显式区分；图表坐标、方向、索引基准（0-based/1-based）、单位必须与正文一致；有争议的内容标注"存疑/未定论"。
