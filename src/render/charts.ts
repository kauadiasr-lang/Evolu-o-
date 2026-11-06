import type { SpeciesInfo, StatsPayload } from '../worker/protocol';
import { speciesCss } from './palette';

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  scale?: number;
}

const GRID = 'rgba(140,170,200,0.12)';
const TEXT = 'rgba(170,190,215,0.8)';

function setup(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(10, Math.floor(r.width * dpr)), H = Math.max(10, Math.floor(r.height * dpr));
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  return { ctx, w: r.width, h: r.height };
}

export function fmt(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(0) + 'k';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  if (a >= 100) return n.toFixed(0);
  if (a >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

export function drawLines(canvas: HTMLCanvasElement, ticks: number[], series: Record<string, number[]>, defs: SeriesDef[], opts: { normalize?: boolean; stacked?: boolean; log?: boolean; events?: { tick: number; color: string }[] } = {}): void {
  const { ctx, w, h } = setup(canvas);
  const L = 38, B = 16, Tp = 6, Rr = 8;
  const pw = w - L - Rr, ph = h - B - Tp;
  if (ticks.length < 2) {
    ctx.fillStyle = TEXT;
    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.fillText('Aguardando dados…', L + 10, h / 2);
    return;
  }
  const t0 = ticks[0], t1 = ticks[ticks.length - 1];
  const X = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * pw;
  // escala logarítmica (log10(1+v)): permite ver espécies raras ao lado das dominantes; só muda o desenho
  const tf = opts.log ? (v: number) => Math.log10(1 + Math.max(0, v)) : (v: number) => v;
  const vals = defs.map((d) => series[d.key].map((v) => tf(v * (d.scale ?? 1))));
  let stackTop: number[][] = [];
  let max = 0;
  if (opts.stacked) {
    const acc = new Array(ticks.length).fill(0);
    stackTop = vals.map((s) => s.map((v, i) => (acc[i] += v)));
    max = Math.max(1e-9, ...acc);
  } else if (opts.normalize) max = 1;
  else for (const s of vals) for (const v of s) if (v > max) max = v;
  max = Math.max(max * 1.08, 1e-9);
  const Y = (v: number) => Tp + ph - (v / max) * ph;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = TEXT;
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = Tp + (ph * i) / 4;
    ctx.beginPath();
    ctx.moveTo(L, y);
    ctx.lineTo(L + pw, y);
    ctx.stroke();
    ctx.fillText(fmt(opts.log ? Math.pow(10, max * (1 - i / 4)) - 1 : max * (1 - i / 4)), 2, y + 3);
  }
  for (const e of opts.events ?? []) {
    if (e.tick < t0) continue;
    ctx.strokeStyle = e.color;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(X(e.tick), Tp);
    ctx.lineTo(X(e.tick), Tp + ph);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (opts.stacked) {
    for (let k = defs.length - 1; k >= 0; k--) {
      ctx.fillStyle = defs[k].color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(X(ticks[0]), Y(0));
      stackTop[k].forEach((v, i) => ctx.lineTo(X(ticks[i]), Y(v)));
      ctx.lineTo(X(ticks[ticks.length - 1]), Y(0));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  } else {
    defs.forEach((d, k) => {
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      vals[k].forEach((v, i) => (i ? ctx.lineTo(X(ticks[i]), Y(v)) : ctx.moveTo(X(ticks[i]), Y(v))));
      ctx.stroke();
    });
  }
  // legenda
  let lx = L + 6;
  ctx.font = '10px ui-sans-serif, system-ui';
  for (const d of defs) {
    ctx.fillStyle = d.color;
    ctx.fillRect(lx, Tp + 3, 8, 8);
    ctx.fillStyle = TEXT;
    ctx.fillText(d.label, lx + 11, Tp + 11);
    lx += 18 + ctx.measureText(d.label).width;
  }
}

/** cor da espécie = a mesma usada no mapa (palette.ts, só depende do id vindo do motor) */
export function speciesColor(sp: SpeciesInfo, _dl = 0): string {
  return speciesCss(sp.id);
}

export interface Hit {
  id: number;
  x: number;
  y: number;
  r: number;
}

/** Árvore da vida: linhagens no tempo (eixo x) com ramos nascendo no momento da especiação. */
export function drawTree(canvas: HTMLCanvasElement, st: StatsPayload, selected: number): Hit[] {
  const { ctx, w, h } = setup(canvas);
  const sp = st.species;
  const hits: Hit[] = [];
  if (sp.length === 0) return hits;
  const children = new Map<number, SpeciesInfo[]>();
  for (const s of sp) {
    if (!children.has(s.parentId)) children.set(s.parentId, []);
    children.get(s.parentId)!.push(s);
  }
  // ordem das folhas por DFS
  const row = new Map<number, number>();
  let r = 0;
  const visit = (s: SpeciesInfo) => {
    const kids = (children.get(s.id) ?? []).sort((a, b) => a.bornTick - b.bornTick);
    if (kids.length === 0) { row.set(s.id, r++); return; }
    const half = Math.ceil(kids.length / 2);
    kids.slice(0, half).forEach(visit);
    row.set(s.id, r++);
    kids.slice(half).forEach(visit);
  };
  (children.get(0) ?? []).forEach(visit);
  const rows = Math.max(1, r);
  const L = 10, Rr = 150, Tp = 14, B = 14;
  const tEnd = Math.max(1, st.tick);
  const X = (t: number) => L + (t / tEnd) * (w - L - Rr);
  const Y = (rw: number) => Tp + ((rw + 0.5) / rows) * (h - Tp - B);
  const rowH = (h - Tp - B) / rows;
  ctx.font = '10px ui-sans-serif, system-ui';
  for (const s of sp) {
    const y = Y(row.get(s.id)!);
    const x0 = X(s.bornTick);
    const x1 = X(s.extinctTick >= 0 ? s.extinctTick : tEnd);
    const alive = s.extinctTick < 0;
    const col = speciesColor(s);
    if (s.parentId) {
      const p = sp[s.parentId - 1];
      ctx.strokeStyle = 'rgba(160,190,220,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, Y(row.get(p.id)!));
      ctx.lineTo(x0, y);
      ctx.stroke();
    }
    ctx.strokeStyle = col;
    ctx.globalAlpha = alive ? 1 : 0.55;
    ctx.lineWidth = Math.max(1.5, Math.min(rowH * 0.7, 1.5 + Math.sqrt(s.peak) * 0.18));
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(Math.max(x0 + 2, x1), y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (!alive) {
      ctx.strokeStyle = 'rgba(255,90,90,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x1 - 3, y - 4); ctx.lineTo(x1 + 3, y + 4);
      ctx.moveTo(x1 + 3, y - 4); ctx.lineTo(x1 - 3, y + 4);
      ctx.stroke();
    }
    if (rowH > 9 || s.id === selected || alive) {
      ctx.fillStyle = s.id === selected ? '#fff' : alive ? 'rgba(210,225,240,0.9)' : 'rgba(150,165,185,0.6)';
      if (rowH > 8 || s.id === selected) ctx.fillText(s.name, x1 + 6, y + 3);
    }
    hits.push({ id: s.id, x: x1, y, r: 12 });
    hits.push({ id: s.id, x: (x0 + x1) / 2, y, r: 6 });
    if (s.id === selected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 - 2, y - 6, Math.max(6, x1 - x0 + 4), 12);
    }
  }
  return hits;
}

/** Teia alimentar: fontes de energia -> produtores/decompositores -> predadores. */
export function drawWeb(canvas: HTMLCanvasElement, st: StatsPayload, selected: number): Hit[] {
  const { ctx, w, h } = setup(canvas);
  const hits: Hit[] = [];
  const nodes = st.web.nodes;
  const byId = new Map(st.species.map((s) => [s.id, s]));
  if (nodes.length === 0) {
    ctx.fillStyle = TEXT;
    ctx.fillText('Sem espécies vivas.', 20, 30);
    return hits;
  }
  // nível trófico: fonte dominante e, para predadores, 1 + média dos níveis das presas
  const level = new Map<number, number>();
  for (const n of nodes) {
    const tot = n.src[0] + n.src[1] + n.src[2] + 1e-9;
    level.set(n.id, 1 + (n.src[2] / tot) * 1.0);
  }
  for (let it = 0; it < 4; it++) {
    for (const n of nodes) {
      const preys = st.web.edges.filter((e) => e[0] === n.id);
      if (!preys.length) continue;
      let ws = 0, ls = 0;
      for (const e of preys) { ws += e[2]; ls += e[2] * (level.get(e[1]) ?? 1); }
      const tot = n.src[0] + n.src[1] + n.src[2] + 1e-9;
      const f = n.src[2] / tot;
      level.set(n.id, 1 + (1 - f) * 0 + f * (ls / ws) + 0.0 * f);
    }
  }
  const maxLevel = Math.max(2, ...nodes.map((n) => level.get(n.id)!));
  const colX = (lv: number) => 90 + ((lv - 1) / (maxLevel - 0.3)) * (w - 230);
  // posições
  const pos = new Map<number, { x: number; y: number }>();
  const cols = new Map<number, typeof nodes>();
  for (const n of nodes) {
    const c = Math.round((level.get(n.id)! - 1) * 2) / 2;
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c)!.push(n);
  }
  for (const [c, list] of cols) {
    list.sort((a, b) => b.count - a.count);
    list.forEach((n, i) => pos.set(n.id, { x: colX(c + 1), y: 24 + ((i + 0.5) / list.length) * (h - 44) }));
  }
  const sunY = h * 0.3, detY = h * 0.72;
  ctx.font = '11px ui-sans-serif, system-ui';
  ctx.fillStyle = '#ffd36b';
  ctx.beginPath();
  ctx.arc(26, sunY, 9, 0, 7);
  ctx.fill();
  ctx.fillStyle = TEXT;
  ctx.fillText('Luz', 14, sunY + 24);
  ctx.fillStyle = '#b08a5a';
  ctx.beginPath();
  ctx.arc(26, detY, 9, 0, 7);
  ctx.fill();
  ctx.fillStyle = TEXT;
  ctx.fillText('Detritos', 4, detY + 24);

  const arrow = (x0: number, y0: number, x1: number, y1: number, wd: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = wd;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    const mx = (x0 + x1) / 2;
    ctx.bezierCurveTo(mx, y0, mx, y1, x1, y1);
    ctx.stroke();
    const a = Math.atan2(y1 - (y0 + y1) / 2 * 0 - y0 * 0, x1 - mx);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - 7 * Math.cos(a) - 3 * Math.sin(a), y1 - 7 * Math.sin(a) + 3 * Math.cos(a));
    ctx.lineTo(x1 - 7 * Math.cos(a) + 3 * Math.sin(a), y1 - 7 * Math.sin(a) - 3 * Math.cos(a));
    ctx.fill();
  };
  const maxSrc = Math.max(1e-9, ...nodes.map((n) => Math.max(n.src[0], n.src[1])));
  const maxFlow = Math.max(1e-9, ...st.web.edges.map((e) => e[2]));
  ctx.globalAlpha = 0.75;
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    if (n.src[0] > maxSrc * 0.03) arrow(36, sunY, p.x - 14, p.y, 0.6 + 4 * (n.src[0] / maxSrc), 'rgba(255,211,107,0.55)');
    if (n.src[1] > maxSrc * 0.03) arrow(36, detY, p.x - 14, p.y, 0.6 + 4 * (n.src[1] / maxSrc), 'rgba(176,138,90,0.6)');
  }
  for (const [pred, prey, f] of st.web.edges) {
    const a = pos.get(prey), b = pos.get(pred);
    if (!a || !b) continue;
    arrow(a.x + 14, a.y, b.x - 14, b.y, 0.6 + 5 * (f / maxFlow), 'rgba(240,100,100,0.65)');
  }
  ctx.globalAlpha = 1;
  const maxCount = Math.max(...nodes.map((n) => n.count));
  for (const n of nodes) {
    const sp = byId.get(n.id)!;
    const p = pos.get(n.id)!;
    const r = 6 + 10 * Math.sqrt(n.count / maxCount);
    ctx.fillStyle = speciesColor(sp);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 7);
    ctx.fill();
    ctx.strokeStyle = n.id === selected ? '#fff' : 'rgba(0,0,0,0.5)';
    ctx.lineWidth = n.id === selected ? 2 : 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(220,232,245,0.92)';
    ctx.fillText(sp.name, p.x + r + 4, p.y + 4);
    hits.push({ id: n.id, x: p.x, y: p.y, r: r + 4 });
  }
  return hits;
}

export function hitTest(hits: Hit[], x: number, y: number): number {
  let best = 0, bd = Infinity;
  for (const h of hits) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d <= h.r && d < bd) { bd = d; best = h.id; }
  }
  return best;
}
