# 专题二 · PyTorch 原理与实战

> 对应简历：「掌握 pytorch 框架，熟悉训练循环，模型推理等流程」。
> 面试官的套路通常是：**先问一个概念（autograd 怎么工作）→ 再问一个现象（为什么 loss 不降 / 显存爆了）→ 最后问工程（多卡怎么训、怎么部署）**。本专题按这条链路组织。
>
> 其他专题：`01-cpp-python.md`、`03-opencv-isp.md`、`04-cnn-transformer.md`、`05-ai-coding.md`（待产出）。

**难度/频率标记**同专题一。标 **〔版本相关〕** 的结论指 PyTorch 2.x 的实际行为，答的时候带上版本限定词。

| 分块 | 题号 | 题数 | 形态 |
|---|---|---|---|
| A. Tensor 与 autograd | Q1–Q10 | 10 | 四段式 |
| B. 训练循环与优化 | Q11–Q20 | 10 | 四段式 |
| C. 数据、显存与性能 | Q21–Q28 | 8 | 四段式 |
| D. 分布式训练与推理部署 | Q29–Q36 | 8 | 四段式 |
| **G. 快问快答** | Q37–Q81 | **45** | 一题一行，面试前扫读 |
| **H. 深挖题** | Q82–Q87 | **6** | 四段式（量化/ONNX/hook/检查点/通信/流式） |
| **合计** | | **87** | |

---

# A. Tensor 与 autograd

## Q1. 用一句话讲清 autograd 是怎么工作的？★★☆ 高频

**参考答案**

**动态图 + 反向拓扑遍历**：每次对 `requires_grad=True` 的张量做运算，PyTorch 就在后台记一个"节点"（`grad_fn`），把所有运算连成一张**有向无环图（DAG）**。调 `loss.backward()` 时，从 `loss` 出发**按拓扑序反向**走一遍，用链式法则把梯度累加到每个叶子张量的 `.grad` 上，然后把中间图**释放**。

```text
前向（构建图）                          反向（遍历图）

x(leaf, req_grad=True)                  ∂L/∂x  += ∂L/∂y · ∂y/∂x
   │  y = x * 2   [MulBackward0]            ▲
   ▼                                        │
y ──► z = y + b  [AddBackward0]         按拓扑序反向，从 L 开始
   │                                        │
   ▼                                        ▼
L = z.sum()      [SumBackward0]        L.backward() 一次即销毁图
```

**几个必须说到的细节**：

1. **只有叶子张量**（用户创建的、`is_leaf=True`）的 `.grad` 会被保留；中间结果的 `.grad` 默认不保存（除非 `retain_grad()`）。
2. **梯度是累加的**，不是覆盖的——这是 `zero_grad()` 存在的原因（Q12）。
3. **图是动态的**：每次前向都重新建，所以可以写 `if`/循环（这是相对 TF1 静态图的核心优势）。
4. **图在 `backward()` 后释放**，再 backward 会报 `Trying to backward through the graph a second time`（要 `retain_graph=True`）。

**追问**：*为什么 `loss` 必须是标量？* `backward()` 无参时要求输出是 1 元素张量（标量），因为它要算"标量对张量的梯度"；非标量要传 `gradient=` 指定上游梯度（等价于 `torch.autograd.backward(y, v)`，算的是 `vᵀ·J`）。

**出处**：<https://pytorch.org/docs/stable/notes/autograd.html>

---

## Q2. `requires_grad`、`detach()`、`no_grad()`、`inference_mode()` 的区别？★★★ 高频

**参考答案**

| 手段 | 效果 | 典型场景 |
|---|---|---|
| `requires_grad=False`（张量属性） | 该张量不追踪梯度，**新建**的图不再经过它 | 冻结某些层（但通常配合 `param.requires_grad_(False)`） |
| `.detach()` | 返回**共享同一份存储**、但从图上"摘下来"的新张量 | 取 target、日志里存 loss、GAN 里 detach 生成结果 |
| `torch.no_grad()` | 上下文内**所有**运算不建图 | 推理、验证、更新参数时的 `optimizer.step()` |
| `torch.inference_mode()` | 比 `no_grad` **更彻底**：连版本计数（version counter）都不维护 | 纯推理，**更快**；但产出的张量不能再参与需要梯度的运算 |

```python
with torch.no_grad():
    pred = model(x)            # 不建图，省显存

with torch.inference_mode():   # 推理专用，进一步省掉 autograd 元数据
    pred = model(x)
```

**关键区分**：`no_grad` 只是"不记录"，产出的张量仍然能用于后续需要梯度的计算（只是它自己是常量）；`inference_mode` 产出的张量是"推理张量"，后续拿去做需要梯度的运算会报错。所以 `inference_mode` 只放在**推理入口**，不要用在训练循环的验证分支里（除非确定后面不再建图）。

**坑**：`model.eval()` **不等于** `torch.no_grad()`。`eval()` 只切换 BN/Dropout 的行为，**梯度照算、图照建**——验证时忘写 `no_grad` 是显存泄漏的常见原因（Q20）。

**追问**：*为什么 `optimizer.step()` 要包在 `no_grad` 里？* 参数更新是原地操作，如果被记录进图，下一次 backward 会报"变量被 in-place 修改"（Q5）。PyTorch 的 `step()` 内部已经用 `no_grad` 包好了，手写 SGD 时要注意。

**出处**：<https://pytorch.org/docs/stable/generated/torch.no_grad.html>；<https://pytorch.org/docs/stable/generated/torch.inference_mode.html>

---

## Q3. `optimizer.zero_grad()` 为什么必须调？`set_to_none=True` 有什么区别？★★☆ 高频

**参考答案**

PyTorch 的梯度是**累加**进 `.grad` 的（`p.grad += new_grad`），不是覆盖。不清零就直接 `backward()`，梯度会跨 step 越加越大 → loss 爆炸（或你想要的梯度累积被搞乱）。

```python
for x, y in loader:
    optimizer.zero_grad()        # 或 zero_grad(set_to_none=True)（2.0 起默认）
    loss = criterion(model(x), y)
    loss.backward()
    optimizer.step()
```

**`set_to_none=True`**（PyTorch 2.0 起为默认）：把 `p.grad` 置为 `None` 而不是填 0。好处：

1. **省内存**：不必为每个参数保留一块梯度缓冲（对 7B 模型是 GB 级）。
2. **省时间**：省掉一次 `memset`。
3. 有些优化器/稀疏场景会跳过"无梯度"的参数（`grad is None`）。

代价：如果你的代码里有 `p.grad.data.zero_()` 这种假设 grad 非空的写法会崩。

**追问**

- *梯度累积（小显存模拟大 batch）怎么写？* 见 Q13。
- *只想清部分参数的梯度？* 手动遍历 `p.grad = None`；或不同参数组分开优化。
- *为什么 `zero_grad` 要在 `backward` 前？* 顺序无关（只要在 backward 前），但放前面最清晰。

**出处**：<https://pytorch.org/docs/stable/generated/torch.optim.Optimizer.zero_grad.html>

---

## Q4. `optimizer.step()` 和 `scheduler.step()` 的调用顺序？★★☆

**参考答案**

**标准顺序**：`zero_grad → forward → loss → backward → (clip) → optimizer.step() → scheduler.step()`。

**必须遵守的两条**：

1. **`optimizer.step()` 在 `scheduler.step()` 之前**。因为大多数 scheduler（`StepLR`、`CosineAnnealingLR`）是按"已走完的 epoch/step"来计算新学习率的，先更新参数再降 lr 才符合"第 1 个 epoch 用初始 lr"的直觉。（`ReduceLROnPlateau` 例外——它要看本轮的 metric，所以放在验证之后。）
2. **`scheduler.step()` 每 epoch 一次还是每 step 一次，要和 scheduler 类型匹配**：`StepLR(step_size=30)` 通常是 **epoch 级**；`OneCycleLR`、`CosineAnnealingLR(T_max=total_steps)` 是 **step 级**。搞错会让 lr 曲线差一个数量级（这是很多人"复现不了"的原因）。

```python
for epoch in range(EPOCHS):
    for x, y in train_loader:
        optimizer.zero_grad(set_to_none=True)
        loss = criterion(model(x), y)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        scheduler.step()          # ← 若是 step 级 scheduler
    val_loss = validate(model)
    plateau_sched.step(val_loss)  # ← 若是 ReduceLROnPlateau
```

**追问**：*怎么确认 lr 真的在变？* `scheduler.get_last_lr()` 或 `optimizer.param_groups[0]['lr']`，打到 tensorboard 上看曲线——比读文档可靠。

**出处**：<https://pytorch.org/docs/stable/optim.html#how-to-adjust-learning-rate>

---

## Q5. 为什么会出现 "a leaf Variable that requires grad is being used in an in-place operation" 或 "one of the variables needed for gradient computation has been modified by an inplace operation"？★★★

**参考答案**

反向传播需要**前向时的中间值**。如果你在 forward 之后**原地改**了某个参与过计算、且反向要用的张量，反向时拿到的就是被改过的值 → 算错，所以 PyTorch 用**版本计数（version counter）**检测到就报错。

```python
x = torch.randn(3, requires_grad=True)
y = x * 2
y += 1                     # 原地改 y，但 y 由 mul 产生 → 报错
# RuntimeError: a leaf Variable that requires grad is being used in an in-place operation.
#（若 y 不是叶子，则是 "modified by an inplace operation"）
```

**常见触发场景**：

1. `loss += aux_loss`（改成 `loss = loss + aux_loss`）；
2. 对模型输出 `out.clamp_(min=0)`、`out.relu_()`、`tensor[mask] = 0`；
3. 手写优化器时没包 `no_grad`；
4. 复用同一个张量做多次前向（第二次就地更新）。

**修法**：改成非原地版本（`clamp`、`relu`、`+`），或把不需要梯度的部分 `detach()`/放进 `no_grad`。

**追问**：*哪些原地操作是安全的？* 对**叶子且 `requires_grad=True`** 的参数做原地更新是被明确禁止的（`param.data.add_()` 这种绕过方式不推荐，会破坏 autograd 的版本追踪）；用 `optimizer.step()` 内部的 `no_grad` 上下文才是正解。

**出处**：<https://pytorch.org/docs/stable/notes/autograd.html#in-place-operations-on-variables>

---

## Q6. `view`、`reshape`、`permute`、`contiguous` 的关系？★★☆ 高频

**参考答案**

- **`view`**：只改**元信息**（shape/stride），**要求内存连续**（或至少能表达为同一块连续内存的视图），否则报 `view size is not compatible with input tensor's size and stride`。
- **`reshape`**：能 view 就 view，不能就先**拷贝**再 view——**"容错版 view"**，但不保证共享内存。
- **`permute`/`transpose`**：只交换 stride 的维度顺序，**内存布局不变**，所以结果通常**非连续**。
- **`contiguous()`**：若已连续则原样返回（无拷贝），否则**真正重排内存**。

