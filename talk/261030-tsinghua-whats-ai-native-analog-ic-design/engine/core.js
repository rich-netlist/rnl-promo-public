/* =====================================================================
   core.js — 幻灯片引擎（单文件演讲版）
   16:9 舞台、分步揭示、右侧章节导航、控制条、导出本页 PDF，另有：
   - 一个文件放全部章节；<section class="scene" data-sec="4" data-beat="4.1">，
     每节第一页写 data-sec-title；右侧导航按节分级，页码是脚本的拍号
   - 分步：[data-step="n"] 第 n 步起出现；[data-hot="2,4-5"] 在这几步加 .hot；[data-off="n"] 第 n 步起加 .off
   - 原理图：<div class="fig-svg" data-fig="ota5t" data-hl='{"1":["#M1","#M2"]}'>，SVG 取自 assets 生成的 figs.js
   - 演讲备注：<aside class="notes">，N 打开备注条，S 打开讲者视图（另一个窗口，与主窗口同步）
   - 草稿模式（D）：含 [核实] 的页右上角显示标记；附录页自动汇总 [核实] 与待补素材
   ===================================================================== */
(() => {
'use strict';
const root = document.documentElement;

/* ---------------- 工具函数 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function H(tag, attrs, parent) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null) continue;
    if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v);
  }
  if (parent) parent.appendChild(e);
  return e;
}
const motionQ = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = motionQ.matches;
if (motionQ.addEventListener) motionQ.addEventListener('change', e => { reduced = e.matches; });
const store = {
  get(k, d) { try { const v = localStorage.getItem('rnlslides.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('rnlslides.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};
/* "2,4-6" → Set{2,4,5,6} */
function stepSet(spec) {
  const s = new Set();
  String(spec || '').split(',').map(x => x.trim()).filter(Boolean).forEach(p => {
    const m = p.match(/^(\d+)-(\d+)$/);
    if (m) for (let k = +m[1]; k <= +m[2]; k++) s.add(k); else s.add(+p);
  });
  return s;
}
const pad2 = n => String(n).padStart(2, '0');

/* ---------------- 主题与模式 ---------------- */
const darkQ = matchMedia('(prefers-color-scheme: dark)');
const theme = {
  init() { const t = store.get('theme', null); if (t === 'light' || t === 'dark') root.dataset.theme = t; },
  current() { return root.dataset.theme || (darkQ.matches ? 'dark' : 'light'); },
  toggle() { root.dataset.theme = this.current() === 'dark' ? 'light' : 'dark'; store.set('theme', root.dataset.theme); }
};
theme.init();
const params = new URLSearchParams(location.search);
const PRESENTER = params.has('presenter');

/* ---------------- 原理图：把 figs.js 里的 SVG 放进页面 ---------------- */
function mountFigure(el) {
  const name = el.dataset.fig, figs = window.RNL_FIGS || {};
  if (!figs[name]) { el.innerHTML = `<div class="placeholder"><b>图 ${name}</b>先运行 assets/build.py 生成</div>`; return; }
  el.innerHTML = figs[name];
  const svg = $('svg', el);
  if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet'); }
  if (svg && el.closest('.ink-dark')) $$('[stroke], [fill]', svg).forEach(e => ['stroke', 'fill'].forEach(a => {
    const c = e.getAttribute(a);
    if (c) e.setAttribute(a, darkColour(c));
  }));
}
// 黑底上的图：和 RNL 查看器的“深色背景”同一条规则（apps/viewer-ui/background.js）：
// HSL 亮度低于 0.25 的颜色把亮度翻成 1 − L，色相、饱和度、透明度不变；黑字变白字，红、绿不动。
function darkColour(c) {
  if (!/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(c)) return c;
  const hex = c.slice(1), full = hex.length <= 4 ? [...hex].map(x => x + x).join('') : hex;
  const rgb = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
  const l = (Math.min(...rgb) + Math.max(...rgb)) / 2;
  if (l >= .25) return c;
  const shift = 1 - 2 * l;
  return '#' + rgb.map(x => Math.round((x + shift) * 255).toString(16).padStart(2, '0')).join('') + full.slice(6);
}
function figureStep(el, n) {
  if (!el.dataset.hl) return;
  let map = {};
  try { map = JSON.parse(el.dataset.hl); } catch (e) { console.warn('data-hl 不是 JSON', el); return; }
  const ids = map[n] || [];   // "#M1" 也匹配它的文字 "#M1::name"
  const hit = id => ids.some(x => id === x || id.startsWith(x + '::'));
  $$('g[data-id]', el).forEach(g => g.classList.toggle('hot', hit(g.dataset.id)));
  el.classList.toggle('dimmed', ids.length > 0);
}

/* ---------------- 网表原文：<pre class="code" data-netlist="ota5t" data-lines="5-17,41-42"> ----------------
   文字取自 figs.js 的 RNL_SRC（就是出图的那个文件），按 RNL 查看器的规则着色（apps/viewer-ui 的
   syntax.js 与默认的网表配色）：# 器件、& 网络、$ 定义、% 局部名、? 与括号里的角色和参数名、@ 关键字、
   字符串、自由文字；@RNL 记录所在的行加 .rnl（浅绿底）。几段行号之间插一行折叠说明（data-fold）。 */
const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const KEYWORD_CHAR = /[\p{L}\p{N}_-]/u, NAME_CHAR = /[\p{L}\p{N}_.\-/]/u;
const REF_CLASS = { '#': 'host', '&': 'net', '$': 'def', '%': 'local', '?': 'param' };
const SPECTRE_WORDS = new Set(['simulator', 'subckt', 'ends', 'inline', 'model', 'include', 'ahdl_include', 'parameters', 'global', 'section', 'endsection', 'library', 'endlibrary', 'statistics', 'real']);
const runOf = (t, i, to, re) => { while (i < to && re.test(t[i])) i++; return i; };
/* 记录外的一行：注释、语句的第一个词（器件名或点命令）、参数名 */
function hostClasses(t, cont) {
  const cls = new Array(t.length).fill('');
  const lead = t.length - t.trimStart().length;
  if (/^\s*(\*|\/\/)/.test(t)) return { cls: cls.fill('comment'), cont: false };
  let end = t.length, q = null;
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === ';' || (c === '/' && t[k + 1] === '/')) { end = k; break; }
  }
  cls.fill('comment', end);
  let k = lead, first = !cont;
  if (cont && t[k] === '+') k++;
  while (k < end) {
    if (/[\s(),\\]/.test(t[k])) { k++; continue; }
    const s = k;
    while (k < end && !/[\s(),\\]/.test(t[k])) k++;
    const w = t.slice(s, k), eq = w.indexOf('=');
    if (first) { cls.fill(w.startsWith('.') || SPECTRE_WORDS.has(w.toLowerCase()) ? 'directive' : 'inst', s, k); first = false; }
    else if (eq > 0) cls.fill('param', s, s + eq);
  }
  return { cls, cont: t.slice(0, end).trimEnd().endsWith('\\') };
}
/* 记录里的一行（首行从 @RNL 起，后续行先跳过注释符）；st 记着跨行的块注释、括号和花括号深度 */
function recordClasses(t, first, st) {
  const cls = new Array(t.length).fill('');
  let i = 0, after = '';
  while (i < t.length && /\s/.test(t[i])) i++;
  if (t.startsWith('//', i)) i += 2; else if (t[i] === '*') i++;
  while (i < t.length) {
    if (st.comment) {
      const e = t.indexOf('*/', i), end = e < 0 ? t.length : e + 2;
      cls.fill('comment', i, end); if (e >= 0) st.comment = false; i = end; continue;
    }
    const c = t[i], prev = after;
    after = '';
    if (t.startsWith('/*', i)) { st.comment = true; cls.fill('comment', i, i + 2); i += 2; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < t.length) { if (t[j] === '"') { if (t[j + 1] === '"') { j += 2; continue; } j++; break; } j++; }
      cls.fill('string', i, j); i = j; continue;
    }
    if (c === '@') { const j = runOf(t, i + 1, t.length, KEYWORD_CHAR); cls.fill('keyword', i, j); after = 'keyword'; i = j; continue; }
    if (c in REF_CLASS) {
      let j = i + 1;
      if (t[j] === '"') { j++; while (j < t.length && t[j++] !== '"'); } else j = runOf(t, j, t.length, NAME_CHAR);
      cls.fill(REF_CLASS[c], i, j);
      if (t[j] === ':') { const s = ++j; j = runOf(t, j, t.length, NAME_CHAR); cls.fill('net', s, j); }
      after = 'object'; i = j; continue;
    }
    if (c === ':' && prev === 'object') {
      const s = i + (t[i + 1] === ':' ? 2 : 1), j = runOf(t, s, t.length, NAME_CHAR);
      if (j > s) { cls.fill('net', s, j); after = 'object'; i = j; continue; }
    }
    if (c === '(') st.stack += prev === 'object' ? 'r' : prev === 'keyword' ? 'k' : 'p';
    else if (c === '{') { st.stack += 'b'; st.depth++; }
    else if (c === '[' || c === '<') st.stack += prev === 'object' ? 's' : 'a';
    else if (')}]>'.includes(c)) {
      if (c === '}') st.depth--;
      const kind = st.stack.at(-1);
      if (kind && ((c === ')' && 'rkp'.includes(kind)) || (c === '}' && kind === 'b') || ((c === ']' || c === '>') && 'sa'.includes(kind)))) {
        st.stack = st.stack.slice(0, -1);
        if ('pbs'.includes(kind)) after = 'object';
      }
    }
    if (/[0-9]/.test(c) || ((c === '-' || c === '.') && /[0-9]/.test(t[i + 1] || ''))) { const j = runOf(t, i + 1, t.length, /[0-9.a-zA-Z]/); i = j; continue; }
    if (t.startsWith('=>', i)) { i += 2; continue; }
    const j = runOf(t, i, t.length, KEYWORD_CHAR);
    if (j > i) {
      let k = j;
      while (t[k] === ' ') k++;
      cls.fill(st.stack.endsWith('r') || (t[k] === '=' && t[k + 1] !== '>') ? 'param' : 'free', i, j);
      i = j; continue;
    }
    i++;
  }
  return cls;
}
function paint(t, cls) {
  let html = '', k = 0;
  while (k < t.length) {
    let j = k;
    while (j < t.length && cls[j] === cls[k]) j++;
    html += cls[k] ? `<span class="s-${cls[k]}">${esc(t.slice(k, j))}</span>` : esc(t.slice(k, j));
    k = j;
  }
  return html || ' ';
}
function highlight(text) {
  const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n');
  const st = { comment: false, stack: '', depth: 0, inRec: false };
  let cont = false;
  return lines.map(t => {
    const comment = /^\s*(\*|\/\/)/.test(t);
    if (comment && (st.inRec || /^\s*(\*|\/\/)\s?@RNL/.test(t))) {
      const first = !st.inRec;
      if (first) Object.assign(st, { comment: false, stack: '', depth: 0, inRec: true, opened: false });
      const cls = recordClasses(t, first, st);
      if (st.depth > 0) st.opened = true;
      if (st.depth <= 0 && (st.opened || /\}/.test(t))) st.inRec = false;
      return { rnl: true, html: paint(t, cls) };
    }
    st.inRec = false;
    const h = hostClasses(t, cont);
    cont = h.cont;
    return { rnl: false, html: paint(t, h.cls) };
  });
}
function mountNetlist(el) {
  const text = (window.RNL_SRC || {})[el.dataset.netlist];
  if (text == null) { el.textContent = `（没有 ${el.dataset.netlist}：先运行 assets/build.py）`; return; }
  const lines = highlight(text);
  const ranges = (el.dataset.lines || `1-${lines.length}`).split(',').map(r => {
    const [a, b] = r.split('-').map(x => x === '' ? lines.length : +x);
    return [a, b == null ? a : b];
  });
  const hot = el.dataset.hotLines ? JSON.parse(el.dataset.hotLines) : {};
  const out = [];
  ranges.forEach(([from, to], r) => {
    if (r) out.push(`<span class="ln fold">${esc(el.dataset.fold || '⋯')}</span>`);
    for (let n = from; n <= Math.min(to, lines.length); n++) {
      const h = Object.keys(hot).filter(s => hot[s].includes(n)).join(',');
      out.push(`<span class="ln${lines[n - 1].rnl ? ' rnl' : ''}"${h ? ` data-hot="${h}"` : ''}>${lines[n - 1].html}</span>`);
    }
  });
  el.classList.add('vw');
  el.innerHTML = out.join('');
}

