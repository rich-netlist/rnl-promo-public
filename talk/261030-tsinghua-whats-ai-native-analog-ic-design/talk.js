/* =====================================================================
   talk.js — 这场演讲专用的组件（引擎在 engine/core.js）
   scrollNet  1.2  网表自动滚动、越滚越快
   depGraph   2.2  依赖图一圈圈扩散
   countdown  3.1  2 秒倒计时细条
   overlay    3.2  在 rnl render 的图上画对称轴和箭头（坐标用 RNL 的网格单位）
   bubble     5.3  原理图上指向一个元件的气泡
   ===================================================================== */
(() => {
'use strict';
const { $, $$, clamp } = DECK.util;
const NS = 'http://www.w3.org/2000/svg';
const S = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
  if (parent) parent.appendChild(e);
  return e;
};

/* 1.2：网表向上滚动，速度越来越快；data-start 给出从第几步开始滚（默认进入页面就滚），离开或退回时复位 */
DECK.widget('scrollNet', (box, ctx) => {
  const pre = $('pre', box), start = +(box.dataset.start || 0);
  let raf = 0, running = false;
  const reset = () => { cancelAnimationFrame(raf); running = false; pre.style.transform = ''; };
  const run = () => {
    if (DECK.util.reduced || running) return;
    running = true;
    const span = Math.max(0, pre.scrollHeight - box.clientHeight), dur = 7000, t0 = performance.now();
    const tick = now => {
      const t = clamp((now - t0) / dur, 0, 1);
      pre.style.transform = `translateY(${-span * t * t * t}px)`;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  ctx.on('enter', () => { if (ctx.step >= start) run(); })
     .on('step', n => { if (n >= start) run(); else reset(); })
     .on('leave', reset);
});

/* 2.2：确定性的依赖图，第 0/1/2 步分别显示中心、第一圈、第二圈 */
DECK.widget('depGraph', (svg, ctx) => {
  const rings = [[{ x: 0, y: 0 }], [], []];
  for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2 - Math.PI / 2; rings[1].push({ x: Math.cos(a) * 110, y: Math.sin(a) * 92, p: 0 }); }
  for (let k = 0; k < 18; k++) {
    const a = k / 18 * Math.PI * 2 - Math.PI / 2 + .12, r = 205 + (k % 3) * 22;
    rings[2].push({ x: Math.cos(a) * r * 1.25, y: Math.sin(a) * r * .78, p: Math.round(k / 18 * 7) % 7 });
  }
  const gs = rings.map((_, i) => S('g', { class: 'ring', 'data-ring': i }, svg));
  rings.forEach((ring, i) => ring.forEach(n => {
    if (i) { const from = i === 1 ? rings[0][0] : rings[1][n.p]; S('path', { d: `M${from.x},${from.y} L${n.x},${n.y}`, class: 'ln' }, gs[i]); }
  }));
  rings.forEach((ring, i) => ring.forEach(n => S('circle', { cx: n.x, cy: n.y, r: i === 0 ? 26 : i === 1 ? 14 : 9, class: i === 0 ? 'fillc rnl' : i === 1 ? 'box rnl' : 'box soft' }, gs[i])));
  S('text', { x: 0, y: 50, class: 't b', 'text-anchor': 'middle', text: '一个库' }, gs[0]);
  const show = n => gs.forEach((g, i) => { g.style.transition = 'opacity .6s'; g.style.opacity = i <= n ? 1 : 0; });
  show(0);
  ctx.on('step', n => show(n));
});

/* 5.3：原理图上的气泡，放在 data-target 指的对象（如 #M1）旁边（data-side 为 left 或 right，默认 right），尖角指着它；翻步、进入和改窗口大小时重新定位 */
DECK.widget('bubble', (el, ctx) => {
  const fig = $('.fig-svg', el.parentElement);
  const place = () => {
    // the object and its texts (#M1::name, #M1::model), so that the bubble covers neither
    const id = el.dataset.target, gs = fig ? $$('g[data-id]', fig).filter(x => x.dataset.id === id || x.dataset.id.startsWith(id + '::')) : [];
    if (!gs.length) return;
    const rs = gs.map(g => g.getBoundingClientRect()).filter(r => r.width);
    const own = gs[0].dataset.id === id ? gs[0].getBoundingClientRect() : rs[0];
    const a = { left: Math.min(...rs.map(r => r.left)), right: Math.max(...rs.map(r => r.right)), top: own.top, height: own.height };
    const b = el.parentElement.getBoundingClientRect();
    if (!rs.length || !b.width) return;
    const left = el.dataset.side === 'left';
    el.classList.toggle('to-left', left);
    el.style.left = `${left ? Math.max(4, a.left - b.left - el.offsetWidth - 14) : a.right - b.left + 14}px`;
    el.style.top = `${a.top - b.top + a.height / 2 - el.offsetHeight / 2}px`;
  };
  ctx.on('enter', place).on('step', place);
  addEventListener('resize', place);
  requestAnimationFrame(place);
  if (document.fonts) document.fonts.ready.then(place);
});

/* 3.1：每次进入或翻步，2 秒细条重新走一遍 */
DECK.widget('countdown', (el, ctx) => {
  const run = () => { el.classList.remove('run'); void el.offsetWidth; el.classList.add('run'); };
  ctx.on('enter', run).on('step', run);
});

/* 3.2：在 rnl render 的 SVG 上叠加标注。RNL 的 1 个网格单位 = 14 个 SVG 单位，y 向上 */
DECK.widget('overlay', (el, ctx) => {
  const svg = $('svg', el);
  if (!svg) return;
  svg.style.overflow = 'visible';
  let items = [];
  try { items = JSON.parse(el.dataset.ov); } catch (e) { console.warn('data-ov 不是 JSON', el); return; }
  const P = ([x, y]) => [x * 14, -y * 14];
  let mid = 0;
  const defs = S('defs', {}, svg);
  const mk = S('marker', { id: 'ov-head-' + (++mid + Math.random().toString(36).slice(2, 6)), viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
  S('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--rnl)' }, mk);
  const groups = items.map(it => {
    const g = S('g', { class: 'ov', 'data-step-ov': it.step }, svg);
    if (it.axis) {
      const [x, y1, y2] = it.axis, [ax, ay1] = P([x, y1]), [, ay2] = P([x, y2]);
      S('path', { d: `M${ax},${ay1} V${ay2}`, class: 'ov-line dash' }, g);
      if (it.label) S('text', { x: ax - 10, y: ay1 + 14, class: 'ov-text', 'text-anchor': 'end', text: it.label }, g);
    }
    if (it.arrow) {
      const [a, b] = it.arrow.map(P);
      S('path', { d: `M${a[0]},${a[1]} L${b[0]},${b[1]}`, class: 'ov-line', 'marker-end': `url(#${mk.id})` }, g);
      const vertical = Math.abs(a[0] - b[0]) < 1;
      if (it.label) S('text', vertical ? { x: a[0] - 10, y: (a[1] + b[1]) / 2, class: 'ov-text', 'text-anchor': 'end', text: it.label }
                                     : { x: (a[0] + b[0]) / 2, y: a[1] - 10, class: 'ov-text', 'text-anchor': 'middle', text: it.label }, g);
    }
    return { g, step: it.step };
  });
  const last = Math.max(...groups.map(x => x.step));
  const show = n => groups.forEach(({ g, step }) => g.classList.toggle('on', step === n || n > last));   // 小结那一步全部显示
  show(0);
  ctx.on('step', n => show(n));
});
})();