```python
x = torch.randn(2, 3, 4)
x.permute(0, 2, 1).is_contiguous()   # False（只改了 stride）
x.permute(0, 2, 1).reshape(-1)       # 能跑（内部先 contiguous）
x.permute(0, 2, 1).view(-1)          # RuntimeError
x.view(-1).shape                     # torch.Size([24])  ← x 本身连续，可以 view
```

**为什么性能上要关心**：非连续张量在 kernel 里访存不友好（甚至要额外拷贝）。CNN 里 `x.permute(0,2,3,1)`（NCHW→NHWC）之后接 `channels_last` 模型或 `cudnn` 时，如果布局不对会触发隐式拷贝。

**追问**

- *`x[0]` 是 view 还是拷贝？* 基本切片是 view（共享内存）；**高级索引**（`x[[0,2]]`、布尔掩码）是拷贝。
- *内存会因此碎片化吗？* `contiguous()` 分配新块，旧的交给 caching allocator 复用，通常不会真的还给 OS。

**出处**：<https://pytorch.org/docs/stable/tensor_view.html>

---

## Q7. 广播（broadcasting）规则？它会带来什么隐蔽问题？★★☆

**参考答案**

从**尾部维度**开始逐维比较，兼容条件是：**两维相等，或其中一维为 1，或其中一维缺失**。不满足就报错。

```python
a = torch.randn(8, 1, 5)
b = torch.randn(   3, 5)      # 缺失维度视为 1
(a + b).shape                 # (8, 3, 5)
```

**隐蔽问题**（CV 里天天踩）：

1. **意外的内存放大**：`(N,1,H,W) + (N,H,W)` 的理解错误会静默算出错的 shape，不报错。
2. **`unsqueeze` 漏了 → 语义错**：做 per-channel 归一化时写成 `(N,C,H,W) * (C,)` 是**对的**（广播到最后一维必须是 C），但如果写成 `(N,C,H,W) * (N,C)` 就完全错位——它会把 `C` 对齐到 `W`。
3. **损失里 `mean` 的维度搞错**：`loss.sum()/N` 与 `loss.mean(dim=...)` 差异被广播悄悄吃掉。

**自查习惯**：关键张量做运算前后 `print(shape)`，或用 `torch.einsum` 显式写清维度语义。

**追问**：*怎么关掉广播？* 没有全局开关；用 `torch.broadcast_tensors` 显式展开，或断言 shape 相等。

**出处**：<https://pytorch.org/docs/stable/notes/broadcasting.html>

---

## Q8. `model.train()` 和 `model.eval()` 到底改了什么？★★★ 高频

**参考答案**

只切换**模块的 `self.training` 标志**，进而影响**行为依赖该标志的层**，主要是：

1. **Dropout**：train 时按概率置零并缩放（`1/(1-p)`），eval 时**直通**。
2. **BatchNorm**：train 时用**当前 batch 的均值/方差**归一化，并更新 `running_mean/running_var`；eval 时用 **running 统计量**，且**不更新**。
3. 其他：`InstanceNorm(track_running_stats=False)` 无影响；自定义层里 `if self.training:` 的分支。

```python
model.eval()
with torch.no_grad():
    pred = model(x)      # BN 用 running stats，Dropout 关闭
```

**三个高频追问**（答全了才叫会）：

- *eval 后忘了调回 train 会怎样？* 下一轮训练 BN 继续用 running stats 且不更新 → 训练/推理不一致、精度掉。
- *BN 的 `momentum` 是什么？* 是 running 统计的**滑动平均系数**：`running = (1-m)*running + m*batch_stat`，默认 **0.1**。注意它和优化器的 momentum **不是一回事**。
- *小 batch 下为什么 BN 崩？* batch=1 时 batch 方差为 0/无意义，running 统计也被污染 → 换 **GroupNorm / LayerNorm**（检测/分割小 batch 的标配），或用 `SyncBN`（Q32）。

**出处**：<https://pytorch.org/docs/stable/generated/torch.nn.Module.html#torch.nn.Module.train>

---

## Q9. 梯度消失/爆炸怎么诊断、怎么处理？★★☆（CV 岗高频）

**参考答案**

**诊断**：打印/记录每层的 `p.grad.norm()`。健康的网络里各层梯度量级接近；如果前面几层梯度是 `1e-8` 或 `1e8`，就是它。

```python
for n, p in model.named_parameters():
    if p.grad is not None:
        writer.add_scalar(f"grad/{n}", p.grad.norm(), step)
```

**处理**（按性价比排序）：

1. **归一化层**（BN/LN/GN）——最基本。
2. **残差连接**——给梯度一条"高速公路"。
3. **合适的初始化**：`kaiming_normal_`（ReLU）、`xavier_normal_`（tanh/sigmoid）；别用默认的均匀分布糊过去。
4. **梯度裁剪**：`clip_grad_norm_(params, max_norm)`（RNN/Transformer 必备，裁剪的是**全局范数**不是逐元素）。
5. **降学习率 / warmup**——前几百 step 用线性 warmup，Transformer 训练的标配。
6. **激活函数**：ReLU→GELU/SiLU，或换 `LayerNorm` 位置（Pre-LN，比 Post-LN 稳）。
7. **混合精度**：fp16 溢出会变成 inf/nan，用 `GradScaler`（Q26）。

**追问**：*`clip_grad_norm_` 的返回值是什么？* 裁剪**前**的总范数——正好可以拿来监控爆炸。

**出处**：<https://pytorch.org/docs/stable/generated/torch.nn.utils.clip_grad_norm_.html>

---

## Q10. 如何冻结部分层做微调？冻结后要注意什么？★★☆

**参考答案**

```python
# 方式一：只关 requires_grad（参数仍在 optimizer 里，但梯度为 None）
for name, p in model.named_parameters():
    if name.startswith("backbone."):
        p.requires_grad_(False)

# 方式二（更推荐）：只把要训的参数交给 optimizer
trainable = [p for n, p in model.named_parameters() if not n.startswith("backbone.")]
optimizer = torch.optim.AdamW(trainable, lr=1e-4)
```

**注意事项**：

1. **BN 层**：`requires_grad=False` **不会**阻止 BN 更新 running stats！要真正冻结就把整个 backbone 设 `eval()`，并重写 `train()` 保持它 eval，否则统计量漂移、小 batch 下尤其明显。
2. **优化器状态**：先设 `requires_grad`，再建 optimizer，否则被冻结参数仍占优化器状态内存。
3. **学习率分层**：backbone 用小 lr（1e-5），head 用大 lr（1e-3），用 `param_groups` 实现。
4. **冻结层的 `no_grad` 优化**：如果 backbone 完全冻结，用 `with torch.no_grad(): feat = backbone(x)` 再 `feat` 送 head，能省掉 backbone 的反向显存（但**开头几层仍需图**的情况要小心）。

```python
optimizer = torch.optim.AdamW([
    {"params": backbone_params, "lr": 1e-5},
    {"params": head_params,     "lr": 1e-3},
], weight_decay=1e-4)
```

**追问**：*冻结后 `optimizer.step()` 会更新被冻结参数吗？* 如果它们还在 `param_groups` 里，`grad` 为 `None` 时优化器会跳过（Adam 不会累加状态），但仍占内存 → 方式二更干净。

---

# B. 训练循环与优化

## Q11. 手写一个完整的训练循环（含验证），要包含哪些要素？★★★ 高频（现场写代码）

**参考答案**

```python
import torch
from torch.utils.data import DataLoader

def train_one_epoch(model, loader, optimizer, criterion, scaler, device, epoch, scheduler=None):
    model.train()
    total_loss, correct, seen = 0.0, 0, 0
    for step, (x, y) in enumerate(loader):
        x = x.to(device, non_blocking=True)
        y = y.to(device, non_blocking=True)

        optimizer.zero_grad(set_to_none=True)
        with torch.autocast(device_type="cuda", dtype=torch.float16):   # AMP
            logits = model(x)
            loss = criterion(logits, y)

        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)                       # 裁剪前要反缩放
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(optimizer)
        scaler.update()

        if scheduler is not None and is_step_level(scheduler):
            scheduler.step()

        total_loss += loss.item() * x.size(0)
        correct += (logits.argmax(1) == y).sum().item()
        seen += x.size(0)

    return total_loss / seen, correct / seen


@torch.no_grad()
def evaluate(model, loader, criterion, device):
    model.eval()                                          # 关键：切 BN/Dropout
    total_loss, correct, seen = 0.0, 0, 0
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        logits = model(x)
        total_loss += criterion(logits, y).item() * x.size(0)
        correct += (logits.argmax(1) == y).sum().item()
        seen += x.size(0)
    return total_loss / seen, correct / seen
```

**必须说到的点**（面试官在数你漏了几个）：

1. `model.train()` / `model.eval()` 成对；
2. `zero_grad(set_to_none=True)`；
3. AMP 的 `autocast` + `GradScaler` 配套，**裁剪前 `unscale_`**；
4. 损失累加用 `loss.item() * batch_size`（正确算**样本加权平均**，不是简单平均 batch loss——最后一个小 batch 会偏）；
5. 验证用 `@torch.no_grad()`；
6. `scheduler` 的 step 频率与类型匹配；
7. 指标统计用 `.item()`（会同步 GPU，别在循环里频繁调，见 Q27）。

**追问**

- *为什么 `total_loss += loss.item() * x.size(0)`？* 如果直接 `+= loss.item()` 再除以 batch 数，当最后一个 batch 不满时会引入偏差；按样本数加权才对。
- *训练日志里为什么要记 lr？* 复现问题时第一眼看的就是 lr 曲线。

---

## Q12. 超参怎么设？batch size、lr、weight decay、warmup 之间的经验关系？★★☆

**参考答案**（这题没有标准答案，考的是"有没有形成自己的方法"）

**优先级**：先定 batch size（受显存限制）→ 再定 lr（与 batch 相关）→ 最后调 wd / warmup / 数据增强。

| 超参 | 常用起点 | 说明 |
|---|---|---|
| batch size | 32/64（分类）、2–8（检测/分割） | 越大越稳、BN 越准，但泛化可能变差；小 batch 用 GN/BN-Freeze |
| lr（AdamW） | **1e-4 ~ 3e-4**（head），backbone 1e-5 | 线性缩放规则：batch ×2 → lr ×2（有上限） |
| lr（SGD） | 0.01 ~ 0.1，momentum 0.9 | 大 batch 用 LARS/LAMB |
| weight decay | 1e-4（AdamW）/ 5e-4（SGD） | **AdamW 的 wd 是解耦的**，不要用 Adam + wd |
| warmup | 总 step 的 1%–5% | Transformer 必备，CNN 也常加 |
| 数据增强 | 先上轻量的（翻转/裁剪/颜色抖动） | 过强会欠拟合，看训练/验证 loss 差值判断 |

**判断过拟合/欠拟合**（面试常追问）：

- train loss 低、val loss 高 → 过拟合：加增强、加 wd、降容量、early stopping。
- 两个都高 → 欠拟合：加容量、加 epoch、升 lr、检查数据/标签。
- train loss 剧烈震荡 → lr 太大或 batch 太小。