/* ---------------- 今天的日期：<span data-today></span> ---------------- */
function mountToday(el) {
  const d = new Date();
  el.textContent = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/* ---------------- 章节结构 ---------------- */
const main = $('#deck') || document.body;
const sections = [];   // {no, title, scenes: []}

/* ---------------- 场景模板 ---------------- */
function template(sec, i, all) {
  if (sec.dataset.templated) return;
  sec.dataset.templated = '1';
  const notes = $(':scope > aside.notes', sec);
  const kids = Array.from(sec.childNodes).filter(k => k !== notes);
  const stage = H('div', { class: 'stage' });
  let riseIdx = 0;
  const rise = el => { if (!el || el.hasAttribute('data-step') || sec.classList.contains('norise')) return; el.classList.add('rise'); el.style.setProperty('--i', riseIdx++); };
  const riseKids = box => $$(':scope > *', box).forEach(el => {
    if (el.classList.contains('stagger')) $$(':scope > *', el).forEach(rise); else rise(el);
  });
  const s = sections.find(x => x.no === sec.dataset.sec);
  if (sec.classList.contains('raw') || sec.classList.contains('statement')) {
    kids.forEach(k => stage.appendChild(k));
    riseKids(stage);
  } else {
    const head = H('header', { class: 'scene-head' }, stage);
    const kicker = sec.dataset.kicker || (s ? `${pad2(s.no)} · ${s.title}` : '');
    if (kicker) rise(H('p', { class: 'kicker', text: kicker }, head));
    rise(H('h2', { class: 'title', html: sec.dataset.heading || sec.dataset.title || '' }, head));
    if (sec.dataset.lede) rise(H('p', { class: 'lede', html: sec.dataset.lede }, head));
    const body = H('div', { class: 'body' }, stage);
    kids.forEach(k => body.appendChild(k));
    riseKids(body);
  }
  const nv = notes ? $$('.verify', notes).length : 0;
  if (nv) H('span', { class: 'verify-badge', text: `待核实 ${nv}`, title: '这一页有待核实的事实（D 键隐藏标记）' }, sec);
  // 页码：第几页 / 共几页，后面是脚本的拍号。页码和待核实标记挂在场景上，贴屏幕上下边（4:3 屏幕上舞台上下留白时也一样）
  H('div', { class: 'pgno', 'aria-hidden': 'true', html: `<b>${i + 1}</b> / ${all.length}${sec.dataset.beat ? ` · ${sec.dataset.beat}` : ''}` }, sec);
  sec.insertBefore(stage, notes || null);
}

/* ---------------- 组件注册 ---------------- */
const widgets = {};
function widget(name, fn) { widgets[name] = fn; }

/* ---------------- 导航引擎 ---------------- */
const deck = {
  scenes: [], cur: -1, anim: 0, targetY: null, ticking: false,
  init() {
    const secs = $$(':scope > .scene', main);
    secs.forEach(el => {
      const no = el.dataset.sec;
      if (no == null) return;
      let s = sections.find(x => x.no === no);
      if (!s) { s = { no, title: el.dataset.secTitle || '', scenes: [] }; sections.push(s); }
      if (el.dataset.secTitle) s.title = el.dataset.secTitle;
    });
    secs.forEach(template);
    $$('[data-fig]', main).forEach(mountFigure);
    $$('[data-netlist]', main).forEach(mountNetlist);
    $$('[data-today]', main).forEach(mountToday);
    this.scenes = secs.map((el, i) => {
      const steps = $$('[data-step]', el), hots = $$('[data-hot]', el), offs = $$('[data-off]', el), figs = $$('[data-hl]', el);
      const maxStep = Math.max(+(el.dataset.steps || 0), ...steps.map(e => +e.dataset.step), ...hots.map(e => Math.max(...stepSet(e.dataset.hot))),
        ...offs.map(e => +e.dataset.off), ...figs.map(e => { try { return Math.max(0, ...Object.keys(JSON.parse(e.dataset.hl)).map(Number)); } catch (x) { return 0; } }), 0);
      const sc = { el, i, id: el.id, title: el.dataset.title || '', beat: el.dataset.beat || '', sec: el.dataset.sec,
        step: 0, maxStep, steps, hots, offs, figs, stage: $('.stage', el), notes: $(':scope > aside.notes', el), handlers: {} };
      const s = sections.find(x => x.no === sc.sec);
      if (s) s.scenes.push(sc);
      return sc;
    });
    collect();
    for (const s of this.scenes) {
      for (const el of [s.el, ...$$('[data-widget]', s.el)].filter(e => e.dataset.widget)) {
        for (const name of el.dataset.widget.split(/\s+/)) {
          const fn = widgets[name];
          if (!fn) { console.warn('未注册的组件：' + name); continue; }
          try { fn(el, this.ctx(s, el)); } catch (err) { console.error('组件 ' + name + ' 初始化失败', err); }
        }
      }
      this.paint(s);
    }
    if (PRESENTER) return;
    const byStage = el => this.scenes.find(x => x.stage === el);
    const ioIn = new IntersectionObserver(es => es.forEach(en => {
      const s = byStage(en.target);
      if (s && en.isIntersecting && !s.el.classList.contains('seen')) { s.el.classList.add('seen'); this.emit(s, 'enter'); }
    }), { rootMargin: '-18% 0px -18% 0px' });
    const ioOut = new IntersectionObserver(es => es.forEach(en => {
      const s = byStage(en.target);
      if (s && !en.isIntersecting && s.el.classList.contains('seen')) { s.el.classList.remove('seen'); this.emit(s, 'leave'); }
    }));
    this.scenes.forEach(s => { ioIn.observe(s.stage); ioOut.observe(s.stage); });
    addEventListener('scroll', () => this.onScroll(), { passive: true });
    addEventListener('resize', () => this.onScroll());
    const stop = () => { if (this.anim) { cancelAnimationFrame(this.anim); this.anim = 0; this.targetY = null; } };
    addEventListener('wheel', stop, { passive: true });
    addEventListener('touchstart', stop, { passive: true });
    this.applyHash();
    this.frame();
  },
  ctx(s, el) {
    const deck = this;
    return {
      scene: s, el, data: el.dataset,
      on(evt, fn) { (s.handlers[evt] = s.handlers[evt] || []).push(fn); return this; },
      get step() { return s.step; },
      reveal(n) { if (s.step < n) deck.setStep(s, n); },
      get visible() { return s.el.classList.contains('seen'); }
    };
  },
  emit(s, evt, ...args) { (s.handlers[evt] || []).forEach(fn => { try { fn(...args); } catch (err) { console.error(err); } }); },
  applyHash() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return;
    const [id, st] = h.split('@');
    const s = this.scenes.find(x => x.id === id);
    if (s) { window.scrollTo(0, this.top(s)); if (st) this.setStep(s, +st); }
  },
  top(s) { return s.el.getBoundingClientRect().top + scrollY; },
  y() { return this.targetY != null ? this.targetY : scrollY; },
  current() {
    if (PRESENTER) return this.scenes[this.cur] || this.scenes[0];
    const probe = this.y() + innerHeight * .5;
    let c = this.scenes[0];
    for (const s of this.scenes) { if (this.top(s) <= probe + 1) c = s; else break; }
    return c;
  },
  scrollTo(y) {
    y = clamp(Math.round(y), 0, Math.max(0, document.documentElement.scrollHeight - innerHeight));
    const y0 = scrollY, dy = y - y0;
    cancelAnimationFrame(this.anim); this.anim = 0;
    if (Math.abs(dy) < 2) { this.targetY = null; return; }
    if (reduced) { window.scrollTo(0, y); this.targetY = null; return; }
    this.targetY = y;
    const dur = clamp(380 + Math.abs(dy) * .3, 520, 1000), t0 = performance.now();
    const tick = now => {
      const t = clamp((now - t0) / dur, 0, 1);
      window.scrollTo(0, y0 + dy * easeIO(t));
      if (t < 1) this.anim = requestAnimationFrame(tick); else { this.anim = 0; this.targetY = null; }
    };
    this.anim = requestAnimationFrame(tick);
  },
  next() {
    const s = this.current();
    if (!s) return;
    const t = this.top(s);
    if (s.step < s.maxStep) {
      if (Math.abs(this.y() - t) > 8) this.scrollTo(t);
      return this.setStep(s, s.step + 1);
    }
    this.goScene(s.i + 1);
  },
  prev() {
    const s = this.current();
    if (!s) return;
    const t = this.top(s);
    if (this.y() > t + 8) return this.scrollTo(t);
    if (s.step > 0) return this.setStep(s, s.step - 1);
    this.goScene(s.i - 1, true);
  },
  goScene(i, toEnd) {
    if (i < 0 || i >= this.scenes.length) return;
    const s = this.scenes[i];
    this.scrollTo(this.top(s));
    if (toEnd) this.setStep(s, s.maxStep);
  },
  goId(id) { const s = this.scenes.find(x => x.id === id); if (s) this.goScene(s.i); },
  paint(s) {
    for (const e of s.steps) e.classList.toggle('shown', +e.dataset.step <= s.step);
    for (const e of s.hots) e.classList.toggle('hot', stepSet(e.dataset.hot).has(s.step));
    for (const e of s.offs) e.classList.toggle('off', s.step >= +e.dataset.off);
    for (const e of s.figs) figureStep(e, s.step);
    s.el.dataset.at = s.step;
  },
  setStep(s, n) {
    const prev = s.step;
    s.step = clamp(n, 0, s.maxStep);
    this.paint(s);
    if (prev !== s.step) this.emit(s, 'step', s.step, prev);
    chrome.update();
  },
  onScroll() {
    if (this.ticking) return;
    this.ticking = true;
    requestAnimationFrame(() => { this.ticking = false; this.frame(); });
  },
  frame() {
    const vh = innerHeight;
    for (const s of this.scenes) {
      const r = s.el.getBoundingClientRect();
      if (r.bottom < -vh * .5 || r.top > vh * 1.5) continue;
      s.el.style.setProperty('--exit', clamp(-r.top / vh, 0, 1).toFixed(3));
    }
    const c = this.current();
    if (c && c.i !== this.cur) {
      this.cur = c.i;
      try { history.replaceState(null, '', '#' + c.id); } catch (e) { /* sandboxed */ }
    }
    chrome.update();
  }
};

