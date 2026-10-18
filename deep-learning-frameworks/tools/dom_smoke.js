/* 在 Node 中用 mock DOM/Canvas 真正跑一遍交互脚本，捕获运行时错误。
   用法: node tools/dom_smoke.js <html文件> <脚本1> [脚本2 ...]           */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const htmlFile = process.argv[2];
const scripts = process.argv.slice(3);

const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
const SCRIPT_DIR = path.join(ROOT, 'assets');

/* ---------- 从 HTML 收集 id ---------- */
const ids = new Map();
const idRe = /<(\w+)([^>]*?)id=["']([^"']+)["']([^>]*?)>/g;
let m;
while ((m = idRe.exec(html))) {
  ids.set(m[3], { tag: m[1].toLowerCase(), attrs: m[2] + m[4] });
}

/* ---------- mock Canvas 2D ---------- */
const NUMERIC = () => 0;
function makeCtx() {
  const ctx = {
    canvas: null,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1,
    shadowColor: '', shadowBlur: 0, textAlign: '', textBaseline: '',
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, arcTo() {}, rect() {}, fill() {}, stroke() {}, clip() {}, fillRect() {},
    strokeRect() {}, clearRect() {}, setLineDash() {}, fillText() {}, strokeText() {},
    translate() {}, rotate() {}, scale() {}, drawImage() {}, setTransform() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    measureText: (t) => ({ width: String(t).length * 7 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData() {}
  };
  return ctx;
}

/* ---------- mock 元素 ---------- */
const nodes = new Map();
function makeEl(tag, id, attrs) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    id: id || '',
    className: '',
    style: {},
    dataset: {},
    children: [],
    listeners: {},
    _text: '',
    _html: '',
    value: '',
    checked: false,
    disabled: false,
    width: 900,
    height: 540,
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    setAttribute(k, v) { this[k] = v; if (k === 'id') this.id = v; },
    getAttribute(k) { return this[k] === undefined ? null : this[k]; },
    removeAttribute(k) { delete this[k]; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    insertBefore(c) { this.children.unshift(c); c.parentNode = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); }, remove() {},
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    get childNodes() { return this.children; },
    querySelector(sel) { return queryIn(this, sel); },
    querySelectorAll(sel) { return queryAllIn(this, sel); },
    closest(sel) { return sel.startsWith('.') ? (String(this.className).split(/\s+/).includes(sel.slice(1)) ? this : null) : null; },
    setPointerCapture() {}, releasePointerCapture() {},
    focus() {}, blur() {},
    scrollIntoView() {},
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 540, width: 900, height: 540 }; },
    getContext() { const c = makeCtx(); c.canvas = this; return c; }
  };
  if (tag === 'canvas') { el.width = 900; el.height = 540; }
  if (attrs && /type=["']range["']/.test(attrs)) {
    const v = /value=["'](-?[\d.]+)["']/.exec(attrs);
    const mn = /min=["'](-?[\d.]+)["']/.exec(attrs);
    const mx = /max=["'](-?[\d.]+)["']/.exec(attrs);
    const st = /step=["'](-?[\d.]+)["']/.exec(attrs);
    el.value = v ? v[1] : '0';
    el.min = mn ? mn[1] : '0';
    el.max = mx ? mx[1] : '100';
    el.step = st ? st[1] : '1';
  }
  if (attrs && /<option/.test(attrs)) el.value = 'pool';
  return el;
}

/* CSS 选择器：只支持 tag / .class / #id / [data-x] / 组合的简单形式 */
function matchSimple(el, part) {
  part = part.trim();
  if (!part) return true;
  const attr = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(part);
  if (attr) {
    const key = attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const val = el.dataset[key] !== undefined ? el.dataset[key] : el[key];
    if (val === undefined) return false;
    return attr[2] === undefined || String(val) === attr[2];
  }
  if (part.startsWith('#')) return el.id === part.slice(1);
  if (part.startsWith('.')) return String(el.className).split(/\s+/).includes(part.slice(1));
  return el.tagName === part.toUpperCase();
}
function matchSel(el, sel) {
  return sel.split(/\s+/).filter(Boolean).every((p) => matchSimple(el, p.split(':')[0]));
}
function allNodes() {
  return [...nodes.values()];
}
function queryAllIn(root, sel) {
  if (root === document) return allNodes().filter((e) => matchSel(e, sel));
  return allNodes().filter((e) => matchSel(e, sel));
}
function queryIn(root, sel) {
  const r = queryAllIn(root, sel);
  return r.length ? r[0] : null;
}

/* 解析 HTML 里出现的元素，注册到 nodes（至少覆盖所有带 id 的节点 + 其 class/tag/data-*） */
for (const [id, info] of ids) {
  const el = makeEl(info.tag, id, info.attrs);
  const cls = /class=["']([^"']+)["']/.exec(info.attrs);
  if (cls) el.className = cls[1];
  const dataRe = /data-([\w-]+)=["']([^"']*)["']/g;
  let d;
  while ((d = dataRe.exec(info.attrs))) {
    el.dataset[d[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = d[2];
    el['data-' + d[1]] = d[2];
  }
  if (info.tag === 'input') {
    const t = /type=["'](\w+)["']/.exec(info.attrs);
    if (t) el.type = t[1];
  }
  nodes.set(id, el);
}

/* 为 .btn-row[data-q] 这类没有 id 的容器补节点 */
const containerRe = /<div class="(btn-row|stage-picker|quiz-item)[^"]*"([^>]*)>/g;
while ((m = containerRe.exec(html))) {
  const el = makeEl('div', '', m[2]);
  el.className = m[1] + (/class="[^"]*\s([\w-]+)/.exec(m[0]) ? '' : '');
  const cls = /class="([^"]+)"/.exec(m[0]);
  if (cls) el.className = cls[1];
  const dataRe = /data-([\w-]+)=["']([^"']*)["']/g;
  let d;
  while ((d = dataRe.exec(m[2]))) el.dataset[d[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = d[2];
  if (!nodes.has('__tmp' + nodes.size)) nodes.set('__tmp' + nodes.size, el);
}

/* btn-row 里的 button[data-v] */
const btnRe = /<button([^>]*data-v=["'][^"']+["'][^>]*)>/g;
while ((m = btnRe.exec(html))) {
  const el = makeEl('button', '', m[1]);
  const v = /data-v=["']([^"']+)["']/.exec(m[1]);
  if (v) el.dataset.v = v[1];
  const q = /data-q=["']([^"']+)["']/.exec(m[1]);
  if (q) el.dataset.q = q[1];
  nodes.set('__btn' + nodes.size, el);
}

/* ---------- mock document / window ---------- */
const document = {
  documentElement: { scrollHeight: 4000, clientHeight: 800 },
  body: makeEl('body', '', ''),
  querySelector: (s) => queryIn(document, s),
  querySelectorAll: (s) => queryAllIn(document, s),
  createElement: (t) => makeEl(t, '', ''),
  createElementNS: (ns, t) => makeEl(t, '', ''),
  getElementById: (i) => nodes.get(i) || null,
  addEventListener() {},
  removeEventListener() {}
};

const window = {
  innerHeight: 900,
  scrollY: 0,
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame: (fn) => { frameQueue.push(fn); return frameQueue.length; },
  cancelAnimationFrame() {},
  getComputedStyle: () => ({ fontFamily: 'sans-serif' }),
  devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  location: { href: 'file:///' + htmlFile, hash: '' }
};
const frameQueue = [];

global.document = document;
global.window = window;
global.getComputedStyle = window.getComputedStyle;
global.requestAnimationFrame = window.requestAnimationFrame;
global.cancelAnimationFrame = window.cancelAnimationFrame;
global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
global.setInterval = () => 0;
global.clearInterval = () => {};
global.navigator = { userAgent: 'node' };

Object.defineProperty(window, 'scrollTo', { value() {} });

/* ---------- 执行脚本 ---------- */
let failed = 0;
const sandbox = {
  document, window, console,
  requestAnimationFrame: window.requestAnimationFrame,
  cancelAnimationFrame: window.cancelAnimationFrame,
  getComputedStyle: window.getComputedStyle,
  IntersectionObserver: global.IntersectionObserver,
  setInterval: global.setInterval,
  clearInterval: global.clearInterval,
  Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, parseInt, parseFloat
};
sandbox.globalThis = sandbox;
sandbox.window.DSH = undefined;

for (const s of scripts) {
  const code = fs.readFileSync(path.join(SCRIPT_DIR, s), 'utf8');
  try {
    vm.runInNewContext(code, sandbox, { filename: s });
    console.log(`[ OK ] 执行 ${s} 无异常`);
  } catch (e) {
    failed++;
    console.log(`[FAIL] ${s}: ${e.message}`);
    console.log(String(e.stack).split('\n').slice(0, 4).join('\n'));
  }
}

/* 跑一遍 requestAnimationFrame 回调（很多绘图在首次 rAF 里） */
let rounds = 0;
while (frameQueue.length && rounds < 12) {
  const q = frameQueue.splice(0, frameQueue.length);
  for (const fn of q) {
    try { fn(); } catch (e) {
      failed++;
      console.log(`[FAIL] rAF 回调: ${e.message}`);
      console.log(String(e.stack).split('\n').slice(0, 4).join('\n'));
    }
  }
  rounds++;
}
console.log(`[info] 执行了 ${rounds} 轮动画帧回调（含各演示首次绘制）`);

/* 触发所有 input/change 事件，模拟拖动滑块 */
let fired = 0;
for (const el of nodes.values()) {
  for (const t of ['input', 'change']) {
    const ls = el.listeners[t];
    if (!ls) continue;
    for (const fn of ls) {
      try { fn({ target: el, clientX: 100, clientY: 100, pointerId: 1, preventDefault() {} }); fired++; }
      catch (e) {
        failed++;
        console.log(`[FAIL] #${el.id || el.className} ${t} 处理异常: ${e.message}`);
        console.log(String(e.stack).split('\n').slice(0, 4).join('\n'));
      }
    }
  }
}
console.log(`[info] 触发了 ${fired} 次 input/change 事件`);

/* 触发点击事件（选型按钮、标签页、测验选项） */
let clicks = 0;
for (const el of nodes.values()) {
  const ls = el.listeners['click'];
  if (!ls) continue;
  for (const fn of ls) {
    try {
      fn({ target: el, preventDefault() {}, currentTarget: el });
      // 让 closest 在事件里能工作：给 target 挂一个最简 closest
      clicks++;
    } catch (e) {
      failed++;
      console.log(`[FAIL] click 处理异常: ${e.message}`);
      console.log(String(e.stack).split('\n').slice(0, 4).join('\n'));
    }
  }
}
console.log(`[info] 触发了 ${clicks} 次 click 事件`);

console.log(failed ? `\n结果: ${failed} 个错误` : '\n结果: 全部通过');
process.exit(failed ? 1 : 0);