**追问**：*Adam 和 AdamW 的区别？* Adam 的 weight decay 混在梯度里（和 lr 耦合，等效 L2 正则）；AdamW 把它**解耦**成 `p -= lr * wd * p`，正则效果更符合预期，是现在训练 ViT/检测器的默认选择。

**出处**：<https://pytorch.org/docs/stable/generated/torch.optim.AdamW.html>；Loshchilov & Hutter, *Decoupled Weight Decay Regularization*, ICLR 2019。

---

## Q13. 显存不够，怎么用梯度累积模拟大 batch？有什么坑？★★★

**参考答案**

把一个大 batch 拆成 `k` 个 micro-batch，**梯度累加 k 次再 step 一次**。

```python
ACCUM = 4                     # 等效 batch = batch_size * ACCUM
optimizer.zero_grad(set_to_none=True)
for i, (x, y) in enumerate(loader):
    with torch.autocast("cuda", torch.float16):
        loss = criterion(model(x), y) / ACCUM     # ← 关键：除以累积步数
    scaler.scale(loss).backward()                  # 只累加，不 step
    if (i + 1) % ACCUM == 0:
        scaler.unscale_(optimizer)
        clip_grad_norm_(model.parameters(), 1.0)   # ← 只在真正 step 前裁一次
        scaler.step(optimizer)
        scaler.update()
        optimizer.zero_grad(set_to_none=True)
```

**四个坑**：

1. **loss 要除以 `ACCUM`**，否则梯度是 k 倍（等效 lr 放大 k 倍）。
2. **BN 统计量仍然按 micro-batch 算**——梯度累积**不等价**于真的大 batch（BN 层面）。要等效就得用 `SyncBN` 或换 GN。
3. **`clip_grad_norm_` 一次一次` 只在 step 前做**，别每个 micro-batch 都裁（那会把累积过程截断）。
4. **学习率**：有效 batch 变大后，lr 是否要按线性规则放大？一般**不用**（因为累积是为了凑显存，不是真的要更大 batch 的行为）。

**追问**：*和 DDP 一起用？* 可以，但注意 DDP 的梯度同步发生在 `backward()` 里（Q30），累积时会**每个 micro-batch 都 allreduce 一次** → 通信翻倍。解法是 `no_sync()` 上下文包住前面的累积步。

**出处**：<https://pytorch.org/docs/stable/notes/amp_examples.html#gradient-accumulation>

---

## Q14. `state_dict` 里有什么？`load_state_dict` 的 `strict` 参数？断点续训怎么存？★★★

**参考答案**

`model.state_dict()` 是 **`OrderedDict[str, Tensor]`**，只含**参数和缓冲区**（如 BN 的 `running_mean`、`num_batches_tracked`），**不含**结构定义、不含优化器状态。

```python
ckpt = {
    "epoch": epoch,
    "model": model.state_dict(),
    "optimizer": optimizer.state_dict(),     # 含 Adam 的 exp_avg / step
    "scheduler": scheduler.state_dict(),
    "scaler": scaler.state_dict(),           # AMP 的 scale
    "best_metric": best,
    "rng": {"torch": torch.get_rng_state(), "cuda": torch.cuda.get_rng_state_all()},
}
torch.save(ckpt, f"ckpt_ep{epoch}.pt")
```

**`strict=True`（默认）**：键集合必须**完全一致**，多一个少一个都报错。加载预训练权重时常常要 `strict=False`（骨干多了/少了分类头），但**必须**检查返回的两个列表：

```python
missing, unexpected = model.load_state_dict(ckpt["model"], strict=False)
print("missing:", missing)       # 模型有、权重没有 → 随机初始化（小心！）
print("unexpected:", unexpected) # 权重有、模型没有 → 白加载
```

**追问**

- *为什么不存整个 model（`torch.save(model)`）？* 它 pickle 了类定义，换目录/改代码就加载失败，且不安全（反序列化可执行代码）。**只存 state_dict**。
- *只存参数不存优化器会怎样？* 续训时 Adam 的动量全丢，loss 会先抖一下再恢复——不算错，但严格复现要求全存。
- *多卡训、单卡加载？* 键名带 `module.` 前缀（DDP）或 `_orig_mod.`（`torch.compile`），加载前要重命名：

```python
sd = {k.replace("module.", ""): v for k, v in sd.items()}
```

**出处**：<https://pytorch.org/tutorials/recipes/recipes/saving_and_loading_a_general_checkpoint.html>

---

## Q15. `Dataset` 和 `DataLoader` 怎么配合？`__getitem__` 里该做什么、不该做什么？★★☆

**参考答案**

```python
class MyDataset(Dataset):
    def __init__(self, root, transform=None):
        self.samples = [...]          # 只放索引/路径，不要在这里读全部图片
        self.transform = transform
    def __len__(self): return len(self.samples)
    def __getitem__(self, i):
        img = cv2.imread(self.samples[i])          # 1. 读（IO 密集）
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        if self.transform: img = self.transform(img)
        return img, label                           # 2. 返回单样本
```

`DataLoader` 负责：**batching（`collate_fn`）、打乱（`sampler`）、多进程（`num_workers`）、预取（`prefetch_factor`）、锁页内存（`pin_memory`）**。

```python
loader = DataLoader(ds, batch_size=32, shuffle=True, num_workers=8,
                    pin_memory=True, persistent_workers=True,
                    prefetch_factor=4, drop_last=True, collate_fn=my_collate)
```

**`__getitem__` 里该做**：读图、解码、几何/颜色增强、归一化、`ToTensor`。**不该做**：建模型、开 CUDA（worker 里不能碰 CUDA 张量）、`torch.cuda.*` 任何调用、全局可变状态。

**追问**

- *为什么要 `pin_memory=True`？* 锁页（pinned）内存能异步 DMA 到 GPU：配合 `.to(device, non_blocking=True)` 才能让拷贝和计算重叠。不开 pin 的话 `non_blocking` 基本无效。
- *`num_workers` 设多少？* 经验是 CPU 核数的 50%–100%，但要看**解码开销**（大图 JPEG 解码很吃 CPU）。太多反而因进程切换和内存翻倍变慢。
- *`persistent_workers=True` 干什么？* epoch 之间不销毁 worker（省掉每轮重新 fork/初始化的开销），数据量大时明显。
- *Windows/调试时的坑？* `num_workers>0` 需要 `if __name__ == "__main__"` 保护；调试时先设 0 拿完整 traceback。

**出处**：<https://pytorch.org/docs/stable/data.html>

---

## Q16. `collate_fn` 什么时候必须自定义？★★☆（检测/分割岗必问）

**参考答案**

默认 `collate_fn` 用 `torch.stack` 拼 batch，要求**所有样本 shape 完全一致**。以下情况必须自定义：

1. **变长目标**（检测/分割）：每张图的目标框数量不同 → 不能 stack 成 `(B, N, 5)`。
2. **多尺度训练**：图尺寸不同。
3. **返回字典/自定义结构**（如 `{"image":..., "boxes":..., "masks":...}`）。

```python
def collate(batch):
    imgs = torch.stack([b[0] for b in batch])        # 图像已 resize 成同尺寸
    targets = [b[1] for b in batch]                  # list[Tensor]，长度不一
    return imgs, targets
```

检测框架（DETR / YOLO / MMDetection）里，`targets` 一般是 **`list[dict]`**，长度 = batch size，每个 dict 里是该图的 `boxes/labels`。

**追问**

- *为什么不能 pad 成 `(B, Nmax, 5)`？* 可以，但需要 mask 告诉 loss 哪些是 padding，容易出错；`list[dict]` 更直接，代价是 loss 里要循环。
- *`num_workers>0` 时 `collate_fn` 在哪个进程跑？* 在**主进程**（worker 只产出单样本），所以别在里面做重计算。

**出处**：<https://pytorch.org/docs/stable/data.html#dataloader-collate-fn>

---

## Q17. 损失函数：`CrossEntropyLoss` 的输入该是什么？`reduction` 怎么选？类别不平衡怎么办？★★☆

**参考答案**

`nn.CrossEntropyLoss` **内部已经包含 `log_softmax` + `NLLLoss`**，所以模型输出要送**原始 logits**，不能再接 softmax（双重 softmax 是经典错误，表现为 loss 卡在某个值不降）。

```python
criterion = nn.CrossEntropyLoss()               # 默认 reduction='mean'
logits = model(x)                                # (N, C) 未归一化
loss = criterion(logits, y)                      # y: (N,) LongTensor，类别索引
```

- `reduction='mean'`：按样本平均（默认）；
- `reduction='sum'`：求和（配合梯度累积时自己除以总数，语义更清楚）；
- `reduction='none'`：逐样本，用于**加权/难例挖掘/自定义**。

**类别不平衡**（工业检测缺陷样本少，必问）：

1. `class_weight`：`CrossEntropyLoss(weight=torch.tensor([1., 10., 50.]))`。
2. **Focal Loss**（检测正负样本极度不平衡的标配）。
3. 重采样：`WeightedRandomSampler`、过采样少数类、欠采样多数类。
4. 阈值调优：**不要再优化 accuracy**，用 per-class recall / F1 / PR-AUC。

**追问**：*二分类用 `BCEWithLogitsLoss` 还是 `CrossEntropyLoss`？* 单输出用 `BCEWithLogitsLoss`（自带 sigmoid，别自己加），双输出用 CE；`BCEWithLogitsLoss` 支持 `pos_weight` 做不平衡加权，数值比 `sigmoid+BCE` 稳。

**出处**：<https://pytorch.org/docs/stable/generated/torch.nn.CrossEntropyLoss.html>

---

## Q18. `torch.compile` / `torch.jit` 了解吗？什么时候用？★★☆（加分）

**参考答案**

- **`torch.compile`（2.0+）**：一行包装，用 TorchDynamo 抓图 + 后端（默认 inductor）融合 kernel、减少 Python 开销。加速常见于**小模型/高 Python 开销/Transformer**，大卷积模型可能只有 10–20%。代价：**首次编译耗时**、图断点（graph break）会让收益打折、报错信息难读。

```python
model = torch.compile(model, mode="max-autotune")   # 或 "reduce-overhead"
```

- **`torch.jit.trace`**：跑一遍记录算子，**只能处理纯张量控制流**；`if` 依赖张量值时会固化——静默错误。
- **`torch.jit.script`**：直接编译 Python 子集，**保留控制流**，但语法限制多。

**部署向选择**：真要上产线，通常走 **ONNX → TensorRT**（NVIDIA）或 ONNX Runtime / OpenVINO / ncnn，而不是 TorchScript（生态在退潮）。

**追问**：*`torch.compile` 用 `dynamic=True` 干什么？* 允许动态 shape（否则每个 shape 都重新编译一次）；变长输入（检测）必须开，或做好 shape 分桶。

**出处**：<https://pytorch.org/docs/stable/torch.compiler.html>；<https://pytorch.org/docs/stable/jit.html>

---

## Q19. 怎么保证训练可复现？★★☆

**参考答案**

```python
import random, numpy as np, torch