/* ---------------- 附录：汇总 [核实] 与待补素材 ---------------- */
function collect() {
  $$('[data-collect]', main).forEach(list => {
    list.innerHTML = '';
    const kind = list.dataset.collect;
    for (const sec of $$(':scope > .scene', main)) {
      const beat = sec.dataset.beat || '';
      const items = kind === 'verify' ? $$('aside.notes .verify', sec) : $$('.placeholder b', sec);
      items.forEach(it => {
        const li = H('li', {}, list);
        H('i', { text: beat }, li);
        H('span', { text: it.textContent.trim() }, li);
      });
    }
  });
}

/* ---------------- 导航条、控制条、备注、快捷键 ---------------- */
const ICON = {
  prev: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h9"/></svg>',
  theme: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  notes: '<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  pres: '<svg viewBox="0 0 24 24"><path d="M3 5h18v11H3z"/><path d="M12 16v4M8 20h8"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 19h14"/></svg>'
};
const chrome = {
  built: false, menuFor: null, idleT: 0, presenterWin: null,
  build() {
    H('div', { class: 'graticule', 'aria-hidden': 'true' }, document.body);
    const rail = H('nav', { class: 'rail', 'aria-label': '章节导航' }, document.body);
    sections.forEach((s, k) => {
      if (k) H('span', { class: 'link' }, rail);
      const b = H('button', { type: 'button', class: 'chip', 'data-label': `${s.no} ${s.title}`, 'aria-label': `第 ${s.no} 节 ${s.title}`, text: s.no }, rail);
      b.addEventListener('click', e => { e.stopPropagation(); this.toggleMenu(s.no); });
      s.chip = b;
    });
    this.menu = H('div', { class: 'navmenu', hidden: '', role: 'dialog', 'aria-label': '页面列表' }, document.body);
    this.menu.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => this.toggleMenu(null, false));
    const dock = H('div', { class: 'dock' }, document.body);
    const btn = (label, html, fn) => { const b = H('button', { type: 'button', 'aria-label': label, title: label, html }, dock); b.addEventListener('click', e => { e.stopPropagation(); fn(); }); return b; };
    this.bPrev = btn('上一步', ICON.prev, () => deck.prev());
    this.beats = H('span', { class: 'beats', 'aria-hidden': 'true' }, dock);
    this.bNext = btn('下一步', ICON.next, () => deck.next());
    H('span', { class: 'sep' }, dock);
    btn('页面列表（M）', ICON.menu, () => this.toggleMenu(this.curSec()));
    this.bNotes = btn('演讲备注（N）', ICON.notes, () => this.toggleNotes());
    btn('讲者视图（S）', ICON.pres, () => this.openPresenter());
    this.bDraft = btn('草稿标记（D）', '核', () => this.toggleDraft());
    btn('切换明暗（T）', ICON.theme, () => theme.toggle());
    btn('全屏（F）', ICON.full, () => this.fullscreen());
    btn('快捷键（?）', '?', () => this.toggleHelp());
    // 没有备注、没有待核实项的页面（如公开版）不显示这两个按钮
    this.hasNotes = deck.scenes.some(s => s.notes);
    this.bNotes.hidden = !this.hasNotes;
    this.bDraft.hidden = !$('.verify', document);
    // 离线包：页面的 <meta name="offline-package" content="xxx.zip"> 给出文件名，网上打开时才显示下载按钮（本地文件里不显示）
    const pkg = $('meta[name="offline-package"]', document);
    if (pkg && location.protocol !== 'file:') {
      H('span', { class: 'sep' }, dock);
      H('a', { class: 'dl', href: pkg.content, download: '', title: '下载离线版（zip，解压后用 Chrome 或 Edge 打开 index.html）', 'aria-label': '下载离线版', html: ICON.download + '<span>离线版</span>' }, dock);
    }
    this.notesPanel = H('div', { class: 'notes-panel', hidden: '' }, document.body);
    this.black = H('div', { class: 'blackout', hidden: '' }, document.body);
    this.black.addEventListener('click', () => this.toggleBlack());
    this.help = H('div', { class: 'help', hidden: '' }, document.body);
    this.help.innerHTML = `<div class="card" role="dialog" aria-label="快捷键"><h3>快捷键</h3><dl>
      <dt><kbd>→</kbd><kbd>↓</kbd><kbd>空格</kbd><kbd>PgDn</kbd></dt><dd>下一步（揭示下一项，或进入下一页）</dd>
      <dt><kbd>←</kbd><kbd>↑</kbd><kbd>PgUp</kbd></dt><dd>上一步</dd>
      <dt><kbd>Home</kbd><kbd>End</kbd></dt><dd>第一页 / 最后一页</dd>
      <dt><kbd>M</kbd></dt><dd>本节页面列表</dd>
      <dt><kbd>N</kbd></dt><dd>演讲备注（旁白、备注、待核实）</dd>
      <dt><kbd>S</kbd></dt><dd>讲者视图：另开一个窗口，跟随翻页</dd>
      <dt><kbd>D</kbd></dt><dd>草稿标记：显示 / 隐藏“待核实”标记</dd>
      <dt><kbd>F</kbd></dt><dd>全屏</dd>
      <dt><kbd>T</kbd></dt><dd>切换明暗主题</dd>
      <dt><kbd>P</kbd></dt><dd>导出本页 PDF（打印对话框中选“另存为 PDF”）</dd>
      <dt><kbd>B</kbd><kbd>.</kbd></dt><dd>黑屏 / 恢复</dd></dl>
      <p>页码是脚本的拍号（如 4.1），与 script/script.md 一一对应。翻页笔的 PgUp / PgDn 可用。</p></div>`;
    this.help.addEventListener('click', e => { if (e.target === this.help) this.toggleHelp(false); });
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const s = deck.scenes.find(x => x.id === a.getAttribute('href').slice(1));
      if (s) { e.preventDefault(); deck.goScene(s.i); }
    });
    if (store.get('draft', true)) document.body.classList.add('draft');
    if (this.hasNotes && store.get('notes', false)) this.notesPanel.hidden = false;
    this.keys();
    addEventListener('mousemove', () => this.wake(), { passive: true });
    addEventListener('message', e => {
      const m = e.data || {};
      if (m.type === 'nav') { if (m.dir > 0) deck.next(); else if (m.dir < 0) deck.prev(); else if (m.goto) deck.goId(m.goto); }
      if (m.type === 'hello') this.sync();
    });
    this.built = true;
    this.wake();
  },
  curSec() { const s = deck.scenes[deck.cur]; return s ? s.sec : (sections[0] && sections[0].no); },
  toggleMenu(no, force) {
    const open = force != null ? force : !(this.menuFor === no && !this.menu.hidden);
    sections.forEach(s => s.chip && s.chip.classList.remove('open'));
    const s = sections.find(x => x.no === no);
    if (!open || !s) { this.menu.hidden = true; this.menuFor = null; return; }
    this.menuFor = no;
    s.chip.classList.add('open');
    const curId = deck.scenes[deck.cur] ? deck.scenes[deck.cur].id : '';
    this.menu.innerHTML = '';
    const head = H('header', {}, this.menu);
    const hm = H('div', {}, head);
    H('span', { text: `第 ${s.no} 节` }, hm);
    H('b', { text: s.title }, hm);
    const x = H('button', { type: 'button', 'aria-label': '关闭', text: '✕' }, head);
    x.addEventListener('click', () => this.toggleMenu(null, false));
    const ol = H('ol', {}, this.menu);
    s.scenes.forEach(sc => {
      const a = H('a', { href: '#' + sc.id, class: sc.id === curId ? 'cur' : null }, H('li', {}, ol));
      H('i', { text: `${sc.i + 1} · ${sc.beat}` }, a);
      H('span', { text: sc.title }, a);
      a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); this.toggleMenu(null, false); deck.goId(sc.id); });
    });
    this.menu.hidden = false;
  },
  update() {
    if (!this.built) return;
    const s = deck.scenes[deck.cur];
    if (!s) return;
    const n = s.maxStep, on = s.step;
    if (this.beats.childElementCount !== n) { this.beats.innerHTML = ''; for (let k = 0; k < n; k++) H('i', {}, this.beats); }
    Array.from(this.beats.children).forEach((d, k) => { d.classList.toggle('on', k < on); d.classList.toggle('now', k === on - 1); });
    this.bPrev.disabled = s.i === 0 && s.step === 0;
    this.bNext.disabled = s.i === deck.scenes.length - 1 && s.step >= s.maxStep;
    sections.forEach(x => x.chip && x.chip.classList.toggle('cur', x.no === s.sec));
    this.bNotes.classList.toggle('on', !this.notesPanel.hidden);
    this.bDraft.classList.toggle('on', document.body.classList.contains('draft'));
    if (!this.notesPanel.hidden) this.renderNotes(this.notesPanel, s);
    this.sync();
  },
  renderNotes(box, s) {
    if (box.dataset.for === s.id) return;
    box.dataset.for = s.id;
    box.innerHTML = '';
    H('h4', { text: `${s.beat}  ${s.title}` }, box);
    const body = H('div', { class: 'notes-body', html: s.notes ? s.notes.innerHTML : '<p class="muted">（这一页没有备注）</p>' }, box);
    return body;
  },
  toggleNotes() { if (!this.hasNotes) return; this.notesPanel.hidden = !this.notesPanel.hidden; this.notesPanel.dataset.for = ''; store.set('notes', !this.notesPanel.hidden); this.update(); },
  toggleDraft() { const on = document.body.classList.toggle('draft'); store.set('draft', on); this.update(); },
  openPresenter() {
    const u = new URL(location.href); u.search = '?presenter'; u.hash = '';
    this.presenterWin = window.open(u.href, 'rnl-presenter', 'width=1100,height=720');
    setTimeout(() => this.sync(), 600);
  },
  sync() {
    const w = this.presenterWin;
    const s = deck.scenes[deck.cur];
    if (!w || w.closed || !s) return;
    try { w.postMessage({ type: 'state', idx: s.i, step: s.step }, '*'); } catch (e) { /* closed */ }
  },
  fullscreen() {
    try { if (document.fullscreenElement) document.exitFullscreen(); else if (root.requestFullscreen) root.requestFullscreen().catch(() => {}); } catch (e) { /* not allowed */ }
  },
  toggleHelp(force) { this.help.hidden = force != null ? !force : !this.help.hidden; },
  toggleBlack() { this.black.hidden = !this.black.hidden; },
  wake(ms = 2600) {
    document.body.classList.remove('idle');
    clearTimeout(this.idleT);
    this.idleT = setTimeout(() => { if (this.help.hidden && this.menu.hidden) document.body.classList.add('idle'); }, ms);
  },
  keys() {
    addEventListener('keydown', e => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target, tag = t.tagName;
      if (tag === 'TEXTAREA' || t.isContentEditable || tag === 'INPUT') return;
      const k = e.key;
      if (!this.black.hidden && k !== 'b' && k !== 'B' && k !== '.') { this.toggleBlack(); e.preventDefault(); return; }
      let handled = true;
      if (k === 'PageDown' || k === 'ArrowRight' || k === 'ArrowDown') deck.next();
      else if (k === 'PageUp' || k === 'ArrowLeft' || k === 'ArrowUp') deck.prev();
      else if (k === ' ') e.shiftKey ? deck.prev() : deck.next();
      else if (k === 'Home') deck.goScene(0);
      else if (k === 'End') deck.goScene(deck.scenes.length - 1);
      else if (k === 'f' || k === 'F' || k === 'F5') this.fullscreen();
      else if (k === 't' || k === 'T') theme.toggle();
      else if (k === 'p' || k === 'P') printPage();
      else if (k === 'b' || k === 'B' || k === '.') this.toggleBlack();
      else if (k === 'm' || k === 'M') this.toggleMenu(this.curSec());
      else if (k === 'n' || k === 'N') this.toggleNotes();
      else if (k === 's' || k === 'S') this.openPresenter();
      else if (k === 'd' || k === 'D') this.toggleDraft();
      else if (k === '?' || k === '/') this.toggleHelp();
      else if (k === 'Escape') { this.toggleHelp(false); this.toggleMenu(null, false); }
      else handled = false;
      if (handled) { e.preventDefault(); this.wake(1500); }
    });
  }
};

