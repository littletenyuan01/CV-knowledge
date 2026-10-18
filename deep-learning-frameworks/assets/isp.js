/* ===========================================================
   ISP 管线演示脚本
   全部图像在本地用合成场景 + 物理/算法流程现算，不加载任何外部资源。
   约定：线性光一律 0..1 的 Float32；显示前做 sRGB 编码；
        RAW 用 12 bit DN（含黑电平偏置）表示，满阱 = 4095。
   =========================================================== */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---------------- 色彩传递函数 ---------------- */
  function srgbDecode(v) {
    v = clamp01(v);
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function srgbEncode(v) {
    v = clamp01(v);
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }
  function powEncode(v, g) { return Math.pow(clamp01(v), 1 / g); }

  /* ---------------- 随机数（可复现） ---------------- */
  function makeRng(seed) {
    var s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    var spare = null;
    function uniform() { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }
    function gauss() {
      if (spare !== null) { var v = spare; spare = null; return v; }
      var u = 1 - uniform(), v2 = uniform();
      var r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v2);
      return r * Math.cos(2 * Math.PI * v2);
    }
    return { u: uniform, g: gauss };
  }

  /* ---------------- 合成场景 ---------------- */
  /* 12 个色块（sRGB 8 bit）：常见色卡的前若干块 + 一个中性块 */
  var CHART = [
    [115, 82, 68], [194, 150, 130], [98, 122, 157],
    [87, 108, 67], [133, 128, 177], [103, 189, 170],
    [214, 126, 44], [80, 91, 166], [193, 90, 99],
    [94, 60, 108], [157, 188, 64], [130, 130, 130]
  ];
  var CHART_LIN = CHART.map(function (c) {
    return [srgbDecode(c[0] / 255), srgbDecode(c[1] / 255), srgbDecode(c[2] / 255)];
  });

  function hash2(x, y) {
    var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  /* 输出线性反射率（不含光源） */
  function fillScene(out, w, h, variant) {
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var u = (x + 0.5) / w, v = (y + 0.5) / h;
        var r, g, b, k;

        if (variant === 'green') {
          /* 大面积绿 + 顶部天空 + 一小块灰卡 */
          if (v < 0.28) { r = 0.22; g = 0.36; b = 0.62; }
          else { r = 0.05; g = 0.30; b = 0.07; }
          k = 1 + 0.16 * hash2(x, y);
          r *= k; g *= k * 1.02; b *= k;
          if (u > 0.44 && u < 0.56 && v > 0.42 && v < 0.54) { r = g = b = 0.42; }
        } else if (variant === 'red') {
          /* 砖墙（含横向砖缝）+ 一小块灰卡 */
          r = 0.34; g = 0.09; b = 0.06;
          if (Math.abs(v * 26 - Math.round(v * 26)) < 0.06) { r = 0.30; g = 0.29; b = 0.28; }
          k = 1 + 0.20 * hash2(x, y + Math.floor(v * 26) * 7);
          r *= k; g *= k; b *= k;
          if (u > 0.42 && u < 0.58 && v > 0.40 && v < 0.56) { r = g = b = 0.42; }
        } else {
          /* 混合场景：灰墙 + 色卡 + 高频栅栏 + 红蓝边界 + 灰阶斜坡 */
          r = 0.40; g = 0.40; b = 0.40;
          k = 1 + 0.02 * hash2(x, y);
          r *= k; g *= k; b *= k;

          /* 色卡 4 列 × 3 行 */
          if (u > 0.05 && u < 0.45 && v > 0.07 && v < 0.57) {
            var cu = (u - 0.05) / 0.40, cv = (v - 0.07) / 0.50;
            var ci = Math.floor(cu * 4), cj = Math.floor(cv * 3);
            var fu = cu * 4 - ci, fv = cv * 3 - cj;
            if (fu > 0.06 && fu < 0.94 && fv > 0.08 && fv < 0.92) {
              var p = CHART_LIN[cj * 4 + ci];
              r = p[0]; g = p[1]; b = p[2];
            }
          }

          /* 高频栅栏：周期约 4.2 px，用于制造混叠 / 伪彩 */
          if (u > 0.52 && u < 0.95 && v > 0.07 && v < 0.33) {
            var stripe = Math.sin((x + y * 0.35) * 2 * Math.PI / 4.2) > 0;
            r = g = b = stripe ? 0.90 : 0.03;
          }

          /* 红蓝斜边界：强色度边缘 */
          if (u > 0.52 && u < 0.95 && v > 0.38 && v < 0.62) {
            var d = (u - 0.735) + (v - 0.50) * 0.8;
            if (d < 0) { r = 0.72; g = 0.04; b = 0.04; }
            else { r = 0.04; g = 0.05; b = 0.72; }
          }

          /* 灰阶斜坡：用于看 banding */
          if (v > 0.68 && v < 0.94 && u > 0.06 && u < 0.94) {
            var s = (u - 0.06) / 0.88;
            r = g = b = 0.002 + 0.95 * Math.pow(s, 2.2);
          }
        }
        var i = (y * w + x) * 3;
        out[i] = clamp01(r); out[i + 1] = clamp01(g); out[i + 2] = clamp01(b);
      }
    }
    return out;
  }

  function buildScene(w, h, variant) {
    return fillScene(new Float32Array(w * h * 3), w, h, variant);
  }

  /* 轻微光学模糊：模拟镜头 PSF 的带宽限制（避免合成场景本身超出奈奎斯特） */
  function blurScene(src, w, h, weight) {
    var K = weight || [0.30, 0.40, 0.30];
    var tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        for (var c = 0; c < 3; c++) {
          var s = 0, ws = 0;
          for (var d = -K.length + 1; d <= K.length - 1; d++) {
            var xx = clamp(x + d, 0, w - 1);
            s += src[(y * w + xx) * 3 + c] * K[Math.abs(d)]; ws += K[Math.abs(d)];
          }
          tmp[(y * w + x) * 3 + c] = s / ws;
        }
      }
    }
    for (var y2 = 0; y2 < h; y2++) {
      for (var x2 = 0; x2 < w; x2++) {
        for (var c2 = 0; c2 < 3; c2++) {
          var s2 = 0, ws2 = 0;
          for (var d2 = -K.length + 1; d2 <= K.length - 1; d2++) {
            var yy = clamp(y2 + d2, 0, h - 1);
            s2 += tmp[(yy * w + x2) * 3 + c2] * K[Math.abs(d2)]; ws2 += K[Math.abs(d2)];
          }
          out[(y2 * w + x2) * 3 + c2] = s2 / ws2;
        }
      }
    }
    return out;
  }

  /* 灰卡区域（归一化坐标），用于测量残染色偏 */
  function grayCard(variant, w, h) {
    var u0, u1, v0, v1;
    if (variant === 'green') { u0 = 0.44; u1 = 0.56; v0 = 0.42; v1 = 0.54; }
    else if (variant === 'red') { u0 = 0.42; u1 = 0.58; v0 = 0.40; v1 = 0.56; }
    else {
      /* 色卡 4 列 × 3 行里，第 3 列第 3 行是中性块 CHART[11] = (130,130,130) */
      u0 = 0.05 + 0.40 * 0.75 + 0.008; u1 = 0.05 + 0.40 - 0.008;
      v0 = 0.07 + 0.50 * (2 / 3) + 0.012; v1 = 0.07 + 0.50 - 0.012;
    }
    return {
      x0: Math.round(u0 * w), x1: Math.round(u1 * w),
      y0: Math.round(v0 * h), y1: Math.round(v1 * h)
    };
  }

  /* ---------------- 传感器仿真 ---------------- */
  var PATTERNS = { rggb: 0, bggr: 1, grbg: 2, gbrg: 3 };
  function patternColor(phase, x, y) {
    /* 返回 0=R 1=G 2=B；RGGB 为基准，其余为相位偏移 */
    var dx = 0, dy = 0;
    if (phase === 1) { dx = 1; dy = 1; }
    else if (phase === 2) { dx = 1; dy = 0; }
    else if (phase === 3) { dx = 0; dy = 1; }
    var px = ((x + dx) % 2 + 2) % 2, py = ((y + dy) % 2 + 2) % 2;
    if (px === 0 && py === 0) return 0;
    if (px === 1 && py === 1) return 2;
    return 1;
  }

  function capture(scene, w, h, cfg) {
    var phase = PATTERNS[cfg.pattern || 'rggb'];
    var ill = cfg.illum || [1, 1, 1];
    var exposure = cfg.exposure || 6000;
    var fwc = cfg.fwc || 12000;
    var readNoise = cfg.readNoise == null ? 2 : cfg.readNoise;
    var gain = cfg.gain || 1;
    var black = cfg.black == null ? 240 : cfg.black;
    var vig = cfg.vignette == null ? 0 : cfg.vignette;
    var extraDN = cfg.noiseDN || 0;
    var rng = makeRng(cfg.seed || 12345);
    var dn = new Float32Array(w * h);

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var c = patternColor(phase, x, y);
        var val = scene[i * 3 + c] * ill[c];
        /* 暗角：近似 cos⁴，中心 1、四角 1-vig */
        var u = (x + 0.5) / w - 0.5, v = (y + 0.5) / h - 0.5;
        var rr = Math.sqrt(u * u + v * v) / 0.7071;
        val *= 1 - vig * rr * rr;
        var e = val * exposure;
        /* 散粒噪声：泊松近似（大信号用高斯，保证非负） */
        var shot = Math.sqrt(Math.max(e, 0.0001)) * rng.g();
        e = Math.max(0, e + shot);
        e += readNoise * rng.g();
        e *= gain;
        e = clamp(e, 0, fwc);
        var code = black + (e / fwc) * (4095 - black);
        code += extraDN * rng.g();
        dn[i] = clamp(Math.round(code), 0, 4095);
      }
    }

    /* 注入坏点 */
    var defects = [];
    if (cfg.defects) {
      for (var d = 0; d < cfg.defects; d++) {
        var px = 3 + Math.floor(rng.u() * (w - 6));
        var py = 3 + Math.floor(rng.u() * (h - 6));
        var hot = rng.u() > 0.45;
        defects.push({ x: px, y: py, hot: hot });
        dn[py * w + px] = hot ? 4095 : 0;
      }
    }
    return { w: w, h: h, dn: dn, black: black, defects: defects, phase: phase };
  }

  /* ---------------- 画布工具 ---------------- */
  var offCache = {};
  function offscreen(w, h) {
    var k = w + 'x' + h;
    if (!offCache[k]) {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      offCache[k] = c;
    }
    return offCache[k];
  }
  function blit(ctx, w, h, rgba, dx, dy, dw, dh) {
    var off = offscreen(w, h);
    var octx = off.getContext('2d');
    var img = octx.createImageData
      ? octx.createImageData(w, h)
      : { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    img.data.set(rgba);
    octx.putImageData(img, 0, 0);
    ctx.drawImage(off, 0, 0, w, h, dx, dy, dw, dh);
  }
  function rgbaBuffer(w, h) { return new Uint8ClampedArray(w * h * 4); }

  function linearToRGBA(lin, w, h, out) {
    for (var i = 0, j = 0; i < w * h; i++, j += 4) {
      out[j] = 255 * srgbEncode(lin[i * 3]);
      out[j + 1] = 255 * srgbEncode(lin[i * 3 + 1]);
      out[j + 2] = 255 * srgbEncode(lin[i * 3 + 2]);
      out[j + 3] = 255;
    }
    return out;
  }

  function mount(canvas, ratio, draw) {
    if (!canvas) return;
    var raf = null;
    function run() {
      var r = canvas.getBoundingClientRect();
      var cw = Math.round(r.width || 640);
      cw = Math.max(260, Math.min(900, cw));
      canvas.width = cw;
      canvas.height = Math.round(cw * ratio);
      draw(canvas.width, canvas.height);
    }
    window.addEventListener('resize', function () {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(run);
    });
    requestAnimationFrame(run);
    return run;
  }

  function canvasPos(canvas, ev) {
    var r = canvas.getBoundingClientRect();
    var sx = canvas.width / (r.width || canvas.width);
    var sy = canvas.height / (r.height || canvas.height);
    return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
  }

  function label(ctx, text, x, y, color, size, align) {
    ctx.fillStyle = color || '#aab6d4';
    ctx.font = (size || 12) + 'px system-ui, "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = align || 'left';
    ctx.fillText(text, x, y);
  }

  /* ---------------- 去马赛克 ---------------- */
  function demosaicBilinear(raw, w, h, phase) {
    var ch = new Uint8Array(w * h);
    var x, y, i;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) ch[y * w + x] = patternColor(phase, x, y);
    var R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h);
    function at(x, y) { x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1); return raw[y * w + x]; }
    function chAt(x, y) { x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1); return ch[y * w + x]; }

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        var c = ch[i], v = raw[i];
        if (c === 0) R[i] = v; else if (c === 2) B[i] = v; else G[i] = v;
      }
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        var c2 = ch[i];
        var nN = at(x, y - 1), nS = at(x, y + 1), nE = at(x + 1, y), nW = at(x - 1, y);
        var dNE = at(x + 1, y - 1), dNW = at(x - 1, y - 1), dSE = at(x + 1, y + 1), dSW = at(x - 1, y + 1);
        if (c2 === 0) {
          G[i] = (nN + nS + nE + nW) / 4;
          B[i] = (dNE + dNW + dSE + dSW) / 4;
        } else if (c2 === 2) {
          G[i] = (nN + nS + nE + nW) / 4;
          R[i] = (dNE + dNW + dSE + dSW) / 4;
        } else {
          /* a1/a2 恒为「R 方向」的两个邻居：R 行上的 G 取水平，B 行上的 G 取垂直 */
          var horizIsR = (chAt(x + 1, y) === 0);
          var a1 = horizIsR ? nE : nN, a2 = horizIsR ? nW : nS;
          var b1 = horizIsR ? nN : nE, b2 = horizIsR ? nS : nW;
          R[i] = (a1 + a2) / 2;
          B[i] = (b1 + b2) / 2;
        }
      }
    }
    var out = new Float32Array(w * h * 3);
    for (i = 0; i < w * h; i++) { out[i * 3] = R[i]; out[i * 3 + 1] = G[i]; out[i * 3 + 2] = B[i]; }
    return out;
  }

  /* Malvar-He-Cutler：5×5 线性核，按站点颜色选用（数值取自原论文，÷8） */
  var K_G = [
    [0, 0, -1, 0, 0],
    [0, 0, 2, 0, 0],
    [-1, 2, 4, 2, -1],
    [0, 0, 2, 0, 0],
    [0, 0, -1, 0, 0]
  ];
  var K_RG = [
    [0, 0, 0.5, 0, 0],
    [0, -1, 0, -1, 0],
    [-1, 4, 5, 4, -1],
    [0, -1, 0, -1, 0],
    [0, 0, 0.5, 0, 0]
  ];
  var K_DIAG = [
    [0, 0, -1.5, 0, 0],
    [0, 2, 0, 2, 0],
    [-1.5, 0, 6, 0, -1.5],
    [0, 2, 0, 2, 0],
    [0, 0, -1.5, 0, 0]
  ];
  function transpose5(k) {
    var t = [];
    for (var r = 0; r < 5; r++) { t.push([]); for (var c = 0; c < 5; c++) t[r].push(k[c][r]); }
    return t;
  }
  var K_RG_T = transpose5(K_RG);

  function demosaicMalvar(raw, w, h, phase) {
    var out = new Float32Array(w * h * 3);
    function at(x, y) { x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1); return raw[y * w + x]; }
    function conv(k, x, y) {
      var s = 0;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
        var wgt = k[dy + 2][dx + 2];
        if (wgt !== 0) s += wgt * at(x + dx, y + dy);
      }
      return s / 8;
    }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x, c = patternColor(phase, x, y), v = raw[i];
        var r, g, b;
        if (c === 0) {
          r = v; g = conv(K_G, x, y); b = conv(K_DIAG, x, y);
        } else if (c === 2) {
          b = v; g = conv(K_G, x, y); r = conv(K_DIAG, x, y);
        } else {
          g = v;
          var horizIsR = (patternColor(phase, clamp(x + 1, 0, w - 1), y) === 0);
          if (horizIsR) { r = conv(K_RG, x, y); b = conv(K_RG_T, x, y); }
          else { b = conv(K_RG, x, y); r = conv(K_RG_T, x, y); }
        }
        out[i * 3] = clamp01(r); out[i * 3 + 1] = clamp01(g); out[i * 3 + 2] = clamp01(b);
      }
    }
    return out;
  }

  /* 方向自适应：绿色按梯度选水平/垂直插值，R/B 用色差恒定 */
  function demosaicDir(raw, w, h, phase) {
    var ch = new Uint8Array(w * h), i, x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) ch[y * w + x] = patternColor(phase, x, y);
    function at(x, y) { x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1); return raw[y * w + x]; }
    function chAt(x, y) { x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1); return ch[y * w + x]; }

    var G = new Float32Array(w * h);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        if (ch[i] === 1) { G[i] = raw[i]; continue; }
        var gl = at(x - 1, y), gr = at(x + 1, y), gu = at(x, y - 1), gd = at(x, y + 1);
        var cl2 = at(x - 2, y), cr2 = at(x + 2, y), cu2 = at(x, y - 2), cd2 = at(x, y + 2);
        var c0 = raw[i];
        var dH = Math.abs(gl - gr) + Math.abs(2 * c0 - cl2 - cr2);
        var dV = Math.abs(gu - gd) + Math.abs(2 * c0 - cu2 - cd2);
        if (dH < dV) G[i] = (gl + gr) / 2 + (2 * c0 - cl2 - cr2) / 4;
        else G[i] = (gu + gd) / 2 + (2 * c0 - cu2 - cd2) / 4;
      }
    }

    var Rout = new Float32Array(w * h), Bout = new Float32Array(w * h);
    function interpDiff(x, y, target) {
      var g0 = G[y * w + x], s = 0, n = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        var xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (chAt(xx, yy) !== target) continue;
        var wt = (dx === 0 || dy === 0) ? 2 : 1;
        s += wt * (raw[yy * w + xx] - G[yy * w + xx]);
        n += wt;
      }
      if (!n) {
        for (var k = 2; k <= 3 && !n; k++) {
          var cand = [[x - k, y], [x + k, y], [x, y - k], [x, y + k]];
          for (var t = 0; t < 4; t++) {
            var cx = cand[t][0], cy = cand[t][1];
            if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
            if (chAt(cx, cy) !== target) continue;
            s += raw[cy * w + cx] - G[cy * w + cx]; n = 1;
          }
        }
      }
      return g0 + (n ? s / n : 0);
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        var c2 = ch[i];
        if (c2 === 0) { Rout[i] = raw[i]; Bout[i] = clamp01(interpDiff(x, y, 2)); }
        else if (c2 === 2) { Bout[i] = raw[i]; Rout[i] = clamp01(interpDiff(x, y, 0)); }
        else { Rout[i] = clamp01(interpDiff(x, y, 0)); Bout[i] = clamp01(interpDiff(x, y, 2)); }
      }
    }
    var out = new Float32Array(w * h * 3);
    for (i = 0; i < w * h; i++) {
      out[i * 3] = clamp01(Rout[i]);
      out[i * 3 + 1] = clamp01(G[i]);
      out[i * 3 + 2] = clamp01(Bout[i]);
    }
    return out;
  }

  /* ---------------- 统计 / 估计 ---------------- */
  function channelMeans(rgb, w, h) {
    var sr = 0, sg = 0, sb = 0, n = 0;
    for (var i = 0; i < w * h; i += 2) {
      sr += rgb[i * 3]; sg += rgb[i * 3 + 1]; sb += rgb[i * 3 + 2]; n++;
    }
    return [sr / n, sg / n, sb / n];
  }
  function percentile(vals, q) {
    var s = vals.slice().sort(function (a, b) { return a - b; });
    var k = Math.round((s.length - 1) * q);
    return s[k];
  }
  function estimateGains(rgb, w, h, method, truth) {
    if (method === 'truth') return [truth[1] / truth[0], truth[1] / truth[2]];
    if (method === 'none') return [1, 1];
    if (method === 'gray') {
      var m = channelMeans(rgb, w, h);
      return [m[1] / Math.max(m[0], 1e-6), m[1] / Math.max(m[2], 1e-6)];
    }
    if (method === 'white') {
      var R = [], G = [], B = [];
      for (var i = 0; i < w * h; i += 3) {
        R.push(rgb[i * 3]); G.push(rgb[i * 3 + 1]); B.push(rgb[i * 3 + 2]);
      }
      var pr = percentile(R, 0.99), pg = percentile(G, 0.99), pb = percentile(B, 0.99);
      return [pg / Math.max(pr, 1e-6), pg / Math.max(pb, 1e-6)];
    }
    return [1, 1];
  }
  function applyGains(rgb, w, h, gr, gb) {
    var out = new Float32Array(w * h * 3);
    for (var i = 0; i < w * h; i++) {
      out[i * 3] = rgb[i * 3] * gr;
      out[i * 3 + 1] = rgb[i * 3 + 1];
      out[i * 3 + 2] = rgb[i * 3 + 2] * gb;
    }
    return out;
  }
  function applyCCM(rgb, w, h, M) {
    var out = new Float32Array(w * h * 3);
    for (var i = 0; i < w * h; i++) {
      var r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
      out[i * 3] = clamp01(M[0] * r + M[1] * g + M[2] * b);
      out[i * 3 + 1] = clamp01(M[3] * r + M[4] * g + M[5] * b);
      out[i * 3 + 2] = clamp01(M[6] * r + M[7] * g + M[8] * b);
    }
    return out;
  }
  function ccmBlend(strength) {
    var M = [
      1.35, -0.30, -0.05,
      -0.15, 1.30, -0.15,
      0.02, -0.25, 1.23
    ];
    var I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    var out = [];
    for (var i = 0; i < 9; i++) out.push(lerp(I[i], M[i], strength));
    return out;
  }
  function encodeGamma(rgb, w, h, gamma) {
    var out = new Float32Array(w * h * 3);
    for (var i = 0; i < w * h; i++) {
      out[i * 3] = powEncode(rgb[i * 3], gamma);
      out[i * 3 + 1] = powEncode(rgb[i * 3 + 1], gamma);
      out[i * 3 + 2] = powEncode(rgb[i * 3 + 2], gamma);
    }
    return out;
  }
  function sharpenChroma(rgb, w, h, amount) {
    var out = new Float32Array(rgb);
    var Y = new Float32Array(w * h);
    var i, x, y;
    for (i = 0; i < w * h; i++) Y[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
    var B = new Float32Array(w * h);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var s = 0, n = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var xx = clamp(x + dx, 0, w - 1), yy = clamp(y + dy, 0, h - 1);
          s += Y[yy * w + xx]; n++;
        }
        B[y * w + x] = s / n;
      }
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        var yNew = clamp01(Y[i] + amount * (Y[i] - B[i]));
        var d = yNew - Y[i];
        var r = clamp01(rgb[i * 3] + d), g = clamp01(rgb[i * 3 + 1] + d), b = clamp01(rgb[i * 3 + 2] + d);
        var cr = 0, cg = 0, cb = 0, cn = 0;
        for (var dy2 = -1; dy2 <= 1; dy2++) for (var dx2 = -1; dx2 <= 1; dx2++) {
          var x2 = clamp(x + dx2, 0, w - 1), y2 = clamp(y + dy2, 0, h - 1), j = (y2 * w + x2) * 3;
          cr += rgb[j]; cg += rgb[j + 1]; cb += rgb[j + 2]; cn++;
        }
        var a = 0.45 * clamp(amount, 0, 1);
        out[i * 3] = clamp01(lerp(r, cr / cn, a));
        out[i * 3 + 1] = clamp01(lerp(g, cg / cn, a));
        out[i * 3 + 2] = clamp01(lerp(b, cb / cn, a));
      }
    }
    return out;
  }

  /* ---------------- 管线（供演示 6 使用） ---------------- */
  var ILLUM = {
    d65: [1, 1, 1],
    tungsten: [1.32, 0.96, 0.52],
    shade: [0.84, 0.98, 1.28],
    green: [0.96, 1.10, 0.90]
  };

  function runPipeline(sc, w, h, opts) {
    var skip = opts.skip || '';
    var raw = sc.dn.slice();
    var blcK = opts.blc == null ? 1 : opts.blc;
    if (skip !== 'blc') {
      for (var i = 0; i < raw.length; i++) raw[i] = Math.max(0, raw[i] - sc.black * blcK);
    }
    var white = 4095 - sc.black;

    if (skip !== 'lsc') {
      var strength = opts.lsc == null ? 1 : opts.lsc;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var u = (x + 0.5) / w - 0.5, v = (y + 0.5) / h - 0.5;
          var rr = Math.sqrt(u * u + v * v) / 0.7071;
          var gain = 1 / Math.max(0.25, 1 - 0.62 * rr * rr);
          raw[y * w + x] *= Math.pow(gain, strength);
        }
      }
    }

    if (skip !== 'dpc' && sc.defects) {
      var frac = opts.dpc == null ? 1 : opts.dpc;
      for (var d = 0; d < sc.defects.length; d++) {
        if ((d + 1) / sc.defects.length > frac) continue;
        var df = sc.defects[d];
        var vals = [];
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var xx = df.x + dx, yy = df.y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          vals.push(raw[yy * w + xx]);
        }
        vals.sort(function (a, b) { return a - b; });
        raw[df.y * w + df.x] = vals[Math.floor(vals.length / 2)];
      }
    }

    var norm = new Float32Array(w * h);
    for (var k = 0; k < raw.length; k++) norm[k] = clamp01(raw[k] / white);

    var rgb;
    if (skip === 'demosaic') {
      rgb = new Float32Array(w * h * 3);
      for (var p = 0; p < w * h; p++) { rgb[p * 3] = rgb[p * 3 + 1] = rgb[p * 3 + 2] = norm[p]; }
    } else {
      rgb = demosaicMalvar(norm, w, h, opts.phase);
    }

    var gains;
    if (skip !== 'awb') {
      var est = opts.gains || [1, 1];
      var strengthAwb = opts.awb == null ? 1 : opts.awb;
      gains = [Math.pow(est[0], strengthAwb), Math.pow(est[1], strengthAwb)];
      /* 没有去马赛克时三通道同值，再乘白平衡增益只会把灰度染成彩色，
         反而掩盖「丢颜色」这个真实后果，所以这一档强制不乘。 */
      if (skip === 'demosaic') gains = [1, 1];
      rgb = applyGains(rgb, w, h, gains[0], gains[1]);
    } else {
      gains = [1, 1];
    }

    if (skip !== 'ccm') {
      rgb = applyCCM(rgb, w, h, ccmBlend(opts.ccm == null ? 1 : opts.ccm));
    }

    if (skip !== 'gamma') {
      rgb = encodeGamma(rgb, w, h, opts.gamma == null ? 2.2 : opts.gamma);
    }

    if (skip !== 'sharp') {
      rgb = sharpenChroma(rgb, w, h, opts.sharp == null ? 0.8 : opts.sharp);
    }

    return { rgb: rgb, gains: gains };
  }

  /* =========================================================
     演示 1 · Bayer 阵列与 RAW 采样
     ========================================================= */
  (function demo1() {
    var cv = $('d1-canvas');
    if (!cv) return;
    var sel = $('d1-phase'), zoom = $('d1-zoom'), zoomv = $('d1-zoomv'), info = $('d1-info');
    var SW = 72, SH = 54;
    var scene = buildScene(SW, SH, 'mixed');
    var state = { phase: 'rggb', z: 14, pick: null, dn: null };

    function rebuild() {
      var sc = capture(scene, SW, SH, {
        pattern: state.phase, exposure: 9000, fwc: 12000,
        readNoise: 1.5, vignette: 0.55, black: 240, seed: 7
      });
      state.dn = sc.dn;
      render();
    }

    function colorOf(c) { return c === 0 ? '#ff6b81' : (c === 1 ? '#3ddc97' : '#7b8cff'); }

    function render() {
      if (!state.dn) return;
      var W = cv.width, H = cv.height;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#070b16';
      ctx.fillRect(0, 0, W, H);

      var z = state.z;
      var cols = Math.min(16, Math.floor((W * 0.52) / z));
      var rows = Math.min(12, Math.floor((H - 60) / z));
      var gx = 16, gy = 44;
      var phase = PATTERNS[state.phase];

      label(ctx, 'CFA 阵列（放大的 RAW 站点）', gx, 24, '#e8edf9', 13);
      for (var y = 0; y < rows; y++) {
        for (var x = 0; x < cols; x++) {
          var c = patternColor(phase, x, y);
          var v = state.dn[y * SW + x] / 4095;
          ctx.fillStyle = colorOf(c);
          ctx.globalAlpha = 0.18 + 0.62 * v;
          ctx.fillRect(gx + x * z, gy + y * z, z - 1, z - 1);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(255,255,255,.06)';
          ctx.strokeRect(gx + x * z + 0.5, gy + y * z + 0.5, z - 2, z - 2);
        }
      }
      ctx.strokeStyle = '#ffb454';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(gx - 2, gy - 2, z * 2 + 3, z * 2 + 3);
      label(ctx, '一个 2×2 单元 = 4 个采样 / 12 个待恢复值', gx, gy + rows * z + 20, '#ffb454', 11.5);

      if (state.pick && state.pick.x < cols && state.pick.y < rows) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(gx + state.pick.x * z, gy + state.pick.y * z, z, z);
      }

      var rx = gx + cols * z + 28;
      var rw = Math.max(120, W - rx - 20);
      var rh = Math.round(rw * SH / SW);
      var maxRh = H - 150;
      if (rh > maxRh) { rh = Math.max(80, maxRh); rw = Math.round(rh * SW / SH); }
      var buf = rgbaBuffer(SW, SH);
      for (var i = 0; i < SW * SH; i++) {
        var g = 255 * (state.dn[i] / 4095);
        buf[i * 4] = g; buf[i * 4 + 1] = g; buf[i * 4 + 2] = g; buf[i * 4 + 3] = 255;
      }
      blit(ctx, SW, SH, buf, rx, 44, rw, rh);
      label(ctx, '真正的 RAW：单通道、带暗角、带黑电平', rx, 34, '#e8edf9', 12.5);
      label(ctx, '（灰度只是可视化；原始值每个像素只有一个颜色通道）', rx, 44 + rh + 20, '#7c88a8', 11);
      var mean = 0;
      for (var m = 0; m < SW * SH; m++) mean += state.dn[m];
      mean /= SW * SH;
      label(ctx, '均值 ' + mean.toFixed(1) + ' DN　·　黑电平 240 DN', rx, 44 + rh + 40, '#aab6d4', 11.5);
    }

    function infoUpdate() {
      if (!info) return;
      var c = state.pick ? patternColor(PATTERNS[state.phase], state.pick.x, state.pick.y) : null;
      var names = ['R（红）', 'G（绿）', 'B（蓝）'];
      var pos = ['左上', '右上', '左下', '右下'];
      var p = state.pick ? pos[((state.pick.y % 2) * 2) | (state.pick.x % 2)] : '—';
      info.innerHTML =
        '<div><span>点击位置</span><span>' + (state.pick ? '(' + state.pick.x + ', ' + state.pick.y + ')' : '—') + '</span></div>' +
        '<div><span>通道</span><span>' + (c == null ? '—' : names[c]) + '</span></div>' +
        '<div><span>在 2×2 中</span><span>' + p + '</span></div>';
    }

    if (sel) sel.addEventListener('change', function (e) { state.phase = e.target.value; rebuild(); });
    if (zoom) zoom.addEventListener('input', function (e) {
      state.z = parseInt(e.target.value, 10);
      if (zoomv) zoomv.textContent = state.z;
      render();
    });
    cv.addEventListener('click', function (ev) {
      var p = canvasPos(cv, ev);
      var z = state.z;
      var cols = Math.min(16, Math.floor((cv.width * 0.52) / z));
      var rows = Math.min(12, Math.floor((cv.height - 60) / z));
      var x = Math.floor((p.x - 16) / z), y = Math.floor((p.y - 44) / z);
      state.pick = (x >= 0 && y >= 0 && x < cols && y < rows) ? { x: x, y: y } : null;
      infoUpdate();
      render();
    });

    rebuild();
    mount(cv, 0.52, render);
  })();

  /* =========================================================
     演示 2 · 噪声模型 / 光子传递曲线
     ========================================================= */
  (function demo2() {
    var cv = $('d2-canvas');
    if (!cv) return;
    var expS = $('d2-exp'), expV = $('d2-expv');
    var readS = $('d2-read'), readV = $('d2-readv');
    var gainS = $('d2-gain'), gainV = $('d2-gainv');
    var out = $('d2-readout');
    var FWC = 12000;
    var st = { exp: 4000, read: 3, gain: 1 };

    function render() {
      var W = cv.width, H = cv.height, ctx = cv.getContext('2d');
      ctx.fillStyle = '#070b16';
      ctx.fillRect(0, 0, W, H);

      var N = clamp(st.exp, 0, FWC);
      var sigmaE = Math.sqrt(N + st.read * st.read);
      var snr = N / Math.max(sigmaE, 1e-6);
      var snrDB = 20 * Math.log(Math.max(snr, 1e-6)) / Math.LN10;
      var dr = 20 * Math.log(FWC / st.read) / Math.LN10;
      var limited = (N < st.read * st.read * 4) ? '读出噪声受限' : '散粒噪声受限';

      var pw = Math.floor(W * 0.30), ph = Math.floor(H * 0.40);
      var rng = makeRng(99);
      var sig = Math.sqrt(N);
      var STRETCH = 10;   /* 显示拉伸：12 bit 下几 e⁻ 的噪声在 8 bit 上根本看不出来 */
      var patch = rgbaBuffer(48, 40);
      for (var i = 0; i < 48 * 40; i++) {
        var e = clamp(N + sig * rng.g() + st.read * rng.g(), 0, FWC);
        var v = 255 * clamp01(0.5 + (e - N) / FWC * STRETCH);
        patch[i * 4] = v; patch[i * 4 + 1] = v; patch[i * 4 + 2] = v; patch[i * 4 + 3] = 255;
      }
      blit(ctx, 48, 40, patch, 18, 46, pw, ph);
      ctx.strokeStyle = '#26304f';
      ctx.strokeRect(18, 46, pw, ph);
      label(ctx, '增益前（显示拉伸 ×' + STRETCH + '）', 18, 36, '#e8edf9', 12.5);

      var rng2 = makeRng(99);
      var patch2 = rgbaBuffer(48, 40);
      var sat = 0;
      var meanG = N * st.gain;
      for (var j = 0; j < 48 * 40; j++) {
        var e2 = (N + sig * rng2.g() + st.read * rng2.g()) * st.gain;
        if (e2 >= FWC) sat++;
        e2 = clamp(e2, 0, FWC);
        var v2 = 255 * clamp01(0.5 + (e2 - meanG) / FWC * STRETCH);
        patch2[j * 4] = v2; patch2[j * 4 + 1] = v2; patch2[j * 4 + 2] = v2; patch2[j * 4 + 3] = 255;
      }
      var y2 = 46 + ph + 46;
      blit(ctx, 48, 40, patch2, 18, y2, pw, ph);
      ctx.strokeRect(18, y2, pw, ph);
      label(ctx, '增益后（' + st.gain.toFixed(1) + '×，' + (100 * sat / (48 * 40)).toFixed(0) + '% 像素饱和）', 18, y2 - 10, '#ffb454', 12.5);

      var px0 = W * 0.40, px1 = W - 30, py0 = 60, py1 = H - 50;
      ctx.strokeStyle = '#26304f';
      ctx.strokeRect(px0, py0, px1 - px0, py1 - py0);
      label(ctx, '光子传递曲线 PTC：σ² vs 均值（log-log）', px0, 46, '#e8edf9', 12.5);
      label(ctx, '散粒噪声区：斜率 1（σ² ∝ N）', px0 + 10, py0 + 22, '#4cc9f0', 11.5);
      label(ctx, '读出噪声区：平台（σ² ≈ σr²）', px0 + 10, py0 + 40, '#ff6b81', 11.5);

      function lx(v) { return px0 + 20 + (Math.log(v) / Math.log(FWC)) * (px1 - px0 - 40); }
      function ly(v) { return py1 - 10 - (Math.log(clamp(v, 1, 1e9)) / Math.log(1e9)) * (py1 - py0 - 30); }

      ctx.beginPath();
      for (var k = 0; k <= 100; k++) {
        var n = 1 + (FWC - 1) * (k / 100);
        var varTot = n + st.read * st.read;
        var X = lx(n), Y = ly(varTot);
        if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.strokeStyle = '#3ddc97';
      ctx.lineWidth = 2;
      ctx.stroke();

      var yR = ly(st.read * st.read);
      ctx.beginPath(); ctx.moveTo(px0 + 20, yR); ctx.lineTo(px1 - 20, yR);
      ctx.strokeStyle = 'rgba(255,107,129,.7)'; ctx.lineWidth = 1.4; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);

      var cx = lx(Math.max(N, 1)), cy = ly(N + st.read * st.read);
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb454'; ctx.fill();
      label(ctx, '当前', cx + 8, cy - 6, '#ffb454', 11);

      if (out) {
        out.innerHTML =
          '<div><span>满阱 FWC</span><span>' + FWC + ' e⁻</span></div>' +
          '<div><span>SNR（增益前）</span><span>' + snrDB.toFixed(1) + ' dB</span></div>' +
          '<div><span>等价 ISO</span><span>' + Math.round(100 * st.gain) + '</span></div>' +
          '<div><span>动态范围</span><span>' + dr.toFixed(1) + ' dB</span></div>' +
          '<div><span>受限机制</span><span>' + limited + '</span></div>';
      }
    }

    if (expS) expS.addEventListener('input', function (e) {
      st.exp = +e.target.value; if (expV) expV.textContent = st.exp; render();
    });
    if (readS) readS.addEventListener('input', function (e) {
      st.read = +e.target.value; if (readV) readV.textContent = st.read.toFixed(1); render();
    });
    if (gainS) gainS.addEventListener('input', function (e) {
      st.gain = +e.target.value; if (gainV) gainV.textContent = st.gain.toFixed(1) + '×'; render();
    });
    render();
    mount(cv, 0.42, render);
  })();

  /* =========================================================
     演示 3 · 三种去马赛克对比
     ========================================================= */
  (function demo3() {
    var cv = $('d3-canvas');
    if (!cv) return;
    var noiseS = $('d3-noise'), noiseV = $('d3-noisev'), out = $('d3-readout');
    var w = 220, h = 150;
    var st = { noise: 2 };
    /* 场景先过一道轻微光学模糊：镜头 PSF 本来就限制了带宽，
       否则合成图里的 1–2 像素结构是任何算法都不可能恢复的。 */
    var scene = blurScene(buildScene(w, h, 'mixed'), w, h);
    var sc = null;

    function build() {
      /* 曝光取满阱：保证 RAW 归一化后与真值同尺度，PSNR 才有意义 */
      sc = capture(scene, w, h, {
        pattern: 'rggb', exposure: 12000, fwc: 12000, readNoise: 0.5,
        vignette: 0, black: 240, noiseDN: st.noise, seed: 21
      });
    }

    function psnr(a, b) {
      var mse = 0;
      for (var i = 0; i < w * h * 3; i++) {
        var d = (a[i] - b[i]) * 255;
        mse += d * d;
      }
      mse /= (w * h * 3);
      if (mse < 1e-9) return 99;
      return 10 * Math.log(255 * 255 / mse) / Math.LN10;
    }
    function chromaErr(img, fx, fy, fw2, fh2) {
      var sum = 0, n = 0;
      for (var yy = fy; yy < fy + fh2; yy += 2) for (var xx = fx; xx < fx + fw2; xx += 2) {
        var i = (yy * w + xx) * 3;
        var mx = Math.max(img[i], img[i + 1], img[i + 2]), mn = Math.min(img[i], img[i + 1], img[i + 2]);
        sum += (mx - mn); n++;
      }
      return sum / n;
    }

    function render() {
      if (!sc) build();
      var W = cv.width, H = cv.height, ctx = cv.getContext('2d');
      ctx.fillStyle = '#070b16';
      ctx.fillRect(0, 0, W, H);

      var white = 4095 - sc.black;
      var raw = new Float32Array(w * h);
      for (var i = 0; i < w * h; i++) raw[i] = clamp01((sc.dn[i] - sc.black) / white);

      var gt = encodeGamma(scene, w, h, 2.2);
      var imgs = [
        encodeGamma(demosaicBilinear(raw, w, h, 0), w, h, 2.2),
        encodeGamma(demosaicMalvar(raw, w, h, 0), w, h, 2.2),
        encodeGamma(demosaicDir(raw, w, h, 0), w, h, 2.2)
      ];

      var pad = 12, cols = 4;
      var pw = Math.floor((W - pad * (cols + 1)) / cols);
      var ph = Math.round(pw * h / w);
      var y0 = 46;
      var titles = ['真值（无 Bayer）', '双线性', 'Malvar 5×5', '方向自适应'];
      var bufs = [rgbaBuffer(w, h), rgbaBuffer(w, h), rgbaBuffer(w, h), rgbaBuffer(w, h)];
      linearToRGBA(gt, w, h, bufs[0]);
      linearToRGBA(imgs[0], w, h, bufs[1]);
      linearToRGBA(imgs[1], w, h, bufs[2]);
      linearToRGBA(imgs[2], w, h, bufs[3]);

      for (var c = 0; c < cols; c++) {
        var x0 = pad + c * (pw + pad);
        blit(ctx, w, h, bufs[c], x0, y0, pw, ph);
        ctx.strokeStyle = '#26304f';
        ctx.strokeRect(x0, y0, pw, ph);
        label(ctx, titles[c], x0, y0 - 8, '#e8edf9', 11.5);
      }

      var p1 = psnr(imgs[0], gt), p2 = psnr(imgs[1], gt), p3 = psnr(imgs[2], gt);
      var ys = y0 + ph + 26;
      label(ctx, 'PSNR（相对真值，sRGB 域）', pad, ys, '#aab6d4', 12);
      label(ctx, '双线性 ' + p1.toFixed(2) + ' dB　　Malvar ' + p2.toFixed(2) + ' dB　　方向自适应 ' + p3.toFixed(2) + ' dB',
        pad, ys + 20, '#4cc9f0', 12.5);

      /* 栅栏区的平均色度（越大说明伪彩越重） */
      var fx = Math.round(w * 0.53), fy = Math.round(h * 0.08);
      var fw2 = Math.round(w * 0.41), fh2 = Math.round(h * 0.24);
      var ce = [chromaErr(imgs[0], fx, fy, fw2, fh2), chromaErr(imgs[1], fx, fy, fw2, fh2), chromaErr(imgs[2], fx, fy, fw2, fh2)];
      var names = ['双线性', 'Malvar', '方向自适应'];
      var worst = 0;
      for (var q = 1; q < 3; q++) if (ce[q] > ce[worst]) worst = q;
      label(ctx, '栅栏区伪彩强度（越小越好）：' + names[0] + ' ' + (255 * ce[0]).toFixed(1) +
        '　' + names[1] + ' ' + (255 * ce[1]).toFixed(1) + '　' + names[2] + ' ' + (255 * ce[2]).toFixed(1),
        pad, ys + 42, '#7c88a8', 11.5);

      if (out) {
        out.innerHTML =
          '<div><span>双线性 PSNR</span><span>' + p1.toFixed(2) + ' dB</span></div>' +
          '<div><span>Malvar PSNR</span><span>' + p2.toFixed(2) + ' dB</span></div>' +
          '<div><span>方向自适应 PSNR</span><span>' + p3.toFixed(2) + ' dB</span></div>' +
          '<div><span>伪彩最重</span><span>' + names[worst] + '</span></div>';
      }
    }

    if (noiseS) noiseS.addEventListener('input', function (e) {
      st.noise = +e.target.value; if (noiseV) noiseV.textContent = st.noise; build(); render();
    });
    build();
    render();
    mount(cv, 0.50, render);
  })();

  /* =========================================================
     演示 4 · 白平衡方法对比
     ========================================================= */
  (function demo4() {
    var cv = $('d4-canvas');
    if (!cv) return;
    var illS = $('d4-illum'), sceneS = $('d4-scene'), methodS = $('d4-method');
    var rS = $('d4-r'), bS = $('d4-b'), rV = $('d4-rv'), bV = $('d4-bv');
    var out = $('d4-readout');
    var w = 200, h = 150;
    var st = { scene: 'mixed', ill: 'd65', method: 'gray', gr: 1, gb: 1 };
    var scenes = {};

    function getScene(v) {
      if (!scenes[v]) scenes[v] = buildScene(w, h, v);
      return scenes[v];
    }

    function render() {
      var W = cv.width, H = cv.height, ctx = cv.getContext('2d');
      ctx.fillStyle = '#070b16';
      ctx.fillRect(0, 0, W, H);

      var scene = getScene(st.scene);
      var illum = ILLUM[st.ill];
      var sc = capture(scene, w, h, {
        pattern: 'rggb', illum: illum, exposure: 8000, fwc: 12000,
        readNoise: 1.5, vignette: 0.35, black: 240, seed: 5
      });
      var white = 4095 - sc.black;
      var raw = new Float32Array(w * h);
      for (var i = 0; i < w * h; i++) raw[i] = clamp01((sc.dn[i] - sc.black) / white);

      var base = demosaicMalvar(raw, w, h, 0);   /* 线性 RGB，未白平衡 */

      var gains;
      if (st.method === 'manual') gains = [st.gr, st.gb];
      else gains = estimateGains(base, w, h, st.method, illum);

      var img = applyGains(base, w, h, gains[0], gains[1]);
      img = applyCCM(img, w, h, ccmBlend(1));

      var baseDisp = encodeGamma(applyCCM(base, w, h, ccmBlend(1)), w, h, 2.2);
      var imgDisp = encodeGamma(img, w, h, 2.2);

      var pad = 14;
      var bigW = Math.floor(W * 0.54);
      var bigH = Math.round(bigW * h / w);
      var smallW = Math.floor((W - pad * 3 - bigW) / 2);
      var smallH = Math.round(smallW * h / w);

      var bufA = rgbaBuffer(w, h), bufB = rgbaBuffer(w, h);
      linearToRGBA(imgDisp, w, h, bufA);
      linearToRGBA(baseDisp, w, h, bufB);

      var by = 52;
      blit(ctx, w, h, bufA, pad, by, bigW, bigH);
      ctx.strokeStyle = '#3ddc97';
      ctx.strokeRect(pad, by, bigW, bigH);
      label(ctx, 'AWB 校正后', pad, by - 10, '#3ddc97', 12.5);

      var sx = pad + bigW + pad;
      blit(ctx, w, h, bufB, sx, by, smallW, smallH);
      ctx.strokeStyle = '#26304f';
      ctx.strokeRect(sx, by, smallW, smallH);
      label(ctx, 'sensor 看到的（未校正）', sx, by - 10, '#aab6d4', 11.5);

      var gy = by + smallH + 34;
      label(ctx, '中性灰参考块（应满足 R = G = B）', sx, gy - 10, '#e8edf9', 11.5);
      var rect = grayCard(st.scene, w, h);
      var sumR = 0, sumG = 0, sumB = 0, n = 0;
      for (var y = rect.y0; y < rect.y1; y++) {
        for (var x = rect.x0; x < rect.x1; x++) {
          var k = (y * w + x) * 3;
          sumR += img[k]; sumG += img[k + 1]; sumB += img[k + 2]; n++;
        }
      }
      var mr = sumR / Math.max(n, 1), mg = sumG / Math.max(n, 1), mb = sumB / Math.max(n, 1);
      var swid = Math.min(46, Math.max(24, Math.floor((smallW - 16) / 3))), shh = 34, gapS = 8;
      function swatch(val, x, lbl) {
        var v = Math.round(255 * srgbEncode(val));
        ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
        ctx.fillRect(x, gy, swid, shh);
        ctx.strokeStyle = '#26304f';
        ctx.strokeRect(x, gy, swid, shh);
        label(ctx, lbl, x + 1, gy - 3, '#7c88a8', 10);
        label(ctx, String(v), x + swid / 2, gy + shh + 13, '#4cc9f0', 11, 'middle');
      }
      swatch(mr, sx, 'R');
      swatch(mg, sx + swid + gapS, 'G');
      swatch(mb, sx + (swid + gapS) * 2, 'B');

      var mx = Math.max(mr, mg, mb), mn = Math.min(mr, mg, mb);
      var spreadEV = 2 * Math.log(Math.max(mx, 1e-6) / Math.max(mn, 1e-6)) / Math.LN2;

      if (out) {
        out.innerHTML =
          '<div><span>灰卡 R/G/B</span><span>' + [mr, mg, mb].map(function (v) { return Math.round(255 * srgbEncode(v)); }).join(' / ') + '</span></div>' +
          '<div><span>残留色偏</span><span>' + spreadEV.toFixed(2) + ' EV</span></div>' +
          '<div><span>估计增益 R/B</span><span>' + gains[0].toFixed(2) + ' / ' + gains[1].toFixed(2) + '</span></div>';
      }
      if (st.method === 'manual' && rV) rV.textContent = st.gr.toFixed(2);
      if (st.method === 'manual' && bV) bV.textContent = st.gb.toFixed(2);
    }

    if (sceneS) sceneS.addEventListener('change', function (e) { st.scene = e.target.value; render(); });
    if (illS) illS.addEventListener('change', function (e) { st.ill = e.target.value; render(); });
    if (methodS) methodS.addEventListener('change', function (e) { st.method = e.target.value; render(); });
    if (rS) rS.addEventListener('input', function (e) {
      st.gr = +e.target.value; st.method = 'manual';
      if (methodS) methodS.value = 'manual';
      if (rV) rV.textContent = st.gr.toFixed(2);
      render();
    });
    if (bS) bS.addEventListener('input', function (e) {
      st.gb = +e.target.value; st.method = 'manual';
      if (methodS) methodS.value = 'manual';
      if (bV) bV.textContent = st.gb.toFixed(2);
      render();
    });

    render();
    mount(cv, 0.50, render);
  })();

  /* =========================================================
     演示 5 · Gamma 与位深
     ========================================================= */
  (function demo5() {
    var cv = $('d5-canvas');
    if (!cv) return;
    var gS = $('d5-gamma'), gV = $('d5-gammav');
    var bS = $('d5-bits'), bV = $('d5-bitsv');
    var out = $('d5-readout');
    var st = { gamma: 2.2, bits: 8 };
    var sw = 120, sh = 90;
    var darkScene = null;

    function getDark() {
      if (!darkScene) {
        darkScene = new Float32Array(buildScene(sw, sh, 'green'));
        for (var i = 0; i < darkScene.length; i++) darkScene[i] *= 0.05;
      }
      return darkScene;
    }
    function quantize(v, bits) {
      var L = Math.pow(2, bits) - 1;
      return Math.round(clamp01(v) * L) / L;
    }

    function render() {
      var W = cv.width, H = cv.height, ctx = cv.getContext('2d');
      ctx.fillStyle = '#070b16';
      ctx.fillRect(0, 0, W, H);

      var pad = 14, gapx = 26;
      var cellW = Math.floor((W - pad * 2 - gapx) / 2);
      var cellH = Math.round(H * 0.34);
      var rowY = [54, 54 + cellH + 58];

      var ramp = rgbaBuffer(200, 10);
      function drawRamp(x0, y0, w0, h0, useGamma) {
        for (var x = 0; x < 200; x++) {
          var L = x / 199;
          var v = useGamma ? powEncode(L, st.gamma) : L;
          v = quantize(v, st.bits);
          for (var y = 0; y < 10; y++) {
            var i = (y * 200 + x) * 4;
            var g = 255 * v;
            ramp[i] = g; ramp[i + 1] = g; ramp[i + 2] = g; ramp[i + 3] = 255;
          }
        }
        blit(ctx, 200, 10, ramp, x0, y0, w0, h0);
        ctx.strokeStyle = '#26304f';
        ctx.strokeRect(x0, y0, w0, h0);
      }

      drawRamp(pad, rowY[0], cellW, cellH, true);
      label(ctx, 'gamma ' + st.gamma.toFixed(2) + ' 编码 + ' + st.bits + ' bit', pad, rowY[0] - 8, '#4cc9f0', 12);
      drawRamp(pad + cellW + gapx, rowY[0], cellW, cellH, false);
      label(ctx, '线性编码 + ' + st.bits + ' bit（同一斜坡）', pad + cellW + gapx, rowY[0] - 8, '#ff6b81', 12);

      var dark = getDark();
      var bufL = rgbaBuffer(sw, sh), bufG = rgbaBuffer(sw, sh);
      for (var t = 0; t < sw * sh; t++) {
        for (var c = 0; c < 3; c++) {
          var Lg = quantize(powEncode(dark[t * 3 + c], st.gamma), st.bits);
          var Ll = quantize(dark[t * 3 + c], st.bits);
          bufG[t * 4 + c] = 255 * Lg;
          bufL[t * 4 + c] = 255 * Ll;
        }
        bufG[t * 4 + 3] = 255; bufL[t * 4 + 3] = 255;
      }
      blit(ctx, sw, sh, bufG, pad, rowY[1], cellW, cellH);
      ctx.strokeStyle = '#26304f'; ctx.strokeRect(pad, rowY[1], cellW, cellH);
      label(ctx, '夜景 + gamma 编码', pad, rowY[1] - 8, '#4cc9f0', 12);

      blit(ctx, sw, sh, bufL, pad + cellW + gapx, rowY[1], cellW, cellH);
      ctx.strokeRect(pad + cellW + gapx, rowY[1], cellW, cellH);
      label(ctx, '夜景 + 线性编码（暗部糊成一块）', pad + cellW + gapx, rowY[1] - 8, '#ff6b81', 12);

      var Lmax = Math.pow(2, st.bits) - 1;
      var codesG = Math.round(powEncode(0.01, st.gamma) * Lmax);
      var codesL = Math.round(0.01 * Lmax);
      var step = 255 / Lmax;
      var band = step > 2 ? '明显' : (step > 1 ? '轻微' : '不可见');

      if (out) {
        out.innerHTML =
          '<div><span>最暗 1% 的码值（gamma）</span><span>' + codesG + ' / ' + Lmax + '</span></div>' +
          '<div><span>最暗 1% 的码值（线性）</span><span>' + codesL + ' / ' + Lmax + '</span></div>' +
          '<div><span>每个码值对应 sRGB</span><span>' + step.toFixed(2) + ' DN</span></div>' +
          '<div><span>banding 可见性</span><span>' + band + '</span></div>';
      }
    }

    if (gS) gS.addEventListener('input', function (e) {
      st.gamma = +e.target.value; if (gV) gV.textContent = st.gamma.toFixed(2); render();
    });
    if (bS) bS.addEventListener('input', function (e) {
      st.bits = +e.target.value; if (bV) bV.textContent = st.bits; render();
    });
    render();
    mount(cv, 0.50, render);
  })();

  /* =========================================================
     演示 6 · 逐级跳过对比
     ========================================================= */
  (function demo6() {
    var cv = $('d6-canvas');
    if (!cv) return;
    var picker = $('d6-stages');
    var paramS = $('d6-param'), paramV = $('d6-paramv'), out = $('d6-readout');
    var w = 190, h = 140;
    var st = { stage: 'blc', v: 50 };
    var scene = buildScene(w, h, 'mixed');
    var illum = ILLUM.tungsten;
    var cache = null;

    var INFO = {
      blc: ['黑电平 BLC', 'RAW · 线性', '暗部不黑、发灰或发紫；后面所有乘性校正都错位', '扣除量（1.0 = 标定值）'],
      lsc: ['暗角 LSC', 'RAW · 线性', '四角变暗且偏色；边角噪声更明显', '补偿强度'],
      dpc: ['坏点 DPCC', 'RAW · 线性', '亮点被插值扩散成彩色斑块', '校正比例'],
      demosaic: ['去马赛克', 'RAW → RGB', '颜色完全丢失，只剩灰度马赛克', '（无参数）'],
      awb: ['白平衡 AWB', 'RGB · 线性', '整体偏色（灯下偏黄，阴影偏蓝）', '增益生效比例'],
      ccm: ['色彩校正 CCM', 'RGB · 线性', '颜色「像但不对」：肤色发黄、红色发橙', '矩阵混合强度'],
      gamma: ['Gamma 编码', '线性 → 感知', '暗部死黑、层次压缩；但噪声看起来更小', 'gamma 值'],
      sharp: ['锐化 + 色度降噪', 'YUV · 感知', '整体发糊，彩色边缘发虚', '锐化强度']
    };

    function build() {
      cache = capture(scene, w, h, {
        pattern: 'rggb', illum: illum, exposure: 9000, fwc: 12000,
        readNoise: 2, vignette: 0.62, black: 240, defects: 55, noiseDN: 1.2, seed: 33
      });
    }

    function optsFor(stage, v) {
      var p = v / 50;
      var o = {
        phase: 0,
        gains: [illum[1] / illum[0], illum[1] / illum[2]],
        blc: 1, lsc: 1, dpc: 1, awb: 1, ccm: 1, gamma: 2.2, sharp: 0.8
      };
      if (stage === 'blc') o.blc = p;
      if (stage === 'lsc') o.lsc = p;
      if (stage === 'dpc') o.dpc = clamp(v / 100, 0, 1);
      if (stage === 'awb') o.awb = p;
      if (stage === 'ccm') o.ccm = p;
      if (stage === 'gamma') o.gamma = 1 + p;
      if (stage === 'sharp') o.sharp = p * 1.2;
      return o;
    }

    function paramText(stage) {
      if (stage === 'gamma') return 'gamma ' + (1 + st.v / 50).toFixed(2);
      if (stage === 'blc') return (st.v / 50).toFixed(2) + '× 黑电平';
      if (stage === 'dpc') return Math.round(clamp(st.v / 100, 0, 1) * 100) + '%';
      return (st.v / 50).toFixed(2);
    }

    function render() {
      if (!cache) build();
      var W = cv.width, H = cv.height, ctx = cv.getContext('2d');
      ctx.fillStyle = '#070b16';
      ctx.fillRect(0, 0, W, H);

      var A = runPipeline(cache, w, h, optsFor(st.stage, st.v));
      var o2 = optsFor(st.stage, st.v);
      o2.skip = st.stage;
      var B = runPipeline(cache, w, h, o2);

      var pad = 14, top = 56;
      var pw = Math.floor((W - pad * 3) / 2);
      var ph = Math.round(pw * h / w);
      var bA = rgbaBuffer(w, h), bB = rgbaBuffer(w, h);
      linearToRGBA(A.rgb, w, h, bA);
      linearToRGBA(B.rgb, w, h, bB);

      blit(ctx, w, h, bA, pad, top, pw, ph);
      ctx.strokeStyle = '#3ddc97'; ctx.strokeRect(pad, top, pw, ph);
      label(ctx, '正常输出', pad, top - 10, '#3ddc97', 12.5);

      var x2 = pad * 2 + pw;
      blit(ctx, w, h, bB, x2, top, pw, ph);
      ctx.strokeStyle = '#ff6b81'; ctx.strokeRect(x2, top, pw, ph);
      label(ctx, '跳过「' + INFO[st.stage][0] + '」', x2, top - 10, '#ff6b81', 12.5);

      var info = INFO[st.stage];
      label(ctx, info[3] + '：' + paramText(st.stage), pad, top + ph + 26, '#aab6d4', 12);
      label(ctx, '光源：钨丝灯（约 2800K）→ 未做 AWB 时整体偏黄', pad, top + ph + 46, '#7c88a8', 11);

      if (out) {
        out.innerHTML =
          '<div><span>当前级</span><span>' + info[0] + '</span></div>' +
          '<div><span>作用域</span><span>' + info[1] + '</span></div>' +
          '<div><span>跳过后果</span><span>' + info[2] + '</span></div>';
      }
      if (paramV) paramV.textContent = paramText(st.stage);
    }

    if (picker) {
      picker.addEventListener('click', function (ev) {
        var el = ev.target;
        while (el && el !== picker) {
          if (el.dataset && el.dataset.stage) break;
          el = el.parentNode;
        }
        if (!el || el === picker || !el.dataset || !el.dataset.stage) return;
        st.stage = el.dataset.stage;
        var kids = picker.children || [];
        for (var i = 0; i < kids.length; i++) {
          var on = kids[i].dataset && kids[i].dataset.stage === st.stage;
          kids[i].className = on ? 'on' : '';
        }
        render();
      });
    }
    if (paramS) paramS.addEventListener('input', function (e) { st.v = +e.target.value; render(); });

    render();
    mount(cv, 0.48, render);
  })();

  /* =========================================================
     自测题
     ========================================================= */
  (function quiz() {
    var root = $('quiz');
    if (!root) return;
    var ANSWERS = { '1': 'b', '2': 'a', '3': 'b', '4': 'a', '5': 'b', '6': 'b' };
    var answered = {};

    function score() {
      var n = 0, ok = 0;
      for (var k in answered) { n++; if (answered[k] === ANSWERS[k]) ok++; }
      var el = $('quiz-score');
      if (el) el.textContent = '已答 ' + n + ' / 6　正确 ' + ok;
    }

    function closest(el, cls) {
      while (el) {
        if (el.className && String(el.className).split(/\s+/).indexOf(cls) >= 0) return el;
        el = el.parentNode;
      }
      return null;
    }

    root.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.dataset || !t.dataset.k) return;
      var item = closest(t, 'quiz-item');
      if (!item) return;
      var q = item.dataset ? item.dataset.q : null;
      if (!q || answered[q]) return;
      answered[q] = t.dataset.k;

      var opts = item.querySelectorAll('.opt');
      for (var i = 0; i < opts.length; i++) {
        var o = opts[i];
        var k = o.dataset ? o.dataset.k : null;
        if (k === ANSWERS[q]) o.className = 'opt right';
        else if (k === t.dataset.k) o.className = 'opt wrong';
      }
      var exp = item.querySelector('.exp');
      if (exp) exp.className = 'exp show';
      score();
    });

    var reset = $('quiz-reset');
    if (reset) reset.addEventListener('click', function () {
      answered = {};
      var items = root.querySelectorAll('.quiz-item');
      for (var i = 0; i < items.length; i++) {
        var opts = items[i].querySelectorAll('.opt');
        for (var j = 0; j < opts.length; j++) opts[j].className = 'opt';
        var exp = items[i].querySelector('.exp');
        if (exp) exp.className = 'exp';
      }
      score();
    });

    score();
  })();

  /* 调试出口：仅用于本地数值自检（页面不依赖） */
  window.ISP = {
    buildScene: buildScene,
    blurScene: blurScene,
    capture: capture,
    demosaicBilinear: demosaicBilinear,
    demosaicMalvar: demosaicMalvar,
    demosaicDir: demosaicDir,
    encodeGamma: encodeGamma,
    srgbEncode: srgbEncode
  };
})();