def seed_everything(seed=42):
    random.seed(seed); np.random.seed(seed)
    torch.manual_seed(seed); torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    torch.use_deterministic_algorithms(True, warn_only=True)
    os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"   # CUDA 10.2+ 必需
```

**别忘了这些**（漏一个就"不可复现"）：

1. `DataLoader` 的 worker 种子：`worker_init_fn` + `generator`；
2. **多卡下**顺序/通信：DDP 的 allreduce 本身是确定的，但 fp16 非确定性算子可能引入差异；
3. **原子累加的非确定性**：`index_add`、`scatter_add`、部分 cuDNN 算法、`torch.use_deterministic_algorithms` 就是管这个；
4. 混合精度 + 不同 GPU 型号：**跨卡型不可复现**（硬件不同）。

**权衡**：`deterministic=True` + `benchmark=False` 通常**慢 10%–30%**。做实验对比时开，冲榜/上线前关掉换速度。

**追问**：*`cudnn.benchmark=True` 干什么？* 首次运行自动搜索最快的卷积算法并缓存——**输入尺寸固定时**收益明显，尺寸变化时会反复搜索反而慢。

**出处**：<https://pytorch.org/docs/stable/notes/randomness.html>

---

## Q20. 训练时 loss 变成 NaN / inf，怎么排查？★★★ 高频（实战题）

**参考答案**

**按"从现象到根因"的排查顺序**：

1. **先定位第一次出现 NaN 的 step 和位置**：
   ```python
   torch.autograd.set_detect_anomaly(True)   # 变慢，但会指出是哪个前向算子的反向出 NaN
   for n, p in model.named_parameters():
       if p.grad is not None and not torch.isfinite(p.grad).all():
           print("bad grad:", n); break
   ```
2. **常见根因**（按概率排序）：
   - **lr 太大**（尤其换了大 batch 或从 fp32 切 fp16 后）；
   - **fp16 溢出**：`GradScaler` 会自动 skip 掉溢出的 step 并降 scale——如果它一直降，说明模型确实在溢出，换 **bf16**（动态范围大，不用 scaler）；
   - **除零**：`x / (std + eps)` 里 `std` 是算出来的且可能为 0；BN 的 `eps` 默认 1e-5 就是为这个；
   - `log(0)` / `sqrt(负数)`：focal loss 里的 `log(p)` 要 clip，`IoU` 分母要 `+eps`；
   - **输入里本来就有 NaN**：数据增强的插值、归一化的除零（`mean` 为 0）、GPU 上的空张量 `max()`；
   - **损失加权过大**：某些项 ×1000 后直接溢出。
3. **验证手段**：把 lr 降 10 倍重跑；关 AMP 用 fp32 重跑；单个 batch 重复前向看是否稳定；`torch.isfinite(loss)` 做断言早停。

**工业检测里最常见的两个真实原因**：① 归一化时除以了 0 方差（工业图像有大片纯色背景）；② 标签里有越界值（`ignore_index` 之外的 -1）导致 CE 算出 inf。

---

# C. 数据、显存与性能

## Q21. 显存都花在哪了？怎么估算、怎么省？★★★ 高频

**参考答案**

**显存构成**（训练时）：

```text
① 模型参数            P × 4 字节（fp32）
② 梯度                P × 4
③ 优化器状态          Adam: P × 8（exp_avg + exp_avg_sq，fp32）
④ 激活值（activation） 与 batch、分辨率、层数成正比 ← 通常是大头
⑤ 临时工作区 (workspace) cudnn 算法、通信缓冲
⑥ 碎片                caching allocator 保留不还
```

**估算公式**（Adam + fp32）：约 **`16 × P` 字节** 打底（参数 4 + 梯度 4 + 优化器 8），再加激活。以 ResNet-50（25.6M 参数）为例：约 **0.41 GB** 是参数+梯度+优化器，其余全是激活。所以"模型只有 100MB 却 OOM"很正常。

**省显存的手段**（性价比排序）：

1. **降 batch / 降分辨率**（最直接；降分辨率对检测小目标有副作用）；
2. **AMP 混合精度**（激活和部分运算减半，通常省 30%–50%）；
3. **梯度累积**（batch=1 也能训）；
4. **梯度检查点** `torch.utils.checkpoint.checkpoint`（用**重算**换显存，时间 +20%–30%）；
5. **冻结 backbone**（消掉它的激活和梯度）；
6. **换更省的优化器**：SGD（无状态）vs Adam；或用 8-bit Adam（bitsandbytes）；
7. **ZeRO / FSDP**（Q33 分片优化器状态）；
8. `torch.cuda.empty_cache()` 只在**真的需要**时调（频繁调反而碎片化）。

**追问**：*怎么确认瓶颈是激活而不是参数？* `torch.cuda.memory_allocated()` 在 forward 后、backward 后、step 后分别打点，涨幅最大的那段就是答案。

---

## Q22. `torch.cuda` 的显存统计接口怎么用？为什么 `nvidia-smi` 和 `memory_allocated` 对不上？★★☆

**参考答案**

```python
torch.cuda.memory_allocated()        # 当前张量实际占用（字节）
torch.cuda.max_memory_allocated()    # 峰值 ← OOM 排查看这个
torch.cuda.memory_reserved()         # caching allocator 向驱动申请的总量（含空闲缓存）
torch.cuda.memory_summary()          # 详细快照

torch.cuda.reset_peak_memory_stats() # 每个 step 前重置，看单 step 峰值
```

**对不上的原因**：PyTorch 用 **caching allocator**——释放张量时内存**不还给驱动**，而是留在自己的池子里给下次复用。于是 `reserved ≈ 峰值`，`nvidia-smi` 看到的是 reserved（甚至含 CUDA context 的几百 MB 开销），而 `allocated` 只是当前活跃张量。

**结论**：排查泄漏看 `allocated` 的**趋势**（是否随 step 单调上升）；判断"还能不能开更大 batch"看 `reserved` 和 `nvidia-smi`。

**追问**：*`empty_cache()` 什么时候有用？* 只在你**真的要把显存让给别的进程/框架**时（比如先训后推理、或跑别的库）；训练循环里调用会拖慢（下次又要向驱动申请）。

**出处**：<https://pytorch.org/docs/stable/notes/cuda.html#memory-management>

---

## Q23. 显存泄漏（OOM 随 step 增长）的常见原因？★★★

**参考答案**

按"最容易犯"排序：

1. **忘了 `no_grad` 做验证/推理**——每个 step 的图都还挂在某个张量上（Q2/Q8）。
2. **把 loss/输出存进 list 却没 detach**：`losses.append(loss)` 会**永久持有整张图**（包括所有激活）。正确：`losses.append(loss.item())` 或 `loss.detach()`。
3. **在 `__getitem__` 或训练循环里 `torch.cuda` 张量被 Python 容器长期持有**（缓存了 batch、把 tensor 塞进全局 dict）。
4. **`retain_graph=True` 忘了关**——图永不释放。
5. **自定义 `autograd.Function` 在 `forward` 里存了输入**（要用 `ctx.save_for_backward`，而不是 `ctx.x = x` 持有非叶子引用）。
6. **`torch.cuda.empty_cache()` 治标**：它只清缓存，真泄漏照旧增长——看到"越跑越涨"先别急着 empty_cache。
7. **多进程 DataLoader 的 worker 泄漏**：worker 里异常没退出，`persistent_workers` + 长训练时进程堆积。

**排查手法**：每隔 N step 打 `max_memory_allocated`；用 `torch.cuda.memory_snapshot()` 看是谁占的（能给出分配栈）；或 `gc.collect()` 后对比。

**追问**：*`loss.item()` 和 `loss.detach()` 的区别？* 前者转成 Python float（触发 GPU→CPU 同步，且彻底断开图），后者返回仍在 GPU 上的张量但不带图。记日志用 `item()`，需要后续计算用 `detach()`。

---

## Q24. `torch.no_grad` 之外，推理还能怎么加速？★★☆（部署相关）

**参考答案**

按投入产出排序：

1. **`model.eval()` + `inference_mode()`**（必做，白捡的）。
2. **`torch.compile`** 或 **ONNX → TensorRT / OpenVINO / ncnn**：算子融合 + 量化，常见 2–8 倍（TRT + fp16）。
3. **半精度 / INT8**：`model.half()` 或 TRT 的 `FP16`/`INT8` 校准（INT8 需要校准集，精度掉点要评估）。
4. **减少 Python 开销**：batch 推理而非逐样本、避免每个样本都 `.cpu()`（批量拷贝更省）、少用 `.item()`（每次同步）。
5. **固定输入 shape**：开 `cudnn.benchmark=True`，避免动态 shape 反复搜索算法。
6. **异步流水线**：`pin_memory` + 多 stream + 双缓冲，让预处理/推理/后处理重叠。
7. **`channels_last`**：`model = model.to(memory_format=torch.channels_last)`，配合 tensor core 在部分模型上明显。

**追问**：*为什么 `model.half()` 不总是更快？* 有些层（BN、softmax 的归约）在 fp16 下要转 fp32 算，反而多一次转换；层数少/小 batch 时收益可能为负。要用 `autocast` 而不是硬 `half()`。

**出处**：<https://pytorch.org/tutorials/recipes/recipes/tuning_guide.html>

---

## Q25. `channels_last` 是什么？为什么能加速？★★☆

**参考答案**

PyTorch 默认张量布局是 **NCHW**（`channels_first`），但 GPU 的 Tensor Core / cudnn 卷积核在 **NHWC（`channels_last`）** 下访存更友好（通道维连续，便于向量化）。

```python
model = model.to(memory_format=torch.channels_last)
x = x.to(memory_format=torch.channels_last)      # 或 x.contiguous(memory_format=...)
```

注意：**`channels_last` 只是 stride 的一种排布，shape 仍然是 NCHW**——`x.shape` 不变，`x.is_contiguous(memory_format=torch.channels_last)` 为 True。所以下游代码不用改。

**收益**：ResNet 类模型在 A100/V100 上通常 10%–30%；没有 Tensor Core 的老卡几乎没收益。用之前 `torch.backends.cudnn.allow_tf32` 也要一起看（TF32 在 Ampere+ 默认开启）。

**追问**：*它和 `permute` 的区别？* `permute(0,2,3,1)` 得到的是 **shape 变了**（NHWC 形状）但 stride 是"假的"视图，接 cudnn 会触发拷贝；`channels_last` 是**shape 不变、stride 真正重排**的物理布局。

**出处**：<https://pytorch.org/tutorials/intermediate/memory_format_tutorial.html>

---

## Q26. AMP 混合精度：`autocast` 和 `GradScaler` 各干什么？fp16 和 bf16 怎么选？★★★ 高频

**参考答案**

**`autocast`**：按算子白/黑名单自动选精度——矩阵乘/卷积用 fp16（快），softmax/norm/loss/归约用 fp32（稳）。它只决定"算的时候用什么精度"，**参数和梯度仍是 fp32**。

**`GradScaler`**：fp16 的动态范围小（最大 65504），梯度容易下溢成 0。做法是**把 loss 乘一个大的 scale 值**再 backward，让梯度落进 fp16 可表示的范围；step 前再 `unscale_` 回来；如果检测到 inf/nan 就**跳过这一步**并把 scale 减半。

```python
scaler = torch.cuda.amp.GradScaler()
with torch.autocast("cuda", dtype=torch.float16):
    loss = criterion(model(x), y)
