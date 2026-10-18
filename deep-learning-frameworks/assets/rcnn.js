/* ===========================================================
   R-CNN 逐步详解 · 交互演示
   1) 候选框数量↔召回率   2) 227×227 区域归一化   3) 逐层张量与参数量
   4) 边框回归编解码      5) 训练存储量估算       6) 推理流水线拆解
   7) IoU 与 NMS          8) 自测题
   =========================================================== */
(function () {
  'use strict';
  var D = window.DSH;
  if (!D) return;
  var $ = D.$, $$ = D.$$, el = D.el, iou = D.iou, rr = D.rr, rng = D.rng, clamp = D.clamp;
  var FONT = '600 13px "Segoe UI", "Microsoft YaHei", sans-serif';

  /* ==========================================================
     演示 1 · 候选框数量 ↔ 召回率
     ========================================================== */
  (function () {
    var cv = $('#cv-ss');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var K = $('#ss-k'), T = $('#ss-t');
    var R = rng(777);

    var objects = [
      { label: 'person', x: 0.06, y: 0.12, w: 0.14, h: 0.70, color: '#3ddc97' },
      { label: 'dog',    x: 0.30, y: 0.42, w: 0.20, h: 0.32, color: '#ffb454' },
      { label: 'car',    x: 0.57, y: 0.56, w: 0.32, h: 0.24, color: '#4cc9f0' }
    ];
    function build() {
      var target = +K.value * 20, out = [];
      objects.forEach(function (o) {
        for (var i = 0; i < Math.max(2, Math.round(target / 60)); i++) {
          var jw = o.w * (0.85 + R() * 0.5), jh = o.h * (0.85 + R() * 0.5);
          var bx = clamp(o.x + (R() - 0.5) * o.w * 0.5 - (jw - o.w) / 2, 0, 0.98);
          var by = clamp(o.y + (R() - 0.5) * o.h * 0.5 - (jh - o.h) / 2, 0, 0.98);
          bx = Math.min(bx, Math.max(0, 0.99 - jw));
          by = Math.min(by, Math.max(0, 0.99 - jh));
          out.push({ x: bx, y: by, w: Math.min(jw, 0.99 - bx), h: Math.min(jh, 0.99 - by) });
        }
      });
      while (out.length < target) {
        var w = 0.05 + R() * 0.34, h = 0.05 + R() * 0.4;
        out.push({ x: R() * (0.985 - w), y: R() * (0.985 - h), w: w, h: h });
      }
      out.forEach(function (c) {
        var best = 0;
        objects.forEach(function (o) { best = Math.max(best, iou(c, o)); });
        c.score = best + R() * 0.06;
      });
      out.sort(function (a, b) { return b.score - a.score; });
      return out.slice(0, target);
    }
    function hit(list, thr) {
      return objects.filter(function (o) {
        return list.some(function (c) { return iou(c, o) >= thr; });
      }).length / objects.length;
    }
    function draw() {
      var W = cv.width, H = cv.height, list = build();
      ctx.clearRect(0, 0, W, H);
      var g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#0c1428'); g.addColorStop(1, '#0a1020');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      [[0, 0.66, 1, 0.34, '#16223f'], [0.50, 0, 0.5, 0.5, '#131c36'], [0.30, 0.74, 0.3, 0.26, '#182543']]
        .forEach(function (r) { ctx.fillStyle = r[4]; ctx.fillRect(r[0] * W, r[1] * H, r[2] * W, r[3] * H); });

      objects.forEach(function (o) {
        var b = { x: o.x * W, y: o.y * H, w: o.w * W, h: o.h * H };
        ctx.save(); ctx.setLineDash([7, 5]); ctx.strokeStyle = o.color; ctx.lineWidth = 2;
        rr(ctx, b, 7); ctx.stroke(); ctx.restore();
        ctx.fillStyle = o.color; ctx.font = FONT;
        ctx.fillText(o.label, b.x, Math.max(13, b.y - 6));
      });

      var thr = +T.value / 100;
      list.forEach(function (c) {
        var b = { x: c.x * W, y: c.y * H, w: c.w * W, h: c.h * H };
        var best = 0;
        objects.forEach(function (o) { best = Math.max(best, iou(c, o)); });
        var col = best >= 0.7 ? 'rgba(61,220,151,.95)' : (best >= thr ? 'rgba(255,180,84,.9)' : 'rgba(123,140,255,.45)');
        ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = best >= 0.7 ? 2 : 1.2;
        rr(ctx, b, 4); ctx.stroke(); ctx.restore();
      });

      var r5 = hit(list, 0.5), r7 = hit(list, 0.7);
      var good = list.filter(function (c) {
        var best = 0; objects.forEach(function (o) { best = Math.max(best, iou(c, o)); });
        return best >= 0.5;
      }).length;
      var perCand = 45; // ms，AlexNet 单框前向量级
      var secs = list.length * perCand / 1000;
      $('#ss-out').innerHTML =
        '<div><span>候选框数量 K</span><span>' + list.length + '</span></div>' +
        '<div class="' + (r5 === 1 ? 'good' : 'badrow') + '"><span>召回率 @ IoU≥0.5</span><span>' + (r5 * 100).toFixed(0) + '%</span></div>' +
        '<div class="' + (r7 === 1 ? 'good' : 'neu') + '"><span>召回率 @ IoU≥0.7</span><span>' + (r7 * 100).toFixed(0) + '%</span></div>' +
        '<div><span>其中"有效"候选</span><span>' + good + '（' + (good / list.length * 100).toFixed(0) + '%）</span></div>' +
        '<div class="badrow"><span>③ 步 CNN 前向次数</span><span>' + list.length.toLocaleString() + '</span></div>' +
        '<div class="badrow"><span>③ 步估算耗时</span><span>' + (secs > 1 ? secs.toFixed(1) + ' s' : (secs * 1000).toFixed(0) + ' ms') + '</span></div>';
    }
    K.addEventListener('input', function () { $('#ss-kv').textContent = +K.value * 20; draw(); });
    T.addEventListener('input', function () { $('#ss-tv').textContent = (+T.value / 100).toFixed(2); draw(); });
    D.responsive(cv, draw);
  })();

  /* ==========================================================
     演示 2 · 227×227 区域归一化
     ========================================================== */
  (function () {
    var cv = $('#cv-warp');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var MODE = $('#warp-mode'), P = $('#warp-p'), AR = $('#warp-ar');

    // 源图上的物体（归一化），用于画“内容”
    var OBJ = { x: 0.34, y: 0.20, w: 0.30, h: 0.62 };
    var box = { x: OBJ.x, y: OBJ.y, w: OBJ.w, h: OBJ.h };
    var drag = null, off = { x: 0, y: 0 };

    function setAR() {
      var ar = +AR.value / 100;
      var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      var area = box.w * box.h;
      box.w = clamp(Math.sqrt(area * ar), 0.03, 0.95);
      box.h = clamp(Math.sqrt(area / ar), 0.03, 0.95);
      box.x = clamp(cx - box.w / 2, 0.005, 0.995 - box.w);
      box.y = clamp(cy - box.h / 2, 0.005, 0.995 - box.h);
    }

    /* 在指定矩形里画“物体内容”（渐变 + 条纹 + 圆 + 方块），用于观察形状变化 */
    function drawContent(r, alpha) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      var g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
      g.addColorStop(0, 'rgba(76,201,240,' + alpha + ')');
      g.addColorStop(1, 'rgba(181,123,255,' + alpha + ')');
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      // 横条纹：能直观看出纵向被压缩的程度
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = 1;
      for (var i = 1; i < 10; i++) {
        var yy = r.y + r.h * i / 10;
        ctx.beginPath(); ctx.moveTo(r.x, yy); ctx.lineTo(r.x + r.w, yy); ctx.stroke();
      }
      // 竖条纹：能直观看出横向被压缩的程度
      for (var j = 1; j < 10; j++) {
        var xx = r.x + r.w * j / 10;
        ctx.beginPath(); ctx.moveTo(xx, r.y); ctx.lineTo(xx, r.y + r.h); ctx.stroke();
      }
      // 一个圆：被拉成椭圆就说明发生了各向异性缩放
      ctx.beginPath();
      ctx.arc(r.x + r.w * 0.5, r.y + r.h * 0.5, Math.min(r.w, r.h) * 0.26, 0, 6.3);
      ctx.fillStyle = 'rgba(61,220,151,.75)'; ctx.fill();
      // 一个方块：被拉成矩形就说明形状被改变了
      ctx.fillStyle = 'rgba(255,180,84,.8)';
      ctx.fillRect(r.x + r.w * 0.16, r.y + r.h * 0.16, r.w * 0.16, r.h * 0.16);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }

    function draw() {
      var W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#070b16'; ctx.fillRect(0, 0, W, H);

      var gap = Math.round(W * 0.03);
      var leftW = Math.round((W - gap * 2) * 0.46);
      var rightW = W - leftW - gap * 2 - 20;
      var lx = 16, rx = lx + leftW + gap, top = 56;
      var imgH = H - top - 56;

      ctx.font = FONT; ctx.fillStyle = '#aab6d4';
      ctx.fillText('① 原图上的候选框（拖拽移动）', lx, 26);
      ctx.fillText('② 归一化输出 227×227', rx, 26);

      /* ---- 左：原图 ---- */
      ctx.fillStyle = '#0c1428';
      rr(ctx, { x: lx, y: top, w: leftW, h: imgH }, 10); ctx.fill();
      ctx.strokeStyle = '#26304f'; ctx.stroke();
      // 网格
      ctx.strokeStyle = 'rgba(38,48,79,.8)'; ctx.lineWidth = 1;
      for (var i = 1; i < 8; i++) {
        ctx.beginPath(); ctx.moveTo(lx + leftW * i / 8, top); ctx.lineTo(lx + leftW * i / 8, top + imgH); ctx.stroke();
      }
      for (var j = 1; j < 6; j++) {
        ctx.beginPath(); ctx.moveTo(lx, top + imgH * j / 6); ctx.lineTo(lx + leftW, top + imgH * j / 6); ctx.stroke();
      }
      // 物体（真值）
      var gtBox = { x: lx + OBJ.x * leftW, y: top + OBJ.y * imgH, w: OBJ.w * leftW, h: OBJ.h * imgH };
      drawContent(gtBox, 0.30);
      ctx.save(); ctx.setLineDash([7, 5]); ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 2;
      ctx.strokeRect(gtBox.x, gtBox.y, gtBox.w, gtBox.h); ctx.restore();
      ctx.fillStyle = '#3ddc97'; ctx.font = FONT; ctx.fillText('真值框', gtBox.x, gtBox.y - 7);

      // 候选框
      var P_ = { x: lx + box.x * leftW, y: top + box.y * imgH, w: box.w * leftW, h: box.h * imgH };
      ctx.strokeStyle = '#4cc9f0'; ctx.lineWidth = 2.4;
      rr(ctx, P_, 3); ctx.stroke();
      ctx.fillStyle = 'rgba(76,201,240,.10)'; ctx.fill();
      ctx.fillStyle = '#4cc9f0'; ctx.fillText('候选框 P', P_.x, Math.max(top + 14, P_.y - 7));

      var p = +P.value;
      var padX = p / 500 * leftW, padY = p / 500 * imgH;
      var ext = {
        x: P_.x - padX, y: P_.y - padY,
        w: P_.w + padX * 2, h: P_.h + padY * 2
      };
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = '#b57bff'; ctx.lineWidth = 1.8;
      rr(ctx, ext, 3); ctx.stroke(); ctx.restore();
      // 超界提示
      var outOfBounds = ext.x < lx - 0.5 || ext.y < top - 0.5 ||
                        ext.x + ext.w > lx + leftW + 0.5 || ext.y + ext.h > top + imgH + 0.5;
      if (outOfBounds) {
        ctx.fillStyle = '#ffb454'; ctx.font = '12px "Microsoft YaHei", sans-serif';
        ctx.fillText('⚠ 扩展区域超出原图 → 用均值像素填充', lx + 6, top + imgH - 10);
      }

      /* ---- 右：输出 patch ---- */
      var side = Math.min(rightW, H - top - 90);
      var outR = { x: rx, y: top, w: side, h: side };
      // 计算源区域（原图归一化坐标）
      var sx = (ext.x - lx) / leftW, sy = (ext.y - top) / imgH;
      var sw = ext.w / leftW, sh = ext.h / imgH;
      var mode = MODE.value;

      // 背景 = 均值填充色
      ctx.fillStyle = '#6f7684';
      rr(ctx, outR, 8); ctx.fill();
      ctx.strokeStyle = '#26304f'; ctx.lineWidth = 1; ctx.stroke();

      ctx.save();
      ctx.beginPath(); rr(ctx, outR, 8); ctx.clip();

      if (mode === 'warp') {
        // 把物体内容按 227×227 拉伸绘制：用物体在原图归一化坐标映射到 patch
        var mapX = function (u) { return outR.x + ((u - sx) / sw) * outR.w; };
        var mapY = function (v) { return outR.y + ((v - sy) / sh) * outR.h; };
        var o = {
          x: mapX(OBJ.x), y: mapY(OBJ.y),
          w: (OBJ.w / sw) * outR.w, h: (OBJ.h / sh) * outR.h
        };
        drawContent(o, 0.9);
        var pb = { x: mapX(box.x), y: mapY(box.y), w: (box.w / sw) * outR.w, h: (box.h / sh) * outR.h };
        ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(76,201,240,.9)'; ctx.lineWidth = 1.6;
        ctx.strokeRect(pb.x, pb.y, pb.w, pb.h); ctx.restore();
      } else {
        // crop：保持长宽比，取候选框中心的正方形区域
        var sideSrc = Math.max(box.w, box.h);          // 以归一化坐标的较长边为准
        var cx = clamp(box.x + box.w / 2, sideSrc / 2, 1 - sideSrc / 2);
        var cy = clamp(box.y + box.h / 2, sideSrc / 2, 1 - sideSrc / 2);
        var src = { x: cx - sideSrc / 2, y: cy - sideSrc / 2, w: sideSrc, h: sideSrc };
        var k = outR.w / sideSrc;
        var o2 = {
          x: outR.x + (OBJ.x - src.x) * k, y: outR.y + (OBJ.y - src.y) * k,
          w: OBJ.w * k, h: OBJ.h * k
        };
        drawContent(o2, 0.9);
        var pb2 = {
          x: outR.x + (box.x - src.x) * k, y: outR.y + (box.y - src.y) * k,
          w: box.w * k, h: box.h * k
        };
        // 被裁掉的部分标红
        ctx.save();
        ctx.strokeStyle = '#ff6b81'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        if (pb2.x < outR.x) ctx.strokeRect(pb2.x, pb2.y, pb2.w, pb2.h);
        if (pb2.x + pb2.w > outR.x + outR.w) ctx.strokeRect(pb2.x, pb2.y, pb2.w, pb2.h);
        if (pb2.y < outR.y) ctx.strokeRect(pb2.x, pb2.y, pb2.w, pb2.h);
        if (pb2.y + pb2.h > outR.y + outR.h) ctx.strokeRect(pb2.x, pb2.y, pb2.w, pb2.h);
        ctx.restore();
      }
      ctx.restore();

      // 高亮的中心圆示意
      ctx.beginPath();
      ctx.arc(outR.x + outR.w / 2, outR.y + outR.h / 2, Math.min(outR.w, outR.h) * 0.26, 0, 6.3);
      ctx.strokeStyle = 'rgba(61,220,151,.9)'; ctx.lineWidth = 2; ctx.stroke();

      ctx.fillStyle = '#7c88a8'; ctx.font = '12px "Microsoft YaHei", sans-serif';
      var st = mode === 'warp'
        ? '各向异性缩放：圆被拉成椭圆，形状先验被破坏，但信息无丢失'
        : '各向同性缩放：圆保持为圆，形状保留，但超出部分被裁掉（红虚线）';
      ctx.fillText(st, rx, outR.y + outR.h + 20);

      // ---- 数值读数 ----
      var imgW = 500, imgHpx = 375;  // 假设原图 500×375
      var bx = box.x * imgW, by = box.y * imgHpx, bw = box.w * imgW, bh = box.h * imgHpx;
      var ex = bx - p, ey = by - p, ew = bw + 2 * p, eh = bh + 2 * p;
      var clamped = Math.max(0, -ex) + Math.max(0, -ey) +
                    Math.max(0, ex + ew - imgW) + Math.max(0, ey + eh - imgHpx);
      $('#warp-out').innerHTML =
        '<div><span>候选框（原图像素）</span><span>' + bx.toFixed(0) + ', ' + by.toFixed(0) + ' · ' + bw.toFixed(0) + '×' + bh.toFixed(0) + '</span></div>' +
        '<div><span>候选框长宽比</span><span>' + (bw / bh).toFixed(2) + ' : 1</span></div>' +
        '<div><span>扩展后区域</span><span>' + xw(ew) + '×' + xw(eh) + '</span></div>' +
        '<div><span>横向缩放比 s<sub>x</sub></span><span>' + (227 / ew).toFixed(3) + '</span></div>' +
        '<div><span>纵向缩放比 s<sub>y</sub></span><span>' + (227 / eh).toFixed(3) + '</span></div>' +
        '<div class="' + (Math.abs(227 / ew - 227 / eh) > 0.01 ? 'badrow' : 'good') + '"><span>s<sub>x</sub> / s<sub>y</sub></span><span>' + (eh / ew).toFixed(3) + '（≠1 即各向异性）</span></div>' +
        '<div class="' + (clamped > 0 ? 'badrow' : 'good') + '"><span>超出原图的填充量</span><span>' + clamped.toFixed(0) + ' px</span></div>';
      function xw(v) { return v.toFixed(0); }
    }

    /* 拖拽 */
    function toNorm(e) {
      var r = cv.getBoundingClientRect();
      var W = cv.width, H = cv.height;
      var gap = Math.round(W * 0.03), leftW = Math.round((W - gap * 2) * 0.46);
      var x = (e.clientX - r.left) * (W / r.width), y = (e.clientY - r.top) * (H / r.height);
      return { x: (x - 16) / leftW, y: (y - 56) / (H - 112) };
    }
    cv.addEventListener('pointerdown', function (e) {
      var q = toNorm(e);
      if (q.x >= box.x && q.x <= box.x + box.w && q.y >= box.y && q.y <= box.y + box.h) {
        drag = true; off = { x: q.x - box.x, y: q.y - box.y };
        cv.setPointerCapture(e.pointerId); draw();
      }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var q = toNorm(e);
      box.x = clamp(q.x - off.x, 0.005, 0.995 - box.w);
      box.y = clamp(q.y - off.y, 0.005, 0.995 - box.h);
      draw();
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      cv.addEventListener(t, function () { drag = false; });
    });
    MODE.addEventListener('change', draw);
    P.addEventListener('input', function () { $('#warp-pv').textContent = P.value; draw(); });
    AR.addEventListener('input', function () {
      $('#warp-arv').textContent = (+AR.value / 100).toFixed(2);
      setAR(); draw();
    });
    D.responsive(cv, function () { draw(); });
  })();

  /* ==========================================================
     演示 3 · 逐层张量与参数量
     ========================================================== */
  (function () {
    var picker = $('#layer-picker');
    if (!picker) return;
    var detail = $('#layer-detail'), bars = $('#layer-bars');

    var LAYERS = [
      { n: 'input', t: '输入', cin: 3, cinS: '3×227×227', out: '3×227×227', p: 0, flops: 0,
        note: '预处理：BGR 通道顺序 + ImageNet 均值减法。这一步必须与预训练时完全一致。' },
      { n: 'conv1', t: '卷积 96×11×11, stride 4', cin: 3, cinS: '3×227×227', out: '96×55×55', p: 96 * 11 * 11 * 3 + 96, flops: 105,
        note: '11×11 大核 + stride 4，快速把空间分辨率降到 1/4。参数量小但计算量大。' },
      { n: 'pool1', t: '最大池化 3×3, stride 2', cin: 96, cinS: '96×55×55', out: '96×27×27', p: 0, flops: 1,
        note: '重叠池化（kernel 3 > stride 2），AlexNet 原论文称其略优于非重叠池化。无参数。' },
      { n: 'lrn1', t: 'LRN 局部响应归一化', cin: 96, cinS: '96×27×27', out: '96×27×27', p: 0, flops: 1,
        note: '无参数。跨通道的响应归一化，现代网络已基本用 BatchNorm / LayerNorm 替代。复现老模型时不能省略。' },
      { n: 'conv2', t: '卷积 256×5×5, pad 2', cin: 96, cinS: '96×27×27', out: '256×27×27', p: 256 * 5 * 5 * 96 + 256, flops: 448,
        note: '通道数从 96 升到 256，分辨率不变。参数量与计算量都开始上升。' },
      { n: 'pool2', t: '最大池化 3×3, stride 2', cin: 256, cinS: '256×27×27', out: '256×13×13', p: 0, flops: 2,
        note: '分辨率减半。到此为止空间信息还有 13×13，仍算"保留结构"。' },
      { n: 'conv3', t: '卷积 384×3×3, pad 1', cin: 256, cinS: '256×13×13', out: '384×13×13', p: 384 * 3 * 3 * 256 + 384, flops: 299,
        note: '经典的 3×3 堆叠开始。分辨率 13×13 保持不变。' },
      { n: 'conv4', t: '卷积 384×3×3, pad 1', cin: 384, cinS: '384×13×13', out: '384×13×13', p: 384 * 3 * 3 * 384 + 384, flops: 448,
        note: '与 conv3 同规格。这一段是 AlexNet 里卷积参数最多的层。' },
      { n: 'conv5', t: '卷积 256×3×3, pad 1', cin: 384, cinS: '384×13×13', out: '256×13×13', p: 256 * 3 * 3 * 384 + 256, flops: 299,
        note: '通道数回落到 256，为最后的池化与全连接做准备。' },
      { n: 'pool5', t: '最大池化 3×3, stride 2', cin: 256, cinS: '256×13×13', out: '256×6×6', p: 0, flops: 2, key: true,
        note: '★ R-CNN 的关键张量：展平后是 9216 维，被用作边框回归器的输入特征（比 fc7 保留了更多空间信息）。' },
      { n: 'fc6', t: '全连接 4096 + ReLU + dropout 0.5', cin: 9216, cinS: '9216', out: '4096', p: 9216 * 4096 + 4096, flops: 38, key: true,
        note: '★ 单层 37.75 M 参数，占整个网络约 62%。这是「参数都在全连接层」的典型例子，也是后来全卷积架构的动机。' },
      { n: 'fc7', t: '全连接 4096 + ReLU', cin: 4096, cinS: '4096', out: '4096', p: 4096 * 4096 + 4096, flops: 17, key: true,
        note: '★ R-CNN 取这一层作为 SVM 的输入特征。倒数第二层是「语义够深 / 又不过拟合源任务」的平衡点。' },
      { n: 'fc8', t: '全连接 1000 + softmax（微调时改为 21）', cin: 4096, cinS: '4096', out: '1000（微调后 21）', p: 4096 * 1000 + 1000, flops: 4,
        note: 'ImageNet 的类别头。域内微调时替换为 21 维（20 类 + 背景）并随机初始化，其余层继承预训练权重。' }
    ];
    var TOTAL_P = LAYERS.reduce(function (a, l) { return a + l.p; }, 0);
    var MAXP = Math.max.apply(null, LAYERS.map(function (l) { return l.p; }));

    var html = '';
    LAYERS.forEach(function (l, i) {
      html += '<button data-i="' + i + '">' + l.n + (l.key ? ' ★' : '') + '</button>';
    });
    picker.innerHTML = html;

    // 参数量条形图
    var bhtml = '<div class="small muted" style="margin-bottom:6px">各层参数量占比（总参数约 ' +
      (TOTAL_P / 1e6).toFixed(1) + ' M）—— 注意卷积层几乎可以忽略，全连接层才是大头</div>';
    LAYERS.forEach(function (l, i) {
      var pct = l.p / TOTAL_P * 100;
      var w = MAXP ? (l.p / MAXP * 100) : 0;
      bhtml += '<div style="display:flex;align-items:center;gap:10px;margin:3px 0;font-size:12.5px">' +
        '<span style="width:56px;flex:none;font-family:ui-monospace,Consolas,monospace;color:' + (l.key ? '#4cc9f0' : '#7c88a8') + '">' + l.n + '</span>' +
        '<span style="flex:1;height:12px;background:#0e1730;border-radius:6px;overflow:hidden;border:1px solid #1e2740">' +
        '<span style="display:block;height:100%;width:' + w.toFixed(2) + '%;background:linear-gradient(90deg,#4cc9f0,#7b8cff)"></span></span>' +
        '<span style="width:96px;flex:none;text-align:right;font-family:ui-monospace,Consolas,monospace;color:#aab6d4">' +
        (l.p ? (l.p / 1e6).toFixed(2) + ' M / ' + pct.toFixed(1) + '%' : '0') + '</span></div>';
    });
    bars.innerHTML = bhtml;

    function select(i) {
      var l = LAYERS[i];
      $$('#layer-picker button').forEach(function (b, k) { b.classList.toggle('on', k === i); });
      detail.innerHTML =
        '<h5>' + l.n + '　<span style="color:#aab6d4;font-weight:400">' + l.t + '</span></h5>' +
        '<div class="kv">输入：' + l.cinS + '　→　输出：' + l.out +
        '　|　参数量：' + (l.p ? l.p.toLocaleString() + '（占全网 ' + (l.p / TOTAL_P * 100).toFixed(1) + '%）' : '0（无参数）') +
        '　|　相对计算量：' + (l.flops || 0) + '（任意单位，仅用于层间比较）</div>' +
        '<p style="margin:0">' + l.note + '</p>';
    }
    picker.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]');
      if (b) select(+b.getAttribute('data-i'));
    });
    select(10); // 默认展示 fc6
  })();

  /* ==========================================================
     演示 4 · 边框回归的编码与解码
     ========================================================== */
  (function () {
    var cv = $('#cv-bbox');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var DX = $('#bb-dx'), DY = $('#bb-dy'), DW = $('#bb-dw'), DH = $('#bb-dh');

    var P = { x: 0.10, y: 0.30, w: 0.30, h: 0.34 };
    var G = { x: 0.16, y: 0.24, w: 0.38, h: 0.46 };
    var drag = null, off = { x: 0, y: 0 };

    function t() {
      var Px = P.x + P.w / 2, Py = P.y + P.h / 2;
      var Gx = G.x + G.w / 2, Gy = G.y + G.h / 2;
      return {
        tx: (Gx - Px) / P.w,
        ty: (Gy - Py) / P.h,
        tw: Math.log(G.w / P.w),
        th: Math.log(G.h / P.h)
      };
    }
    function d() {
      return { dx: +DX.value / 100, dy: +DY.value / 100, dw: +DW.value / 100, dh: +DH.value / 100 };
    }
    function decode() {
      var v = d();
      var Px = P.x + P.w / 2, Py = P.y + P.h / 2;
      var gx = P.w * v.dx + Px, gy = P.h * v.dy + Py;
      var gw = P.w * Math.exp(v.dw), gh = P.h * Math.exp(v.dh);
      return { x: gx - gw / 2, y: gy - gh / 2, w: gw, h: gh };
    }

    function draw() {
      var W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#070b16'; ctx.fillRect(0, 0, W, H);

      var pad = 34, fieldH = H - 96;
      var field = { x: pad, y: 56, w: W - pad * 2, h: fieldH };
      ctx.strokeStyle = '#1e2740'; ctx.lineWidth = 1;
      ctx.strokeRect(field.x, field.y, field.w, field.h);
      // 网格
      ctx.strokeStyle = 'rgba(30,39,64,.7)';
      for (var i = 1; i < 10; i++) {
        ctx.beginPath(); ctx.moveTo(field.x + field.w * i / 10, field.y); ctx.lineTo(field.x + field.w * i / 10, field.y + field.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(field.x, field.y + field.h * i / 10); ctx.lineTo(field.x + field.w, field.y + field.h * i / 10); ctx.stroke();
      }

      var px = field.x + P.x * field.w, py = field.y + P.y * field.h;
      var pw = P.w * field.w, ph = P.h * field.h;
      var gx2 = field.x + G.x * field.w, gy2 = field.y + G.y * field.h;
      var gw2 = G.w * field.w, gh2 = G.h * field.h;
      var dec = decode();
      var dcx = field.x + dec.x * field.w, dcy = field.y + dec.y * field.h;
      var dcw = dec.w * field.w, dch = dec.h * field.h;

      // 中心点连线：直观展示 (Gx-Px)/Pw 的含义
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,180,84,.6)'; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px + pw / 2, py + ph / 2);
      ctx.lineTo(gx2 + gw2 / 2, gy2 + gh2 / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 真值框
      ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 2.4;
      ctx.strokeRect(gx2, gy2, gw2, gh2);
      ctx.fillStyle = 'rgba(61,220,151,.08)'; ctx.fillRect(gx2, gy2, gw2, gh2);
      // 候选框
      ctx.strokeStyle = '#4cc9f0'; ctx.lineWidth = 2.2;
      ctx.strokeRect(px, py, pw, ph);
      // 解码框
      ctx.save(); ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#b57bff'; ctx.lineWidth = 2.4;
      ctx.strokeRect(dcx, dcy, dcw, dch); ctx.restore();

      ctx.font = FONT;
      ctx.fillStyle = '#4cc9f0'; ctx.fillText('候选框 P', px, Math.max(20, py - 8));
      ctx.fillStyle = '#3ddc97'; ctx.fillText('真值框 G', gx2, Math.max(38, gy2 + gh2 + 18));
      ctx.fillStyle = '#b57bff'; ctx.fillText('预测框 Ĝ（解码结果）', dcx, Math.min(H - 10, dcy + dch + 18));

      ctx.fillStyle = '#aab6d4'; ctx.font = '12.5px "Microsoft YaHei", sans-serif';
      ctx.fillText('拖动候选框 P 或真值框 G（两者都可拖），观察 t 的变化；紫色框由右侧 d 滑块决定', pad, 30);

      var tt = t(), v = d();
      var err = iou(dec, G);
      var isPerfect = Math.abs(v.dx - tt.tx) < 1e-6 && Math.abs(v.dy - tt.ty) < 1e-6 &&
                      Math.abs(v.dw - tt.tw) < 1e-6 && Math.abs(v.dh - tt.th) < 1e-6;
      $('#bb-out').innerHTML =
        '<div style="color:#7c88a8;padding-bottom:4px">编码目标 t（由 P、G 决定）</div>' +
        '<div><span>t<sub>x</sub> = (G<sub>x</sub>−P<sub>x</sub>)/P<sub>w</sub></span><span>' + tt.tx.toFixed(3) + '</span></div>' +
        '<div><span>t<sub>y</sub> = (G<sub>y</sub>−P<sub>y</sub>)/P<sub>h</sub></span><span>' + tt.ty.toFixed(3) + '</span></div>' +
        '<div><span>t<sub>w</sub> = log(G<sub>w</sub>/P<sub>w</sub>)</span><span>' + tt.tw.toFixed(3) + '</span></div>' +
        '<div><span>t<sub>h</sub> = log(G<sub>h</sub>/P<sub>h</sub>)</span><span>' + tt.th.toFixed(3) + '</span></div>' +
        '<div style="color:#7c88a8;padding:6px 0 4px;border-top:1px solid #1e2740;margin-top:6px">预测的 d（回归器输出）</div>' +
        '<div><span>d<sub>x</sub> / d<sub>y</sub></span><span>' + v.dx.toFixed(3) + ' / ' + v.dy.toFixed(3) + '</span></div>' +
        '<div><span>d<sub>w</sub> / d<sub>h</sub></span><span>' + v.dw.toFixed(3) + ' / ' + v.dh.toFixed(3) + '</span></div>' +
        '<div style="color:#7c88a8;padding:6px 0 4px;border-top:1px solid #1e2740;margin-top:6px">解码结果 Ĝ 与误差</div>' +
        '<div><span>Ĝ 宽 × 高</span><span>' + (dec.w * 500).toFixed(0) + ' × ' + (dec.h * 375).toFixed(0) + ' px</span></div>' +
        '<div class="' + (err >= 0.9 ? 'good' : (err >= 0.5 ? 'neu' : 'badrow')) + '"><span>IoU(Ĝ, G)</span><span>' + err.toFixed(3) + '</span></div>' +
        '<div class="' + (isPerfect ? 'good' : 'neu') + '"><span>是否 d = t</span><span>' + (isPerfect ? '✔ 完美回归' : '否') + '</span></div>';
    }

    function toNorm(e) {
      var r = cv.getBoundingClientRect();
      var W = cv.width, H = cv.height;
      var pad = 34, fieldH = H - 96;
      return {
        x: ((e.clientX - r.left) * (W / r.width) - pad) / (W - pad * 2),
        y: ((e.clientY - r.top) * (H / r.height) - 56) / fieldH
      };
    }
    function inBox(b, q) { return q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h; }
    cv.addEventListener('pointerdown', function (e) {
      var q = toNorm(e);
      if (inBox(P, q)) { drag = 'P'; off = { x: q.x - P.x, y: q.y - P.y }; }
      else if (inBox(G, q)) { drag = 'G'; off = { x: q.x - G.x, y: q.y - G.y }; }
      if (drag) { cv.setPointerCapture(e.pointerId); draw(); }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var q = toNorm(e), b = drag === 'P' ? P : G;
      b.x = clamp(q.x - off.x, -0.2, 1.1);
      b.y = clamp(q.y - off.y, -0.2, 1.1);
      draw();
    });
    ['pointerup', 'pointercancel'].forEach(function (t2) {
      cv.addEventListener(t2, function () { drag = null; });
    });
    function syncLabels() {
      $('#bb-dxv').textContent = (+DX.value / 100).toFixed(2);
      $('#bb-dyv').textContent = (+DY.value / 100).toFixed(2);
      $('#bb-dwv').textContent = (+DW.value / 100).toFixed(2);
      $('#bb-dhv').textContent = (+DH.value / 100).toFixed(2);
    }
    [DX, DY, DW, DH].forEach(function (s) {
      s.addEventListener('input', function () { syncLabels(); draw(); });
    });
    $('#bb-fit').addEventListener('click', function () {
      var tt = t();
      DX.value = clamp(Math.round(tt.tx * 100), -100, 100);
      DY.value = clamp(Math.round(tt.ty * 100), -100, 100);
      DW.value = clamp(Math.round(tt.tw * 100), -60, 60);
      DH.value = clamp(Math.round(tt.th * 100), -60, 60);
      syncLabels(); draw();
    });
    $('#bb-reset').addEventListener('click', function () {
      [DX, DY, DW, DH].forEach(function (s) { s.value = 0; });
      syncLabels(); draw();
    });
    D.responsive(cv, draw);
  })();

  /* ==========================================================
     演示 5 · 训练存储量估算
     ========================================================== */
  (function () {
    var N = $('#dg-n');
    if (!N) return;
    var C = $('#dg-c'), MV = $('#dg-m');
    function calc() {
      var n = +N.value, c = +C.value, rounds = +MV.value, probe = 20;
      var perImg = 2000;
      $('#dg-nv').textContent = n.toLocaleString();
      $('#dg-cv').textContent = c;
      $('#dg-mv').textContent = rounds;
      var svmRows = (probe + probe * 40 * rounds) * c;
      var fc7GB = svmRows * 4096 * 4 / 1e9;
      var pool5GB = svmRows * 9216 * 4 / 1e9;
      var patchGB = n * perImg * 227 * 227 * 3 * 4 / 1e9;
      var candCount = n * perImg;
      $('#dg-out').innerHTML =
        '<div><span>候选框总数</span><span>' + candCount.toLocaleString() + '</span></div>' +
        '<div><span>SVM 训练样本行数</span><span>' + svmRows.toLocaleString() + '（' + c + ' 类）</span></div>' +
        '<div><span>难例挖掘轮数</span><span>' + rounds + ' 轮</span></div>' +
        '<div class="badrow"><span>fc7 特征（4096 维, fp32）</span><span>' + fc7GB.toFixed(1) + ' GB</span></div>' +
        '<div class="badrow"><span>pool5 特征（9216 维, fp32）</span><span>' + pool5GB.toFixed(1) + ' GB</span></div>' +
        '<div class="badrow"><span>候选 patch 缓存（227×227×3, fp32）</span><span>' + patchGB.toFixed(0) + ' GB</span></div>' +
        '<div><span>论文实测量级</span><span>特征文件数百 GB（VOC 规模）</span></div>';
    }
    [N, C, MV].forEach(function (i) { i.addEventListener('input', calc); });
    calc();
  })();

  /* ==========================================================
     演示 6 · 推理流水线拆解
     ========================================================== */
  (function () {
    var g = $('#pipe-stages');
    if (!g) return;
    var stages = [
      { id: 'img', label: '输入图像', short: '任意尺寸', ins: 'RGB 图像（论文短边缩放到 500 或 600）',
        outs: '张量 3×H×W', learn: '—', time: '0%',
        note: 'R-CNN 对输入尺寸没有硬性要求，因为每个候选区域最终都会被缩到 227×227；但整体缩放会影响候选框数量与显存。' },
      { id: 'ss', label: '① Selective Search', short: '~2000 个候选框', ins: 'RGB 图像',
        outs: '约 2000 个 (x, y, w, h)，按分数排序截断', learn: '无参数（纯 CPU 算法）', time: '1~2 s（约 3%）',
        note: '与类别无关的区域提议：Felzenszwalb 过分割 → 四种相似度（颜色/纹理/尺寸/填充度）层次化贪心合并 → 多配置取并集 → 截断到 K=2000。召回率约 98%（IoU≥0.5）。' },
      { id: 'warp', label: '② 扩展 + warp', short: '227×227', ins: '候选框 + 原图',
        outs: '固定 3×227×227 的 patch', learn: '—', time: '含在 I/O 中',
        note: '各方向扩展 p=16 像素 → 超出原图处用均值像素填充 → 各向异性缩放到 227×227 → BGR + 均值减法。预处理必须与训练完全一致。' },
      { id: 'cnn', label: '③ AlexNet 前向', short: 'fc7 = 4096 维', ins: '3×227×227',
        outs: 'pool5 = 6×6×256（9216 维）、fc7 = 4096 维', learn: '约 61 M 参数（可微调）',
        time: 'GPU 约 45 s（VGG16 版）/<span class="neg">约 95%</span>',
        note: '★ 性能黑洞：2000 个候选框各自独立跑一次完整前向，而它们高度重叠，卷积响应被重复计算上百倍。Fast R-CNN 通过共享卷积把这一步从 2000 次整网前向降到 1 次整图卷积。' },
      { id: 'svm', label: '④ 逐类 SVM', short: '21 个二分类器', ins: 'fc7（4096 维）',
        outs: '每个类别的分数（20 类 + 背景）', learn: '每类 4097 个权重（独立训练）',
        time: '约 0.5 s（约 1%）',
        note: 'VOC 用 20 类 + 背景 = 21 个线性 SVM，one-vs-rest。分数未归一化，不能当概率。训练时用难例挖掘，正样本只取真值框。' },
      { id: 'reg', label: '⑤ 边框回归', short: '4 个偏移量', ins: 'pool5（9216 维）',
        outs: '每类 4 个偏移量 (dx, dy, dw, dh)', learn: '每类 9217 个权重（岭回归）',
        time: '约 0.5 s（约 1%）',
        note: '对每个候选框、每个类别都输出一组偏移量，再按式 6-2 解码得到修正后的框。只用 IoU≥0.6 的样本训练，λ=1000。' },
      { id: 'nms', label: '⑥ 贪心 NMS', short: '类内去重', ins: '所有修正后的框 + 分数',
        outs: '最终检测框 (class, score, x1, y1, x2, y2)', learn: '—', time: '可忽略',
        note: '按分数从高到低保留，删除与已保留框 IoU > 0.3 的框。注意是类内 NMS；R-CNN 用 0.3，比常见 YOLO 的 0.45 更激进。' }
    ];

    var boxW = 132, gap = 22, y0 = 78, nodes = [];
    stages.forEach(function (s, i) {
      var x = 16 + i * (boxW + gap);
      var grp = el('g', { 'data-id': s.id, tabindex: '0' }, g);
      el('rect', { x: x, y: y0, width: boxW, height: 92, rx: 12, fill: 'url(#g-img)', stroke: '#26304f', 'stroke-width': 1.4 }, grp);
      var t1 = el('text', { x: x + boxW / 2, y: y0 + 34, 'text-anchor': 'middle', fill: '#e8edf9', 'font-size': 14, 'font-weight': 600 }, grp);
      t1.textContent = s.label;
      var t2 = el('text', { x: x + boxW / 2, y: y0 + 56, 'text-anchor': 'middle', fill: '#7c88a8', 'font-size': 12 }, grp);
      t2.textContent = s.short;
      var t3 = el('text', { x: x + boxW / 2, y: y0 + 76, 'text-anchor': 'middle', fill: '#4cc9f0', 'font-size': 11 }, grp);
      t3.textContent = 't ≈ ' + s.time.split('（')[0].split('（')[0];
      if (i < stages.length - 1) {
        el('line', { x1: x + boxW + 3, y1: y0 + 46, x2: x + boxW + gap - 4, y2: y0 + 46,
          stroke: '#4cc9f0', 'stroke-width': 2, 'marker-end': 'url(#arw)' }, g);
      }
      nodes.push({ id: s.id, rect: grp.firstChild });
    });

    var title = el('text', { x: 16, y: 34, fill: '#e8edf9', 'font-size': 17, 'font-weight': 700 }, g);
    title.textContent = 'R-CNN 单张图推理：6 个步骤，串行执行';
    var sub = el('text', { x: 16, y: 56, fill: '#7c88a8', 'font-size': 12.5 }, g);
    sub.textContent = '整条链路不可端到端求导：① 是算法、④⑤ 是各自独立训练的线性模型，只有 ③ 能反向传播。';

    var picker = $('#pipe-picker'), detail = $('#pipe-detail');
    stages.forEach(function (s, i) {
      var b = document.createElement('button');
      b.textContent = (i + 1) + '. ' + s.label;
      b.addEventListener('click', function () { select(s.id); });
      picker.appendChild(b);
    });

    function select(id) {
      var idx = stages.findIndex(function (s) { return s.id === id; });
      var s = stages[idx];
      nodes.forEach(function (n) { 
        var on = n.id === id;
        n.rect.setAttribute('stroke', on ? '#4cc9f0' : '#26304f');
        n.rect.setAttribute('stroke-width', on ? 2.4 : 1.4);
        n.rect.setAttribute('fill', on ? 'rgba(76,201,240,.14)' : 'url(#g-img)');
      });
      $$('#pipe-picker button').forEach(function (b, i) { b.classList.toggle('on', i === idx); });
      detail.innerHTML =
        '<h5>' + (idx + 1) + '. ' + s.label + '</h5>' +
        '<div class="kv">输入：' + s.ins + '<br>输出：' + s.outs +
        '<br>可学习参数：' + s.learn + '<br>耗时：' + s.time + '</div>' +
        '<p style="margin:0">' + s.note + '</p>';
    }
    select('cnn');
  })();

  /* ==========================================================
     演示 7 · IoU 与 NMS
     ========================================================== */
  (function () {
    var cv = $('#cv-iou');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var TH = $('#nms-th');

    var a = { x: 0.20, y: 0.22, w: 0.34, h: 0.40 };
    var b = { x: 0.38, y: 0.34, w: 0.34, h: 0.40 };
    var drag = null, off = { x: 0, y: 0 };

    var dets = [
      { x: 0.10, y: 0.16, w: 0.20, h: 0.46, s: 0.98, c: 'person' },
      { x: 0.12, y: 0.20, w: 0.18, h: 0.42, s: 0.83, c: 'person' },
      { x: 0.09, y: 0.22, w: 0.22, h: 0.40, s: 0.61, c: 'person' },
      { x: 0.11, y: 0.15, w: 0.24, h: 0.52, s: 0.44, c: 'person' },
      { x: 0.38, y: 0.30, w: 0.26, h: 0.26, s: 0.95, c: 'dog' },
      { x: 0.40, y: 0.32, w: 0.24, h: 0.24, s: 0.72, c: 'dog' },
      { x: 0.37, y: 0.28, w: 0.28, h: 0.30, s: 0.40, c: 'dog' },
      { x: 0.36, y: 0.34, w: 0.22, h: 0.22, s: 0.31, c: 'dog' },
      { x: 0.66, y: 0.40, w: 0.26, h: 0.36, s: 0.88, c: 'car' },
      { x: 0.68, y: 0.42, w: 0.24, h: 0.34, s: 0.55, c: 'car' },
      { x: 0.64, y: 0.38, w: 0.30, h: 0.38, s: 0.35, c: 'car' },
      { x: 0.50, y: 0.70, w: 0.16, h: 0.18, s: 0.42, c: 'bg' },
      { x: 0.20, y: 0.72, w: 0.14, h: 0.16, s: 0.28, c: 'bg' },
      { x: 0.86, y: 0.14, w: 0.11, h: 0.14, s: 0.22, c: 'bg' }
    ];
    function nms(list, thr) {
      var sorted = list.map(function (dd, i) { return { d: dd, i: i }; })
        .sort(function (p, q) { return q.d.s - p.d.s; });
      var keep = [], sup = [];
      sorted.forEach(function (item) {
        if (keep.some(function (k) { return iou(item.d, k.d) > thr; })) sup.push(item.i);
        else keep.push(item);
      });
      return { keep: keep.map(function (k) { return k.i; }), sup: sup };
    }

    function draw() {
      var W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#070b16'; ctx.fillRect(0, 0, W, H);
      var half = W * 0.5;

      /* 左：IoU */
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, half - 8, H); ctx.clip();
      ctx.fillStyle = '#0a0f1e'; ctx.fillRect(0, 0, half - 8, H);
      ctx.font = FONT; ctx.fillStyle = '#aab6d4';
      ctx.fillText('IoU 计算器（拖动两个框）', 16, 26);

      var A = { x: a.x * (half - 40) + 16, y: a.y * (H - 70) + 46, w: a.w * (half - 40), h: a.h * (H - 70) };
      var B = { x: b.x * (half - 40) + 16, y: b.y * (H - 70) + 46, w: b.w * (half - 40), h: b.h * (H - 70) };
      var v = iou(A, B);
      var x1 = Math.max(A.x, B.x), y1 = Math.max(A.y, B.y);
      var x2 = Math.min(A.x + A.w, B.x + B.w), y2 = Math.min(A.y + A.h, B.y + B.h);
      if (x2 > x1 && y2 > y1) {
        ctx.fillStyle = 'rgba(181,123,255,.35)';
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      }
      ctx.fillStyle = 'rgba(76,201,240,.15)'; ctx.fillRect(A.x, A.y, A.w, A.h);
      ctx.strokeStyle = '#4cc9f0'; ctx.lineWidth = 2.2; rr(ctx, A, 4); ctx.stroke();
      ctx.fillStyle = 'rgba(255,180,84,.15)'; ctx.fillRect(B.x, B.y, B.w, B.h);
      ctx.strokeStyle = '#ffb454'; ctx.lineWidth = 2.2; rr(ctx, B, 4); ctx.stroke();

      ctx.font = '600 26px ui-monospace, Consolas, monospace';
      ctx.fillStyle = v >= 0.5 ? '#3ddc97' : (v >= 0.3 ? '#ffb454' : '#ff6b81');
      ctx.fillText('IoU = ' + v.toFixed(3), 16, H - 46);
      ctx.font = '12.5px "Microsoft YaHei", sans-serif'; ctx.fillStyle = '#7c88a8';
      ctx.fillText('交 / 并。R-CNN 里出现五次：微调正样本 ≥0.5、负样本 <0.5、', 16, H - 26);
      ctx.fillText('回归样本 ≥0.6、NMS >0.3 抑制、mAP 判定 ≥0.5', 16, H - 8);
      ctx.restore();

      /* 右：NMS */
      ctx.save();
      var thr = +TH.value / 100;
      var res = nms(dets, thr);
      var keepSet = {}, supSet = {};
      res.keep.forEach(function (i) { keepSet[i] = 1; });
      res.sup.forEach(function (i) { supSet[i] = 1; });

      var ox = half + 10, oy = 46, sw = W - ox - 24, sh = H - 220;
      ctx.fillStyle = '#0a0f1e'; ctx.fillRect(half + 4, 0, half - 4, H);
      ctx.font = FONT; ctx.fillStyle = '#aab6d4';
      ctx.fillText('贪心 NMS（阈值 ' + thr.toFixed(2) + '，类内执行）', ox, 26);

      var colmap = { person: '#3ddc97', dog: '#ffb454', car: '#4cc9f0', bg: '#7c88a8' };
      dets.forEach(function (dd, i) {
        var bb = { x: ox + dd.x * sw, y: oy + dd.y * sh, w: dd.w * sw, h: dd.h * sh };
        var kept = keepSet[i];
        ctx.save();
        if (!kept) { ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.5; }
        ctx.strokeStyle = kept ? colmap[dd.c] : '#5c6684';
        ctx.lineWidth = kept ? 2.4 : 1.2;
        rr(ctx, bb, 4); ctx.stroke();
        if (kept) { ctx.globalAlpha = 0.10; ctx.fillStyle = colmap[dd.c]; rr(ctx, bb, 4); ctx.fill(); }
        ctx.restore();
        if (kept) {
          ctx.font = '600 11px ui-monospace, Consolas, monospace';
          var label = dd.c + ' ' + dd.s.toFixed(2);
          var tw = ctx.measureText(label).width + 10;
          ctx.fillStyle = colmap[dd.c];
          rr(ctx, { x: bb.x, y: Math.max(oy, bb.y - 17), w: tw, h: 16 }, 4); ctx.fill();
          ctx.fillStyle = '#07101f';
          ctx.fillText(label, bb.x + 5, Math.max(oy + 12, bb.y - 5));
        }
      });

      // 抑制过程列表
      ctx.font = '12px ui-monospace, Consolas, monospace';
      var lines = dets.map(function (dd, i) { return { d: dd, i: i }; })
        .sort(function (p, q) { return q.d.s - p.d.s; });
      var y0 = oy + sh + 22;
      ctx.fillStyle = '#7c88a8';
      ctx.fillText('按分数降序处理：', ox, y0 - 6);
      lines.forEach(function (o, k) {
        var col = Math.floor(k / 7);
        ctx.fillStyle = keepSet[o.i] ? '#3ddc97' : '#5c6684';
        ctx.fillText((keepSet[o.i] ? '✔保留 ' : '✘抑制 ') + o.d.c.padEnd(7) + o.d.s.toFixed(2),
          ox + col * 150, y0 + 12 + (k % 7) * 15);
      });
      ctx.fillStyle = '#aab6d4'; ctx.font = FONT;
      ctx.fillText('保留 ' + res.keep.length + ' / ' + dets.length + ' 个框', ox + 320, y0 + 12);
      ctx.restore();
    }

    function toNorm(e) {
      var r = cv.getBoundingClientRect();
      var W = cv.width, H = cv.height, half = W * 0.5;
      var x = (e.clientX - r.left) * (W / r.width), y = (e.clientY - r.top) * (H / r.height);
      return { x: clamp((x - 16) / (half - 40), -0.3, 1.3), y: clamp((y - 46) / (H - 70), -0.3, 1.3) };
    }
    function boxes() {
      var W = cv.width, H = cv.height, half = W * 0.5;
      return {
        A: { x: a.x * (half - 40) + 16, y: a.y * (H - 70) + 46, w: a.w * (half - 40), h: a.h * (H - 70) },
        B: { x: b.x * (half - 40) + 16, y: b.y * (H - 70) + 46, w: b.w * (half - 40), h: b.h * (H - 70) }
      };
    }
    function hit(bb, q) { return q.x >= bb.x && q.x <= bb.x + bb.w && q.y >= bb.y && q.y <= bb.y + bb.h; }
    cv.addEventListener('pointerdown', function (e) {
      var q = toNorm(e), bx = boxes();
      if (hit(bx.A, q)) { drag = 'A'; off = { x: q.x - a.x, y: q.y - a.y }; }
      else if (hit(bx.B, q)) { drag = 'B'; off = { x: q.x - b.x, y: q.y - b.y }; }
      if (drag) { cv.setPointerCapture(e.pointerId); draw(); }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var q = toNorm(e), t = drag === 'A' ? a : b;
      t.x = clamp(q.x - off.x, -0.15, 1.15); t.y = clamp(q.y - off.y, -0.15, 1.15);
      draw();
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      cv.addEventListener(t, function () { drag = null; });
    });
    TH.addEventListener('input', function () {
      $('#nms-thv').textContent = (+TH.value / 100).toFixed(2);
      draw();
    });
    D.responsive(cv, draw);
  })();

  /* ==========================================================
     演示 8 · 自测题
     ========================================================== */
  (function () {
    var wrap = $('#quiz');
    if (!wrap) return;
    var QS = [
      { q: 'R-CNN 推理时，一个候选框最终被多少个 SVM 打分？',
        o: ['只被分数最高的那一个类别的 SVM 打分', '被全部 21 个 SVM 都打一遍分（VOC 20 类 + 背景），再取最高分', '被 1 个多分类 softmax 打分', '不需要 SVM，直接用 CNN 输出'],
        a: 1,
        e: 'R-CNN 是 21 个独立的 one-vs-rest 线性 SVM，推理时每个候选框都要过全部 21 个分类器，再取最高分。这也是它的一个冗余点：Fast R-CNN 改成了单一的 21 类 softmax。注意分数之间没有归一化，不能当概率。' },
      { q: '边框回归器（论文版）的输入特征是哪一层？',
        o: ['fc7（4096 维）', 'pool5（6×6×256 = 9216 维）', 'fc8（1000 维）', '原图像素'],
        a: 1,
        e: '论文用 pool5（9216 维）而不是 fc7。原因：pool5 保留了空间结构（6×6 的网格），对「位置往哪偏、框该多大」这类信息更敏感；fc7 是高度压缩的语义向量，定位信息被稀释。而 SVM 用的恰恰是 fc7。' },
      { q: '关于「微调正样本」与「SVM 正样本」的定义，正确的是？',
        o: ['两者都用 IoU ≥ 0.5', '微调用 IoU ≥ 0.5，SVM 只用真值框本身', '微调只用真值框，SVM 用 IoU ≥ 0.5', '两者都只用真值框'],
        a: 1,
        e: '微调时只要与真值框 IoU ≥ 0.5 就标为该类正样本（宽松，为了让网络见到更多样本）；SVM 训练时只有真值框本身算正样本，并配合难例挖掘，所以判定边界更严格。论文实测 SVM 比 softmax 高约 3.3 个点，根因就在这里。' },
      { q: '为什么边框回归要把宽高写成 log(G_w / P_w) 的形式？',
        o: ['为了把偏移量压缩到 0~1 之间', '因为宽高的变化本质是乘性的，取 log 后变成加性，更适合线性回归，同时约束取值范围、便于跨尺度共享同一个模型', '因为 log 可以让损失更小', '为了与 IoU 的计算保持一致'],
        a: 1,
        e: '宽高缩放是乘性变换（放大 1.5 倍），取 log 后变成加性偏移，线性回归才适用；同时 log 天然约束了正负范围、提升数值稳定性。中心点则除以候选框宽高做归一化，把绝对像素偏移变成相对偏移，使同一套权重能覆盖所有尺度。' },
      { q: 'nms 之前的候选框，R-CNN 用的 IoU 阈值是多少？',
        o: ['0.3（类内执行）', '0.5（跨类执行）', '0.7（类内执行）', '0.45（类内执行）'],
        a: 0,
        e: 'R-CNN 用 <strong>类内贪心 NMS、IoU 阈值 0.3</strong>。比 YOLO 常见的 0.45 更激进，原因是 Selective Search 产生的候选框之间冗余更大，需要更强的去重。另外必须是「类内」——跨类 NMS 会把「人骑着车」这类重叠的不同类物体误删。' },
      { q: '候选框经过 warp 前，论文在它外围补了什么样的边框？',
        o: ['黑色边框（零填充）', '白色边框', 'p=16 像素的均值像素边框（mean pixel）', '随机噪声边框'],
        a: 2,
        e: '论文在候选框各方向扩展 p=16 像素，超出原图的部分用<strong>均值像素</strong>填充（不是黑边，也不是零）。这在原理上等价于给网络一点物体周围的上下文信息；用零填充会让网络看到不自然的黑色边界，与训练分布不一致。' },
      { q: 'R-CNN 训练一张 VOC 图像时，微调阶段的一个 batch 通常由什么组成？',
        o: ['全部是正样本', '32 个正样本（跨类别均匀采样）+ 96 个背景样本', '128 个随机候选框，不做正负区分', '2000 个候选框全部参与'],
        a: 1,
        e: '论文的做法是每个 SGD batch 采 32 个正样本（在类别间均匀采样以保证各类均衡）+ 96 个背景样本，正负比约 1:3。正样本定义是 IoU ≥ 0.5（任一类），负样本是 IoU &lt; 0.5 归入背景类。' },
      { q: '如果只能改 R-CNN 的一处来提速，改哪里收益最大？',
        o: ['把 SVM 换成 softmax', '把 Selective Search 换成 GPU 版本', '让 2000 个候选框共享一次整图卷积，而不是各自跑一遍完整网络', '减少候选框数量到 200'],
        a: 2,
        e: '耗时分析显示：第 ③ 步（逐框 CNN 前向）占约 95%，Selective Search 只占约 3%，SVM 与回归加起来不到 2%。所以关键缺点是「高度重叠的候选框各自重复卷积」。让整图只卷积一次、再用 RoI Pooling 从共享特征图上取各候选的特征，就是 Fast R-CNN 的做法，测试时间从几十秒降到约 2 秒。' }
    ];

    var html = '';
    QS.forEach(function (item, qi) {
      html += '<div class="quiz-item" data-q="' + qi + '"><div class="q">Q' + (qi + 1) + '. ' + item.q + '</div><div class="opts">';
      item.o.forEach(function (op, oi) {
        html += '<div class="opt" data-o="' + oi + '">' + String.fromCharCode(65 + oi) + '. ' + op + '</div>';
      });
      html += '</div><div class="exp">' + item.e + '</div></div>';
    });
    wrap.innerHTML = html;

    var total = QS.length, done = 0, right = 0;
    var score = $('#quiz-score-wrap');
    score.className = 'callout';
    score.innerHTML = '<span class="t">得分</span><p id="quiz-score">尚未作答。共 ' + total + ' 题。</p>';

    wrap.addEventListener('click', function (e) {
      var opt = e.target.closest('.opt');
      if (!opt) return;
      var item = opt.closest('.quiz-item');
      if (item.dataset.answered) return;
      item.dataset.answered = '1';
      var qi = +item.dataset.q, oi = +opt.dataset.o, ans = QS[qi].a;
      $$('.opt', item).forEach(function (o, i) { if (i === ans) o.classList.add('right'); });
      if (oi !== ans) opt.classList.add('wrong'); else right++;
      $('.exp', item).classList.add('show');
      done++;
      $('#quiz-score').innerHTML = '已答 ' + done + ' / ' + total + '，正确 <strong>' + right + '</strong> 题' +
        (done === total ? '。' + (right === total ? '满分，R-CNN 的每一步都已经吃透了 👍' : '建议回看错题对应的章节。') : '。');
    });
  })();

})();
