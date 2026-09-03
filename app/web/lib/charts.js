// Tiny SVG chart primitives — line, bar, donut, sparkline. No deps.
import { el } from './dom.js';

const PALETTE = ['#1f6feb', '#17864a', '#a86200', '#6b45c9', '#c9333f', '#1d8fa6', '#5b6270'];

function svg(w, h) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  n.setAttribute('viewBox', `0 0 ${w} ${h}`);
  n.setAttribute('width', w);
  n.setAttribute('height', h);
  n.classList.add('chart');
  return n;
}

export function barChart(data, { w = 480, h = 180, color = '#1f6feb' } = {}) {
  const max = Math.max(1, ...data.map((d) => d.v));
  const bw = w / data.length;
  const s = svg(w, h);
  data.forEach((d, i) => {
    const bh = (d.v / max) * (h - 24);
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', i * bw + 3);
    r.setAttribute('y', h - 18 - bh);
    r.setAttribute('width', bw - 6);
    r.setAttribute('height', bh);
    r.setAttribute('class', 'bar');
    r.setAttribute('fill', d.color || color);
    s.appendChild(r);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', i * bw + bw / 2);
    t.setAttribute('y', h - 4);
    t.setAttribute('text-anchor', 'middle');
    t.textContent = d.label;
    s.appendChild(t);
    const v = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    v.setAttribute('x', i * bw + bw / 2);
    v.setAttribute('y', h - 22 - bh);
    v.setAttribute('text-anchor', 'middle');
    v.setAttribute('fill', '#5b6270');
    v.setAttribute('font-size', '10');
    v.textContent = d.v;
    s.appendChild(v);
  });
  return s;
}

export function lineChart(points, { w = 480, h = 180, labels = [] } = {}) {
  const max = Math.max(1, ...points.map((p) => p));
  const step = w / Math.max(1, points.length - 1);
  const s = svg(w, h);
  // area
  let path = `M 0 ${h - 18 - (points[0] / max) * (h - 24)}`;
  points.forEach((p, i) => { path += ` L ${i * step} ${h - 18 - (p / max) * (h - 24)}`; });
  const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  area.setAttribute('d', `${path} L ${(points.length - 1) * step} ${h - 18} L 0 ${h - 18} Z`);
  area.setAttribute('class', 'area');
  s.appendChild(area);
  // line
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', path);
  line.setAttribute('class', 'line');
  s.appendChild(line);
  // labels
  if (labels.length) {
    labels.forEach((l, i) => {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', i * step);
      t.setAttribute('y', h - 4);
      t.setAttribute('text-anchor', 'middle');
      t.textContent = l;
      s.appendChild(t);
    });
  }
  return s;
}

export function donutChart(data, { size = 140 } = {}) {
  const total = data.reduce((s, d) => s + d.v, 0) || 1;
  const r = size / 2 - 14;
  const cx = size / 2, cy = size / 2;
  const s = svg(size, size);
  let acc = 0;
  data.forEach((d, i) => {
    const start = (acc / total) * Math.PI * 2;
    acc += d.v;
    const end = (acc / total) * Math.PI * 2;
    const x1 = cx + r * Math.sin(start), y1 = cy - r * Math.cos(start);
    const x2 = cx + r * Math.sin(end), y2 = cy - r * Math.cos(end);
    const large = end - start > Math.PI ? 1 : 0;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`);
    path.setAttribute('fill', d.color || PALETTE[i % PALETTE.length]);
    s.appendChild(path);
  });
  const hole = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  hole.setAttribute('cx', cx); hole.setAttribute('cy', cy); hole.setAttribute('r', r * 0.6);
  hole.setAttribute('fill', 'var(--surface)');
  s.appendChild(hole);
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('x', cx); t.setAttribute('y', cy + 4);
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('font-weight', '600');
  t.setAttribute('fill', 'var(--text)');
  t.textContent = total;
  s.appendChild(t);
  return s;
}

export function sparkline(points, { w = 80, h = 24, color = '#1f6feb' } = {}) {
  const max = Math.max(1, ...points);
  const min = Math.min(0, ...points);
  const span = (max - min) || 1;
  const step = w / Math.max(1, points.length - 1);
  let d = '';
  points.forEach((p, i) => {
    const y = h - 2 - ((p - min) / span) * (h - 4);
    d += (i === 0 ? 'M' : 'L') + ` ${i * step} ${y} `;
  });
  const s = svg(w, h);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', color);
  p.setAttribute('stroke-width', '1.6');
  s.appendChild(p);
  return s;
}

export function legend(items) {
  return el('div', { class: 'legend' },
    items.map((it) => el('label', {}, [el('i', { style: { background: it.color } }), `${it.label} (${it.v})`]))
  );
}