scaler.scale(loss).backward()          # 梯度被放大
scaler.unscale_(optimizer)             # 必须在 clip 前还原
torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
scaler.step(optimizer)                 # 内部检查 inf/nan 决定是否真更新
scaler.update()                        # 调整 scale
```

**fp16 vs bf16**：

| | fp16 | bf16 |
|---|---|---|
| 尾数/指数 | 10 / 5 位 | 7 / 8 位 |
| 动态范围 | 小，易溢出 | 与 fp32 相同，**不需要 GradScaler** |
| 硬件 | Volta+ | Ampere+（A100/3090 起） |
| 精度 | 更高 | 略低但够用 |

**结论**：**A100/H100/40 系优先 bf16**（省掉 scaler 的坑）；只有老卡才用 fp16 + scaler。

**坑**：`autocast` 内的 `loss` 是 fp32（loss 在 fp32 黑名单里），别手动 `.half()`；`unscale_` 只能调一次（第二次会报错）；DDP + AMP 时 `scaler.step` 要处理梯度同步的顺序。**〔版本相关〕** 2.4 起推荐新写法 `torch.amp.GradScaler("cuda")` 与 `torch.amp.autocast("cuda", ...)`，`torch.cuda.amp.*` 是旧接口（仍可用，会给 deprecation 提示）。

**出处**：<https://pytorch.org/docs/stable/amp.html>；<https://pytorch.org/docs/stable/notes/amp_examples.html>

---

## Q27. 为什么 GPU 利用率上不去（GPU 空转）？怎么定位？★★★（工程岗高频）

**参考答案**

本质是**数据供给成为瓶颈**或**同步点太多**。分段排查：

```text
时间轴想看到的：   [CPU 预处理] 与 [GPU 计算] 重叠
实际情况：         [CPU 预处理][GPU 计算][CPU 预处理][GPU 计算]  ← 串行，GPU 一半时间空着
```

**常见原因与修法**：

| 现象 | 原因 | 修法 |
|---|---|---|
| `nvidia-smi` 利用率低、CPU 某核 100% | 图像解码/增强在 Python 里太慢 | 加 `num_workers`、用 `cv2`/`turbojpeg`、把增强下放到 GPU（albumentations→kornia） |
| 每 step 有规律的空档 | 每个 batch 都 `.item()` / `.cpu()` / `print(loss)` | 累积若干 step 再同步一次 |
| 小 batch、小模型 | kernel 启动开销占比高 | 增大 batch、`compile`、CUDA Graph |
| 显存拷贝慢 | 没开 `pin_memory` + `non_blocking` | 都开上 |
| 多卡通信 | allreduce 等得久 | 增大 bucket、用 NVLink、gradient accumulation + `no_sync` |

**定位工具**：`torch.profiler`（看每步的 CPU/GPU 时间与 kernel 占比）、`nvidia-smi dmon`、`nsys`。

```python
with torch.profiler.profile(activities=[torch.profiler.ProfilerActivity.CPU,
                                        torch.profiler.ProfilerActivity.CUDA]) as prof:
    train_one_step()
print(prof.key_averages().table(sort_by="cuda_time_total", row_limit=15))
```

**追问**：*`time.time()` 计时为什么不准？* CUDA 是**异步**的——kernel 只是入队就返回。要 `torch.cuda.synchronize()` 后再取时间，或用 `torch.cuda.Event`。

**出处**：<https://pytorch.org/tutorials/recipes/recipes/profiler_recipe.html>

---

## Q28. 自定义 `autograd.Function` 怎么写？什么时候需要？★★☆（加分）

**参考答案**

需要**不可导算子**（如量化、可变形采样之外的特殊插值）、或者**想手写一个更省显存/更快的反向**时。

```python
class MyReLU(torch.autograd.Function):
    @staticmethod
    def forward(ctx, x):
        ctx.save_for_backward(x)          # 只存反向要用的东西
        return x.clamp(min=0)

    @staticmethod
    def backward(ctx, grad_output):
        (x,) = ctx.saved_tensors
        return grad_output * (x > 0)

my_relu = MyReLU.apply
```

**两条铁律**：

1. **`backward` 必须返回和 `forward` 输入个数相同的值**（不需要梯度的返回 `None`），顺序要对应；
2. **别用 `ctx.x = x` 存张量**，用 `ctx.save_for_backward(x)`——后者会正确处理版本计数和显存（在 `no_grad` 下也能正确反传）。

**追问**：*`backward` 里能返回非 Tensor 吗？* 不能，必须是 Tensor 或 None。要做 `torch.autograd.gradcheck` 验证数值梯度对不对。

---

# D. 分布式训练与推理部署

## Q29. `DataParallel` 和 `DistributedDataParallel` 的区别？为什么现在不用 DP？★★★ 高频

**参考答案**

| | `DataParallel`（DP） | `DistributedDataParallel`（DDP） |
|---|---|---|
| 进程模型 | **单进程多线程** | **多进程**，一卡一进程 |
| 通信 | 每次前向：主卡 scatter 输入 → 收集输出到主卡（gather） | **反向时 allreduce 梯度**，无前向收集 |
| GIL / Python 开销 | 主卡线程是瓶颈，8 卡可能比单卡还慢 | 各进程独立，线性扩展好 |
| BN | 各卡各自统计（不跨卡） | 同上；要跨卡用 `SyncBN` |
| 负载均衡 | 按 batch 切，不保证均衡 | `DistributedSampler` 保证轮转 |
| 结论 | **已不推荐**，仅用于快速试验 | **标准做法** |

**DP 的关键缺陷**：模型复制到每张卡，但**只有一个 Python 解释器**——主卡要负责 gather loss/outputs，Python 的串行部分成为瓶颈；而且每次前向都有一次 scatter/gather 的全量数据拷贝。

**DDP 的核心机制**：`backward()` 时，按参数"桶"（bucket，默认 25MB）做 **allreduce**，并且**反向计算和通信重叠**——算完某一层的梯度就能开始同步那一层，不用等全部算完。

**出处**：<https://pytorch.org/docs/stable/notes/ddp.html>；<https://pytorch.org/tutorials/intermediate/ddp_tutorial.html>

---

## Q30. DDP 的启动流程？`DistributedSampler` 为什么必须用？★★☆

**参考答案**

```python
# 1) 启动：每卡一个进程
# torchrun --nproc_per_node=4 train.py

import os, torch.distributed as dist
from torch.nn.parallel import DistributedDataParallel as DDP
from torch.utils.data.distributed import DistributedSampler

dist.init_process_group("nccl")            # 后端：GPU 用 nccl，CPU 用 gloo
local_rank = int(os.environ["LOCAL_RANK"])
torch.cuda.set_device(local_rank)

model = build_model().to(local_rank)
model = DDP(model, device_ids=[local_rank])

sampler = DistributedSampler(ds, shuffle=True)   # 每卡只拿自己那份
loader = DataLoader(ds, sampler=sampler, batch_size=32)
for epoch in range(EPOCHS):
    sampler.set_epoch(epoch)                      # ← 不调它每轮顺序都一样
    for x, y in loader: ...
```

**`DistributedSampler` 的三个作用**：

1. **切分数据集**：每卡只处理 `1/world_size`，否则每卡都跑全量 = 白干。
2. **保证不重不漏**：`drop_last=False` 时会 pad 到能整除（重复少量样本），各卡步数一致——否则 DDP 的 allreduce **会挂起**（一个进程先结束，其余等着）。
3. **`set_epoch`**：shuffle 的种子按 epoch 变，否则每轮顺序完全相同，破坏随机性。

**追问**

- *为什么各卡步数必须一致？* DDP 的 allreduce 是**集合通信**，某进程提前退出会让其他进程永远等（或超时）。
- *只在 rank 0 上保存 checkpoint / 打日志*：`if dist.get_rank() == 0:`，否则 4 个进程同时写同一个文件会损坏。
- *`find_unused_parameters=True` 什么时候要开？* 模型有分支导致某些参数本轮没参与计算（如检测里某些辅助头），不开会报 "Expected to have finished reduction in the prior iteration"。开了会**变慢**（每次要检查），能改模型就改模型。

**出处**：<https://pytorch.org/docs/stable/distributed.html>

---

## Q31. `SyncBN` 解决什么问题？★★☆

**参考答案**

普通 BN 在每张卡上**只用本地 batch** 算统计量——batch=2/卡、8 卡时，实际统计量样本只有 2，噪声极大。`SyncBN` 在 forward 时做一次 **allreduce** 把各卡的均值/方差合起来算，等价于全局 batch=16 的 BN。

```python
model = torch.nn.SyncBatchNorm.convert_sync_batchnorm(model)
model = DDP(model, device_ids=[local_rank])
```

**代价**：多两次 allreduce（前向一次、反向一次）→ 通信量增加，小模型上可能明显变慢；而且**必须配合 DDP 用**（单卡没有意义）。

**更省事的选择**：检测/分割小 batch 场景直接换 **GroupNorm / LayerNorm**（不需要跨卡通信，对小 batch 更稳），这是很多检测框架的默认。

**追问**：*`SyncBN` 能用在 `nn.DataParallel` 上吗？* 技术上可以（`convert_sync_batchnorm` 后套 DP），但 DP 本身不推荐，实际没人这么用。

---

## Q32. 大模型训不动（单卡放不下）怎么办？ZeRO / FSDP 的思路？★★★（加分）

**参考答案**

**数据并行（DDP）在每张卡上都完整复制**：参数 + 梯度 + 优化器状态。7B 模型 fp32 + Adam ≈ 7B × 16B ≈ **112 GB**，单卡放不下。

**分片（sharding）的思路**——把这三样切开分给各卡：

| 方案 | 切什么 | 显存节省 | 通信 |
|---|---|---|---|
| **ZeRO-1** | 优化器状态 | ~4× | 低 |
| **ZeRO-2** | + 梯度 | ~8× | 中 |
| **ZeRO-3 / FSDP** | + 参数 | ~线性 | 高（每次前向要 allgather 参数） |

**FSDP（PyTorch 原生）**：把一个模型按层切成 flat 参数组，每卡只持有 `1/N` 的参数/梯度/优化器状态；**前向时 allgather 出当前层参数 → 算完立即释放（reshard）**，反向时再取一次。

```python
from torch.distributed.fsdp import FullyShardedDataParallel as FSDP
model = FSDP(model, use_orig_params=True)
```

**其他省显存的组合拳**：**梯度检查点**（用时间换显存）、**8-bit 优化器**、**CPU offload**（慢但能跑）、**LoRA/Adapter**（只训小部分参数，最适合微调）。

**追问**：*FSDP 和 ZeRO-3 的关系？* 思想一致（DeepSpeed 的 ZeRO-3 ≈ FSDP），FSDP 是 PyTorch 原生实现；选型看生态（HuggingFace 两边都支持）。

**出处**：<https://pytorch.org/docs/stable/fsdp.html>；Rajbhandari et al., *ZeRO*, SC 2020。

---

## Q33. 推理部署：从训练好的 `.pt` 到线上服务，中间要做什么？★★☆（工业检测岗必问）

**参考答案**

```text
训练产物 (.pt/state_dict)
   │  ① 导出：torch.onnx.export / torch.jit.trace / torch.export
   ▼
