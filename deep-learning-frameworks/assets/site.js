/* ===========================================================
   站点公共脚本：阅读进度、目录高亮、通用画布工具
   =========================================================== */
(function () {
  'use strict';

  /* ---------- 阅读进度条 ---------- */
  var bar = document.getElementById('progress');
  function onScroll() {
    if (!bar) return;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (h > 0 ? Math.min(100, (window.scrollY / h) * 100) : 0) + '%';
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  /* ---------- 目录 / 顶栏高亮 ---------- */
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('#tocList a'));
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('#topnav a'));
  var sections = tocLinks
    .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
    .filter(Boolean);

  function setActive(id) {
    tocLinks.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + id);
    });
  }

  if ('IntersectionObserver' in window && sections.length) {
    var io = new IntersectionObserver(function (entries) {
      var best = null;
      entries.forEach(function (e) {
        if (e.isIntersecting && (!best || e.intersectionRatio > best.intersectionRatio)) best = e;
      });
      if (best) setActive(best.target.id);
    }, { rootMargin: '-84px 0px -60% 0px', threshold: [0.02, 0.2, 0.5] });
    sections.forEach(function (s) { io.observe(s); });
  }

  /* ---------- 通用工具 ---------- */
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function fit(canvas) {
    var r = canvas.getBoundingClientRect();
    var w = Math.max(200, Math.round(r.width));
    canvas.width = w;
    canvas.height = Math.round(w * 0.6);
    return { w: canvas.width, h: canvas.height };
  }
  function rng(seed) {
    var s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  function iou(a, b) {
    var x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    var x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    var iw = x2 - x1, ih = y2 - y1;
    if (iw <= 0 || ih <= 0) return 0;
    var inter = iw * ih;
    return inter / (a.w * a.h + b.w * b.h - inter);
  }
  function rr(ctx, b, r) {
    r = Math.min(r || 6, b.w / 2, b.h / 2);
    ctx.beginPath();
    ctx.moveTo(b.x + r, b.y);
    ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, r);
    ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, r);
    ctx.arcTo(b.x, b.y + b.h, b.x, b.y, r);
    ctx.arcTo(b.x, b.y, b.x + b.w, b.y, r);
    ctx.closePath();
  }

  window.DSH = {
    el: el, fit: fit, rng: rng, iou: iou, rr: rr,
    $: function (s, root) { return (root || document).querySelector(s); },
    $$: function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); },
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    // 通用「随窗口变化重绘」绑定
    responsive: function (canvas, draw) {
      var raf = null;
      function run() {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function () {
          fit(canvas);
          draw();
        });
      }
      window.addEventListener('resize', run);
      // 首次渲染：等布局稳定
      requestAnimationFrame(run);
      return run;
    }
  };
})();
