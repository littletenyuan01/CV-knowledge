# CV-knowledge

计算机视觉知识库。内容以「图文 + 可交互演示」的静态网页为主，直接双击 HTML 即可阅读。

## 内容索引

| 目录 / 文件 | 内容 | 形式 |
|---|---|---|
| [`deep-learning-frameworks/rcnn/`](deep-learning-frameworks/rcnn/) | **R-CNN 逐步详解**：六步流程逐步拆解（候选区域 → 归一化 → CNN 特征 → SVM → 边框回归 → NMS），含 9 个交互演示、完整超参与复现代码 | 交互式 HTML |
| [`deep-learning-frameworks/isp/`](deep-learning-frameworks/isp/) | **ISP 管线逐步详解**：从光子到 YUV 的完整链路（BLC / LSC / DPCC / 去马赛克 / AWB / CCM / Gamma / YUV / 3A），含 6 个交互演示（Bayer 采样、噪声模型、三种去马赛克对比、白平衡、gamma 与位深、逐级跳过对比） | 交互式 HTML |
| [`deep-learning-frameworks/README.md`](deep-learning-frameworks/README.md) | 该知识库的目录说明与自检方法 | Markdown |
| [`图像处理面试150题.md`](图像处理面试150题.md) · [`.docx`](图像处理面试150题.docx) | 图像处理面试题集 | Markdown / Word |
| [`interview-questions/`](interview-questions/) | **岗位面试题（按简历技能分六个专题，共 501 题）**，每题含考察点、参考答案、追问、坑点，每份末尾有「快问快答」区：<br>[`01`](interview-questions/01-cpp-python.md) C++ & Python｜[`02`](interview-questions/02-pytorch.md) PyTorch｜[`03`](interview-questions/03-opencv-isp.md) OpenCV & ISP/3A｜[`04`](interview-questions/04-cnn-transformer.md) CNN & Transformer & 检测｜[`05`](interview-questions/05-ai-coding.md) AI 辅助编程｜[`06`](interview-questions/06-camera-scenarios.md) 场景题（手机相机 / 修图） | Markdown |
| [`tools/`](tools/) | Markdown → Word 转换流水线（md2docx 等） | Python |

## 怎么开始

- **想搞懂 R-CNN 的每一步** → 打开 [`deep-learning-frameworks/rcnn/index.html`](deep-learning-frameworks/rcnn/index.html)，
  从候选框生成一路读到 NMS，每一步都有公式、超参、耗时数据与可以动手拖的演示。
- **想搞懂相机怎么把 RAW 变成图** → 打开 [`deep-learning-frameworks/isp/index.html`](deep-learning-frameworks/isp/index.html)，
  从光子打到像素开始，经黑电平/暗角/坏点校正、去马赛克、白平衡、CCM、Gamma 一直到 YUV，配 6 个可交互演示。
- **想看完整目录** → 打开 [`deep-learning-frameworks/README.md`](deep-learning-frameworks/README.md)。

所有网页均为纯静态、零外部依赖（不加载任何 CDN 资源），可以离线打开，也可以直接拷给别人。