中间表示 (ONNX / TorchScript)
   │  ② 优化：常量折叠、算子融合、量化（FP16/INT8）、去掉训练专用节点
   ▼
推理引擎 (TensorRT / ONNX Runtime / OpenVINO / ncnn / libtorch)
   │  ③ 服务化：动态 batch、多 stream、内存池、请求队列
   ▼
线上服务（gRPC/HTTP, C++ 后端更常见）
```

**每一步的坑**（这才是面试官想听的）：

1. **导出**：控制流（`if x.sum() > 0`）在 `trace` 下会被**固化**；动态 shape 要指定 `dynamic_axes`；自定义算子要注册。**导出后必须逐层对齐输出**（max abs diff < 1e-4），别信"导出成功"。
2. **NMS 等后处理**：ONNX 里做 NMS 依赖 `NonMaxSuppression` 算子，不同引擎支持度不同；很多工程把它留在 CPU 侧（更快更可控）。
3. **预处理必须一致**：BGR/RGB、归一化均值方差、resize 的插值方式（`INTER_LINEAR` vs `INTER_AREA`）、letterbox 的 padding 值——**训练/推理预处理不一致是精度掉点第一大原因**。
4. **INT8 量化**：需要**代表性校准集**；校准集分布不对（比如全是白天图，线上有夜间）会崩。量化后要按**业务指标**（漏检率）验证，不能只看 mAP。
5. **动态 batch**：要开 `dynamic_axes` 或 TRT 的 optimization profile，否则只能跑固定 batch。
6. **首帧延迟**：TRT 引擎反序列化 + 显存分配要几百 ms——服务启动时就预热（跑几个 dummy 请求）。

**追问**：*为什么工业检测常选 TensorRT 而不是 PyTorch 直接跑？* 确定性延迟（P99 可控）、吞吐（fp16/int8 量化）、以及产线机器通常只装 CUDA 驱动不装完整 PyTorch。

---

## Q34. 多线程/多进程做推理服务，要注意什么？★★☆

**参考答案**

**CUDA 与多线程的三个事实**：

1. **一个 CUDA context 可以被多线程共享**，但每个线程要有自己的**当前 device**（`torch.cuda.set_device`）和 **stream**。
2. **默认 stream 是全局的**，多线程并发提交会**串行化**（甚至互相干扰）；要用 `torch.cuda.Stream()` 显式分流，并 `with torch.cuda.stream(s):` 包裹。
3. **Python 多线程调 PyTorch**：CUDA kernel 提交会释放 GIL（C++ 层），所以多线程**能**并行提交；但 Python 侧的预处理仍受 GIL 限制。

**多进程更常见**（每进程一个 context）：

- **显存按进程隔离**，但要算清楚 `进程数 × 单进程显存 ≤ 总显存`（含 context 开销，每个进程约 300–500 MB）。
- **GPU 绑核**：`CUDA_VISIBLE_DEVICES` 或 `set_device`，别让多个进程抢同一张卡。
- **模型加载**：每进程各自 load 一份（显存翻倍）；可以共享内存传权重，但工程上更常见的是"一进程一卡"。
- **IPC**：用 `multiprocessing.Queue`/共享内存/ZeroMQ 传帧，别传大的 PIL 对象（pickle 开销）。

**追问**：*Triton / TorchServe 值得用吗？* 需要动态 batching、多模型版本管理、指标暴露时值得；只是单模型固定流量，自己写 C++/Python 服务 + TRT 更可控、延迟更低。

**出处**：<https://pytorch.org/docs/stable/notes/cuda.html#cuda-streams>

---

## Q35. BatchNorm 在推理时为什么要"融合"（fold）？★★☆（加分）

**参考答案**

推理时 BN 是**固定仿射变换**：`y = (x - μ)/σ * γ + β`。它可以**数学上折叠进前一个卷积**：把 conv 的权重乘 `γ/σ`、偏置加上 `β - μγ/σ`，从而**完全消掉 BN 层**——少一次访存和一次 kernel 启动。

```python
# PyTorch 内置
torch.ao.quantization.fuse_modules(model, [["conv", "bn", "relu"]], inplace=True)

# 手写（推理前，需 eval 模式）
def fold_bn(conv, bn):
    w = conv.weight * (bn.weight / torch.sqrt(bn.running_var + bn.eps)).view(-1,1,1,1)
    b = (conv.bias - bn.running_mean) * bn.weight / torch.sqrt(bn.running_var + bn.eps) + bn.bias
    return w, b
```

**前提**：BN 必须处于 `eval()` 且 `running_mean/var` 是训练好的统计量；conv 必须紧接 BN（中间不能有激活）；**不能有多个分支共享同一个 BN**。

**追问**：*训练时能折叠吗？* 不能——训练时 BN 统计量在变，折叠会破坏梯度流。这是纯推理期优化。

---

## Q36. 一个 CV 项目从需求到上线，你的工程流程是什么？★★★（综合题，面试收尾必问）

**参考答案**（按"能落地"的方式讲，不要背八股）

```text
1. 定义指标     业务指标（漏检率/P99 延迟）→ 模型指标（mAP/召回）→ 验收线
2. 数据         采集 → 清洗（去重/去坏图）→ 标注规范 → 划分（按产线/时间切，防泄漏）
3. 基线         用现成权重跑通全链路（哪怕 mAP 低）→ 端到端可跑比刷点重要
4. 迭代         错误分析（按类别/尺寸/光照切片看）→ 针对性加数据或改结构
5. 训练工程     config 化、固定 seed、实验记录（wandb/tensorboard）、checkpoint 策略
6. 评估         不止 mAP：按业务切片、混淆矩阵、bad case 可视化
7. 部署         ONNX/TRT、预处理对齐、量化验证、首帧预热、压测（P50/P99）
8. 上线后       埋点监控（输入分布漂移、失败率）、模型版本回滚、数据回流闭环
```

**面试时的高分点**：

- **数据泄漏**：同一产线的同一批图被分到 train/test → 指标虚高，上线崩。按**批次/时间/工位**切分。
- **指标对齐**：线下 mAP 高但线上漏检多 → 通常是**预处理不一致**或**阈值没按业务调**。
- **回归测试**：每次换模型都要跑一套**固定 bad case 集**（专题五《AI 辅助编程》里会展开）。

---

# G. 快问快答（45 题）

> 一题一行结论，用于**面试前扫读**和**被追问时的即时反应**。要展开看细节，回上面 A–D 对应章节。

**Q37** `torch.tensor([1,2])` 和 `torch.Tensor([1,2])` 有什么区别？ —— 前者是**工厂函数**，按输入推断 dtype（`[1,2]` → `int64`）；后者是**类构造**，一律用默认 `float32`（`[1,2]` → `float32`）。混用会导致 `CrossEntropyLoss` 报 "expected Long" 之类的错。

**Q38** `expand` 和 `repeat` 的区别？ —— `expand` 只在 stride 上做文章（**不分配内存**，但要求被扩展维为 1），`repeat` 真的复制数据。广播时 PyTorch 内部用 expand，所以 `(N,1,H,W) + (N,H,W)` 不爆内存，但 `repeat` 会。

**Q39** `torch.stack` 和 `torch.cat` 怎么选？ —— `cat` 沿**已有维度**拼接（其他维必须一致），`stack` **新建一个维度**（要求所有形状完全一致）。batch 组装用 `stack`，特征融合用 `cat`。

**Q40** `.item()` 为什么不能放在循环里频繁调？ —— 它触发 **GPU→CPU 同步**，会打断 CUDA 的异步流水线，每次可能损失几百微秒到毫秒。要记日志就累积到 list 每 N 步打一次。

**Q41** `detach()` 出来的张量改值，会影响原来的张量吗？ —— **会**，它们**共享同一份存储**。要独立副本用 `.clone().detach()` 或 `x.detach().clone()`。

**Q42** 为什么说 `x += 1` 比 `x = x + 1` 危险？ —— `+=` 是**原地操作**。如果 `x` 参与过前向且反向要用它，会触发版本计数报错；如果 `x` 是叶子且 `requires_grad=True`，直接报 "leaf Variable ... in-place operation"。

**Q43** 什么张量算"叶子"（leaf）？ —— 用户**直接创建**、且 `requires_grad=True` 的张量（`is_leaf=True`）。所有 `nn.Parameter` 都是叶子；`x*2` 的结果不是。**只有叶子的 `.grad` 会保留**。

**Q44** `loss.backward()` 的 `gradient` 参数什么时候必须给？ —— 当 `loss` **不是标量**时。它要求传入与 `loss` 同形状的上游梯度，算的是 `vᵀ·J`（雅可比向量积）。

**Q45** `retain_graph=True` 什么时候用？ —— 需要对同一张图**多次 backward** 时（如 GAN 里对同一 loss 反复求导、或需要高阶梯度）。代价是图不释放，**容易显存泄漏**——用完记得手动释放。

**Q46** `torch.autograd.grad` 和 `.backward()` 的区别？ —— `grad` **返回**梯度且不写进 `.grad`（不累加），适合做梯度惩罚、可视化、二阶导；`backward()` 是累加到 `.grad` 上。

**Q47** 为什么 `zero_grad(set_to_none=True)` 是 2.0 的默认？ —— 省掉一次 `memset` 和一块梯度缓冲；`grad is None` 时优化器会跳过该参数（稀疏场景更快）。

**Q48** `optimizer.state_dict()` 里有什么？ —— `param_groups`（lr、weight_decay 等超参）+ `state`（每个参数的动量、二阶矩、step 计数）。断点续训必须存它，否则 Adam 的动量丢失，loss 会先抖一下。

**Q49** Adam 的默认超参是多少？ —— `lr=1e-3, betas=(0.9, 0.999), eps=1e-8, weight_decay=0`。注意 `eps` 加在**分母**，且 AdamW 的 weight decay 是**解耦**的（`p -= lr·wd·p`）。

**Q50** SGD 的 `weight_decay` 和 AdamW 的有什么不同？ —— SGD 是 `g += wd·p`（和梯度混在一起，等效 L2 正则）；AdamW 是**参数更新时单独衰减**，不与自适应学习率耦合，所以正则强度更符合直觉。

**Q51** `CosineAnnealingLR` 的 `T_max` 是什么？ —— **一个周期的总 step 数**（不是 epoch 数，除非你每 epoch step 一次）。设成总迭代步数配 `step()` 每步调，就是标准 cosine schedule。

**Q52** warmup 怎么实现最省事？ —— `LambdaLR` 写一个 lambda：前 `w` 步线性升到 1，之后按 cosine 衰减。或者 `SequentialLR` 串两个 scheduler。

**Q53** `scheduler.get_last_lr()` 和 `optimizer.param_groups[0]['lr']` 有什么区别？ —— 前者返回 scheduler 认为的 lr（可能是 list，每个 param_group 一个），后者读**当前实际生效**的。调试 lr 不生效时，两个都打出来对比最快。

**Q54** `drop_last=True` 什么时候必须开？ —— 当 batch=1 会让 BN 崩（方差为 0）、或 DDP 要求各卡步数一致时。分类训练通常开，检测/分割因为样本少常关。

**Q55** `num_workers=0` 有什么用？ —— **调试**。它让数据加载在当前进程跑，报错能拿到完整 traceback；多 worker 时子进程的异常会被包成一层难读的信息。

**Q56** `sampler` 和 `shuffle=True` 能同时给吗？ —— **不能**，会报错。给了 `sampler` 就由它决定顺序（`DistributedSampler` 自带 shuffle 参数）。

**Q57** `WeightedRandomSampler` 解决什么？ —— 类别不平衡：按权重**有放回**采样，让少数类被抽到的概率提高。权重一般取 `1/类别频次`。

**Q58** `IterableDataset` 多 worker 时要注意什么？ —— 每个 worker 拿到的是**同一个数据集对象的副本**，需要自己按 `worker_info` 做**分片**，否则每个 worker 会把整个数据流跑一遍（数据重复 N 倍）。

**Q59** `torch.manual_seed` 覆盖不到哪些随机源？ —— `random`、`numpy`、`torch.cuda`（要 `manual_seed_all`）、DataLoader 的 worker（要 `worker_init_fn`）、以及 cuDNN 的算法选择（要 `deterministic`）。

**Q60** `cudnn.benchmark=True` 什么时候开、什么时候关？ —— 输入尺寸**固定**时开（自动搜最快算法并缓存）；尺寸变化频繁（检测多尺度）时关，否则每次都要重新搜索，反而更慢。

**Q61** TF32 是什么？默认开吗？ —— Ampere 起的张量核支持 TF32（19 位，比 fp32 快、比 fp16 范围大）。`torch.backends.cudnn.allow_tf32` **默认 True**；`torch.backends.cuda.matmul.allow_tf32` **默认 False**（1.12 起改过默认值）。追求可复现时关掉。

**Q62** 用 bf16 还需要 `GradScaler` 吗？ —— **不需要**。bf16 的指数位和 fp32 一样（8 位），动态范围足够，不会下溢；直接用 `autocast(dtype=torch.bfloat16)` + 普通 `backward` 即可。

**Q63** `GradScaler` 一直在降 scale 说明什么？ —— 模型真的在**溢出**（不是 scaler 的锅）。先检查 lr 是否过大、loss 里有没有 `log(0)`/除零；在 Ampere+ 上直接换 bf16 更省事。

**Q64** DDP 的 `find_unused_parameters=True` 什么时候必须开？ —— 模型有**条件分支**导致某些参数本轮没参与计算时（否则 allreduce 会挂住/报 "Expected to have finished reduction"）。开了会变慢，能改模型就改。

**Q65** DDP 下各卡的 BN 统计量会同步吗？ —— **不会**，各卡用本地 batch 的统计量。要跨卡统计用 `SyncBatchNorm.convert_sync_batchnorm`（多两次 allreduce）。

**Q66** `DistributedSampler` 的 `drop_last=False` 时会怎样？ —— 会把样本**重复补齐**到能整除 `world_size`，保证各卡步数一致（DDP 的集合通信要求所有进程同步推进）。不想重复就设 `drop_last=True`。

**Q67** `torchrun` 里的 `rank`/`world_size` 从哪来？ —— 环境变量：`RANK`、`WORLD_SIZE`、`LOCAL_RANK`。`init_process_group` 用 `env://` 就是读这些。