/* ---------------- 讲者视图（?presenter）：读同一份页面的备注，翻页发回主窗口 ---------------- */
const presenter = {
  t0: 0,
  build() {
    document.body.classList.add('presenter-mode');
    const p = H('div', { class: 'presenter' }, document.body);
    const head = H('div', { class: 'p-head' }, p);
    this.beat = H('span', { class: 'p-beat' }, head);
    this.title = H('span', { class: 'p-title' }, head);
    this.timer = H('span', { class: 'p-timer', title: '点击归零', text: '00:00' }, head);
    this.timer.addEventListener('click', () => { this.t0 = Date.now(); });
    this.notes = H('div', { class: 'p-notes notes-body' }, p);
    const side = H('div', { class: 'p-side' }, p);
    H('h4', { text: '本页步骤' }, side);
    this.steps = H('div', { class: 'p-steps' }, side);
    H('h4', { text: '下一页' }, side);
    this.next = H('div', { class: 'card' }, side);
    H('p', { class: 'p-foot', text: '翻页键在这个窗口里同样有效，会控制主窗口。主窗口关闭后这里不再更新。' }, p);
    this.t0 = Date.now();
    setInterval(() => { const s = Math.floor((Date.now() - this.t0) / 1000); this.timer.textContent = `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`; }, 1000);
    addEventListener('message', e => { const m = e.data || {}; if (m.type === 'state') this.show(m.idx, m.step); });
    addEventListener('keydown', e => {
      const k = e.key, send = dir => { if (window.opener) window.opener.postMessage({ type: 'nav', dir }, '*'); };
      if (['PageDown', 'ArrowRight', 'ArrowDown', ' '].includes(k)) { send(1); e.preventDefault(); }
      else if (['PageUp', 'ArrowLeft', 'ArrowUp'].includes(k)) { send(-1); e.preventDefault(); }
    });
    if (window.opener) window.opener.postMessage({ type: 'hello' }, '*');
    this.show(0, 0);
  },
  show(idx, step) {
    const s = deck.scenes[idx];
    if (!s) return;
    deck.cur = idx;
    this.beat.textContent = `${idx + 1} · ${s.beat}`; this.title.textContent = s.title;
    this.notes.innerHTML = s.notes ? s.notes.innerHTML : '<p class="muted">（这一页没有备注）</p>';
    this.steps.innerHTML = '';
    for (let k = 0; k < s.maxStep; k++) H('i', { class: k < step ? 'on' : null }, this.steps);
    const n = deck.scenes[idx + 1];
    this.next.innerHTML = n ? `<b class="mono">${idx + 2} · ${n.beat}</b> ${n.title}` : '（最后一页）';
  }
};