**Q68** `gloo` 和 `nccl` 怎么选？ —— GPU 训练一律 **nccl**（走 NVLink/PCIe，最快）；CPU 或没有 GPU 时用 **gloo**。混合场景可以按通信内容分别指定。

**Q69** 梯度累积 + DDP 怎么避免通信翻倍？ —— 用 `model.no_sync()` 包住前面的累积步，只在**最后一次** `backward` 时才 allreduce。

**Q70** `clip_grad_norm_` 的返回值是什么？ —— **裁剪前的总范数**。正好拿来监控梯度爆炸（>10 就该警惕，>100 基本要出事）。

**Q71** 某个参数的 `grad` 是 `None`，`optimizer.step()` 会怎样？ —— **跳过它**（不更新、不建优化器状态）。所以冻结层即使留在 `param_groups` 里也不会被改，但仍占内存。

**Q72** `model.parameters()` 会重复吗？ —— **不会**，`parameters()` 内部会去重（共享的参数只出一次）；用 `named_parameters()` 时同名共享参数也只会出现一次。

**Q73** 什么时候用 Kaiming 初始化、什么时候用 Xavier？ —— Kaiming 配 **ReLU** 族（保持前向方差）；Xavier 配 **tanh/sigmoid**（同时考虑前向和反向）。PyTorch 的 `reset_parameters` 默认是 Kaiming uniform。

**Q74** BN 的 `num_batches_tracked` 是什么？ —— 记录该 BN 层跑过多少个 batch，**只在 `momentum=None`**（用累积平均而非固定 momentum）时才用得上。

**Q75** `model.eval()` 会关掉梯度吗？ —— **不会**。它只切 BN/Dropout 的行为；省显存必须另外加 `torch.no_grad()`。

**Q76** `torch.save` / `torch.load` 的 `map_location` 干什么？ —— 解决"在 GPU 上存的、在 CPU 上加载"（或反过来）的错位。`map_location='cpu'` 是跨机器加载的标准写法。

**Q77** ONNX 导出的 `opset_version` 怎么定？ —— 按**目标推理引擎支持的版本**倒推（TRT 8.x 通常 ≤17）。默认值随 PyTorch 版本变，**建议显式写**，否则升级 PyTorch 后导出结果可能变。

**Q78** `torch.jit.trace` 的 TracerWarning 意味着什么？ —— 说明代码里有**依赖张量值的控制流**或非张量操作，trace 会把它**固化成一条路径**，换输入就错。这种模型要用 `script` 或改写成 ONNX。

**Q79** `pin_memory=True` 到底加速了什么？ —— 锁页内存支持**异步 DMA**；配合 `.to(device, non_blocking=True)` 才能让 H2D 拷贝和计算重叠。不开 pin 时 `non_blocking` 基本无效。

**Q80** `inference_mode` 产出的张量能参与需要梯度的运算吗？ —— **不能**，会报错。所以只在**纯推理入口**用，别套在训练循环的验证分支里。

**Q81** 显存"碎片化"是什么？`empty_cache()` 该什么时候调？ —— caching allocator 释放的块不还给驱动，大小不匹配时无法复用 → 看似有空闲却 OOM。`empty_cache()` 只在**要把显存让给别的进程/框架**时调，训练循环里调只会让下次重新申请、更慢。

# H. 深挖题（6 题）

## Q82. 模型量化：PTQ 和 QAT 的区别？INT8 掉点怎么办？★★★

**参考答案**

```text
PTQ（训练后量化）：拿训练好的 fp32 模型 → 用校准集统计每层激活的分布 → 定 scale/zero_point → 转 INT8
  优点：不用重训，几十分钟；缺点：精度损失不可控
QAT（量化感知训练）：训练时插入 fake-quant（前向模拟量化误差，反向用 STE 直通估计器）
  优点：精度接近 fp32；缺点：要重训、要调
```

**关键细节**：

1. **per-tensor vs per-channel**：权重用 **per-channel**（每个输出通道一组 scale）几乎无损；激活只能 per-tensor（动态范围随输入变）。
2. **校准集必须代表线上分布**：拿白天的图校准、线上跑夜间图 → 激活溢出、精度崩。这是工业检测 INT8 翻车的头号原因。
3. **敏感层保留 fp16/fp32**（混合精度量化）：通常是**第一层、最后一层、以及检测的回归头**（回归对数值精度敏感，分类对量化更宽容）。
4. **验证要看业务指标**：mAP 掉 0.5% 可能可接受，但**漏检率**翻倍就不可接受——必须按缺陷类型切片看。

```python
# PyTorch 的 PTQ 流程（eager mode）
import torch.ao.quantization as tq
model.eval()
model.qconfig = tq.get_default_qconfig("fbgemm")      # x86 用 fbgemm，ARM 用 qnnpack
model_prepared = tq.prepare(tq.fuse_modules(model, [["conv", "bn", "relu"]]))
for x, _ in calib_loader: model_prepared(x)           # 校准
model_int8 = tq.convert(model_prepared)
```

**追问**：*为什么卷积可以 INT8 而 LayerNorm/Softmax 不行？* 后者的动态范围跨样本差异极大（softmax 输出 0~1 但输入可能 ±20），固定 scale 会截断；而且它们的计算量占比小，量化收益低、风险高。

---

## Q83. ONNX 导出失败的常见原因？怎么系统排查？★★★

**参考答案**

**按"报错类型"分类**：

| 报错/现象 | 根因 | 修法 |
|---|---|---|
| `Unsupported operator` | 用了 ONNX 没有的算子（如自定义 CUDA op、部分 `torch.nn.functional` 组合） | 换等价实现，或注册自定义 op（TRT 要写插件） |
| `Expected all tensors on same device` | 导出时模型/输入不在同一 device | 统一 `.cpu()` 或 `.cuda()`，别混 |
| 导出成功但输出对不上 | **控制流被 trace 固化**、或用到了 Python 值 | 改成纯张量运算；或用 `torch.export` 的静态图 |
| 动态 shape 报错 | 没给 `dynamic_axes`，或给了但引擎不支持 | 显式声明每个输入的哪些维是动态 |
| 精度差异 > 1e-3 | 算子融合/近似（GELU tanh 版、LayerNorm eps） | **逐层比对**，找出第一个偏离的算子 |

**排查顺序**（这是我实际用的）：

```text
① 先用最简单输入导出 → 用 onnxruntime 跑一遍 → 和 PyTorch 对比输出
② 不一致时，二分网络：把模型截断到第 k 层，逐层比 max abs diff
③ 找到出问题的算子 → 查 onnx opset 是否支持、参数是否等价
④ 最后才怀疑 dynamic shape / 引擎
```

```python
torch.onnx.export(model, dummy, "m.onnx",
                  input_names=["x"], output_names=["out"],
                  dynamic_axes={"x": {0: "batch"}, "out": {0: "batch"}},
                  opset_version=17)
# 验证
import onnxruntime as ort, numpy as np
sess = ort.InferenceSession("m.onnx")
y_onnx = sess.run(None, {"x": dummy.numpy()})[0]
print(np.abs(y_onnx - model(dummy).detach().numpy()).max())   # 应 < 1e-4
```

**一个容易被忽略的点**：`model.eval()` 忘加 → Dropout/BN 走训练分支，导出的是**随机图**，结果天然对不上。

---

## Q84. `hook` 能干什么？用它做特征提取/梯度监控要注意什么？★★☆

**参考答案**

三种 hook：

```python
# ① forward hook：抓中间层输出（特征提取、CAM、可视化）
feats = {}
def hook(module, inp, out): feats["layer3"] = out.detach()
h = model.layer3.register_forward_hook(hook)
model(x); h.remove()                       # ← 必须 remove，否则越积越多

# ② full backward hook：抓梯度（梯度流监控、梯度裁剪的自定义版）
def bh(module, grad_in, grad_out): print(module, grad_out[0].norm())
model.layer3.register_full_backward_hook(bh)

# ③ pre-hook：改输入（调试、注入噪声）
```

**注意事项**（这才是面试官想听的）：

1. **必须 `remove()`**：hook 是强引用，训练循环里反复注册会**内存泄漏 + 越来越慢**（每次前向都跑一遍所有 hook）。
2. **`detach()`**：抓下来的张量如果带着图，会**延长整张图的寿命**（显存泄漏的经典原因）。
3. **backward hook 的已知限制**：`register_backward_hook` 在复杂模块（多输入/原地操作）下不可靠，**用 `register_full_backward_hook`**。
4. **性能**：hook 会打断融合（无法用 `torch.compile` 的全图优化），只在调试时开。

**追问**：*抓了 forward 输出，怎么算 Grad-CAM？* 需要在 backward 时拿到该层梯度的**全局平均池化**，再对 forward 特征做加权求和——所以要同时注册 forward 和 full_backward hook，或者直接用 `torch.autograd.grad(outputs, features)`。

---

## Q85. 梯度检查点（gradient checkpointing）的原理和代价？★★★

**参考答案**

**原理**：正常反向传播需要**所有中间激活**（前向存下来给反向用）。检查点策略是：**只存少数几个"检查点"层的激活**，反向时从最近的检查点**重新前向计算**中间激活。

```text
普通：       前向存全部激活  → 反向直接用
                              显存 O(L)

检查点：     前向只存检查点（每 √L 层一个） → 反向时重算段内激活
             显存 O(√L)，时间 +30%（多一次前向）
```

```python
from torch.utils.checkpoint import checkpoint
def forward(self, x):
    x = self.block1(x)
    x = checkpoint(self.block2, x, use_reentrant=False)   # 重算这一块
    return self.block3(x)
```

**代价与坑**：

1. **时间 +20%~33%**（多一遍前向），换显存通常 2–4 倍。
2. **`use_reentrant=False` 是推荐值**：reentrant 版本在 `no_grad` 上下文、以及有未使用输入时会出问题。
3. **随机性**：Dropout 在重算时如果 RNG 状态不同，会导致前向和重算不一致 → 必须保证 RNG 可复现（checkpoint 内部会保存/恢复 RNG 状态，但自定义随机操作要小心）。
4. **不能跨 checkpoint 边界共享激活**：块内如果有需要跨块的中间结果，重算拿不到。

**追问**：*还有别的省激活的手段吗？* ① 用可逆网络（RevNet，反向由输出推输入，O(1) 激活）；② 把 batch 拆小；③ 用 FSDP 把参数分片（但激活还是要存）；④ 混合精度（激活减半）。

---

## Q86. DDP 用到了哪些集合通信原语？带宽怎么估算？★★★（加分）

**参考答案**

**四个基本原语**：

| 原语 | 语义 | 典型用途 |
|---|---|---|
| `broadcast` | 一 → 多 | 初始化时同步参数、同步 BN 统计 |
| `all_reduce` | 多 → 多（求和/平均） | **DDP 梯度同步**（默认） |
| `all_gather` | 多 → 多（拼接） | 收集各卡预测、SyncBN 统计、MoE |
| `reduce_scatter` | 先规约再分片 | **ZeRO/FSDP 的梯度分片**（比 allreduce 省带宽） |

**Ring AllReduce 的带宽**（`N` 卡、数据量 `M`）：

```text
总通信量 = 2 × (N−1)/N × M   ≈ 2M（N 大时）
        ↑ 第一阶段 reduce-scatter + 第二阶段 all-gather，各 (N−1)/N × M
```

**DDP 的优化**：

1. **梯度分桶（bucket）**：默认 25 MB 一桶，桶满就发一次 allreduce，**和反向计算重叠**。
2. **通信与计算重叠**：靠近输出的层先算完梯度 → 先发，不用等全部算完。
3. **`gradient_as_bucket_view=True`**：省一次梯度拷贝（内存更省）。

**带宽估算的例子**：ResNet-50（25.6M 参数）fp32 梯度 = 102 MB；8 卡 ring allreduce 通信量 ≈ `2 × 7/8 × 102 ≈ 178 MB`/step。PCIe 4.0 x16 约 25 GB/s → 约 7 ms；NVLink 600 GB/s → 约 0.3 ms。**这就是为什么 NVLink 机器上多卡几乎线性加速，而 PCIe 机器上会被通信卡住**。

**追问**：*通信成了瓶颈怎么办？* ① 梯度累积 + `no_sync`（减少 allreduce 次数）；② 增大 bucket；③ 用 `reduce_scatter` 的 FSDP；④ 用更小的模型/更低的精度（fp16 梯度减半）。

---

## Q87. `IterableDataset` 怎么处理流式/超大文件？多 worker 怎么分片？★★☆

**参考答案**

**场景**：数据集大到不能索引（TB 级视频帧、流式日志、按需从对象存储拉取），或者长度未知。

```python
class ShardedIterableDataset(IterableDataset):
    def __init__(self, paths, rank=0, world_size=1):
        self.paths, self.rank, self.world_size = paths, rank, world_size

    def __iter__(self):
        info = get_worker_info()
        # ① 多 worker：每个 worker 只处理自己那份文件
        if info is not None:
            my = self.paths[info.id :: info.num_workers]
        else:
            my = self.paths
        # ② 多进程（DDP）：按 rank 再做一次分片
        my = my[self.rank :: self.world_size]
        for p in my:
            yield from self._read(p)
```

**三个必须注意的点**：

1. **worker 分片**：不写 `info.id :: info.num_workers` 的话，每个 worker 都会**把整个流跑一遍** → 数据重复 N 倍、epoch 长度错乱。这是 `IterableDataset` 最容易踩的坑。
2. **DDP 分片**：`DistributedSampler` **不能用于** `IterableDataset`（它假设可索引）；必须自己在 `__iter__` 里按 `rank` 切，或让每个 rank 读不同文件。
3. **shuffle 与 buffer**：流式数据不能真随机，用 **shuffle buffer**（维护一个大小 B 的池，随机抽取并补入新样本）。
4. **断点续训**：`__iter__` 没有"位置"概念 → 要自己记录（处理到第几个文件第几行），并在 `state_dict` 里持久化（`DataLoader` 支持 `IterableDataset` 的 state 保存，但要自己实现）。

**追问**：*什么时候不该用 IterableDataset？* 数据能放进内存/磁盘且可随机索引时，用 map-style 更简单（`DistributedSampler` 直接可用、shuffle 天然正确）。**别为了"看起来高级"上流式**。

---

# 附录 A：一页速查

| 问题 | 一句话答案 |
|---|---|
| autograd | 动态 DAG，反向拓扑遍历，梯度**累加** |
| 为什么 zero_grad | 梯度累加；`set_to_none=True` 省内存省时间 |
| no_grad vs eval | 前者不建图，后者切 BN/Dropout，**两者都要** |
| inference_mode | 比 no_grad 更彻底，推理专用 |
| detach | 共享存储、脱离计算图 |
| view vs reshape | view 要求连续，reshape 容错（可能拷贝） |
| permute 后 view 报错 | permute 只改 stride，结果非连续 |
| BN momentum | 0.1，running 统计的滑动平均系数 |
| eval 忘了切回 | BN 不更新 + Dropout 关闭 → 训练崩 |
| 梯度裁剪 | `clip_grad_norm_`，裁剪前 AMP 要 `unscale_` |
| 梯度累积 | loss 除以 ACCUM；BN 不等价；DDP 要 `no_sync` |
| state_dict | 只存参数和 buffer，不含结构；`strict=False` 要检查缺键 |
| pin_memory | 配合 `non_blocking=True` 才能异步 H2D |
| collate_fn | 变长目标（检测/分割）必须自定义 |
| CE loss | 输入是 **logits**，内部含 softmax |
| 显存估算 | Adam fp32 ≈ 16×P 字节 + 激活 |
| 显存泄漏 | 忘 no_grad、list 里存 loss、retain_graph |
| OOM 与 nvidia-smi 不符 | caching allocator，reserved vs allocated |
| AMP | autocast 选精度，GradScaler 防 fp16 下溢；Ampere+ 用 bf16 |
| GPU 空转 | 数据供给瓶颈 / 频繁 `.item()` 同步 |
| DP vs DDP | DP 单进程多线程 GIL 瓶颈；DDP 多进程 allreduce + 计算通信重叠 |
| DistributedSampler | 切数据 + 保证步数一致（否则 allreduce 挂起）+ set_epoch |
| SyncBN | 跨卡统计，多两次 allreduce；小 batch 优先换 GN |
| FSDP/ZeRO | 分片参数/梯度/优化器状态，用通信换显存 |
| 部署 | 导出→优化→引擎→服务；预处理不一致是第一大坑 |

# 附录 B：出处

- PyTorch 官方文档：<https://pytorch.org/docs/stable/index.html>
  - autograd 机制：<https://pytorch.org/docs/stable/notes/autograd.html>
  - CUDA 显存管理：<https://pytorch.org/docs/stable/notes/cuda.html#memory-management>
  - AMP：<https://pytorch.org/docs/stable/amp.html>、<https://pytorch.org/docs/stable/notes/amp_examples.html>
  - DDP：<https://pytorch.org/docs/stable/notes/ddp.html>
  - 可复现性：<https://pytorch.org/docs/stable/notes/randomness.html>
  - 性能调优指南：<https://pytorch.org/tutorials/recipes/recipes/tuning_guide.html>
  - memory_format：<https://pytorch.org/tutorials/intermediate/memory_format_tutorial.html>
  - FSDP：<https://pytorch.org/docs/stable/fsdp.html>
- 论文：Loshchilov & Hutter, *Decoupled Weight Decay Regularization* (AdamW, ICLR 2019)；Rajbhandari et al., *ZeRO* (SC 2020)；Micikevicius et al., *Mixed Precision Training* (ICLR 2018)
- 参考的公开题库（校准高频分布，未搬运原文）：[pytorch-interview-book](https://github.com/szylover/knowledge-library/blob/d5965c0f20cd0cbd2cfe29d1b4bc5d1121ecce30/pytorch-interview-book/README.md)