/* ---------------- 导出本页 PDF ---------------- */
const printing = { auto: null, theme: null };
addEventListener('beforeprint', () => {
  if (!$('.print-cur')) { const s = deck.current(); if (s) { s.el.classList.add('print-cur'); printing.auto = s.el; } }
  if (theme.current() === 'dark') { printing.theme = root.dataset.theme || ''; root.dataset.theme = 'light'; }
});
addEventListener('afterprint', () => {
  if (printing.auto) { printing.auto.classList.remove('print-cur'); printing.auto = null; }
  if (printing.theme != null) { if (printing.theme) root.dataset.theme = printing.theme; else delete root.dataset.theme; printing.theme = null; }
});
function printPage() { chrome.toggleMenu(null, false); chrome.toggleHelp(false); window.print(); }

/* ---------------- 启动 ---------------- */
/* ---------------- 点开放大：[data-zoom] 的图（img，或里面的 img / svg），点一下铺满屏幕；再点一下或按任意键关掉，不翻页 ----------------
   data-zoom 的值是放大时的说明；不写就用所在 figure 的 figcaption 或图的 alt */
const zoom = {
  build() {
    this.box = H('div', { class: 'zoom', role: 'dialog', 'aria-label': '放大的图：点击或按任意键关闭' }, document.body);
    this.box.hidden = true;
    this.box.addEventListener('click', () => this.close());
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-zoom]');
      if (!el || this.box.contains(el)) return;
      e.preventDefault();
      this.open(el);
    });
    addEventListener('keydown', e => {
      if (this.box.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();   // 翻页键这时只关图（chrome.keys 见到 defaultPrevented 就不处理）
      this.close();
    }, true);
  },
  open(el) {
    const src = el.matches('img, svg') ? el : $('img, svg', el);
    if (!src) return;
    const fig = H('figure', {}, this.box), pic = src.cloneNode(true);
    pic.removeAttribute('data-zoom');
    fig.appendChild(pic);
    const cap = el.closest('figure') && $('figcaption', el.closest('figure'));
    const text = el.dataset.zoom || (cap && cap.textContent) || src.getAttribute('alt') || '';
    if (text) H('figcaption', { text }, fig);
    this.box.hidden = false;
  },
  close() { this.box.hidden = true; this.box.replaceChildren(); }
};

function boot() {
  if (PRESENTER) { deck.init(); presenter.build(); return; }
  deck.init();
  chrome.build();
  chrome.update();
  zoom.build();
}

window.DECK = { util: { $, $$, clamp, H, store, stepSet, get reduced() { return reduced; } }, widget, deck, theme, sections };
document.addEventListener('DOMContentLoaded', boot);
})();
