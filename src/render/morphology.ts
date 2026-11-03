import { V, VIS } from '../core/snapshot';
import { bodyHueDeg, camoMatch, mixAngle } from '../core/phenotype';

/**
 * Morfogênese procedural: a aparência é construída a partir dos genes (quantizados em bytes).
 * Forma, flagelos, espinhos, carapaça, pigmentação e padrões vêm todos do genoma.
 */

const TAU = Math.PI * 2;

export interface BodyColor {
  h: number;
  s: number;
  l: number;
}

export function bodyColor(v: ArrayLike<number>, o: number): BodyColor {
  const photo = v[o + V.PHOTO] / 255, pred = v[o + V.PRED] / 255, osmo = v[o + V.OSMO] / 255;
  const h = bodyHueDeg(v[o + V.HUE] / 255, photo, pred, osmo);
  return { h, s: 38 + 52 * (v[o + V.SAT] / 255), l: 46 + 8 * (1 - pred) };
}

export function hsl(c: BodyColor, dl = 0, a = 1): string {
  return `hsla(${c.h.toFixed(0)},${c.s.toFixed(0)}%,${Math.max(5, Math.min(95, c.l + dl)).toFixed(0)}%,${a})`;
}

/** Paleta pré-computada para pontos simples (evita criar strings por organismo). */
const DOT_PALETTE: string[] = [];
export function dotColor(v: ArrayLike<number>, o: number): string {
  const photo = v[o + V.PHOTO], pred = v[o + V.PRED], hue = v[o + V.HUE];
  const key = (hue >> 3) * 16 + (photo >> 6) * 4 + (pred >> 6);
  let c = DOT_PALETTE[key];
  if (!c) {
    const tmp = [hue & ~7, 140, 0, photo & ~63, 0, pred & ~63, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const bc = bodyColor(tmp, 0);
    c = hsl(bc, 4);
    DOT_PALETTE[key] = c;
  }
  return c;
}

function rnd(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function bodyPath(ctx: CanvasRenderingContext2D, R: number, elong: number, lobes: number, symm: number, t: number, wob: number): void {
  const N = 28;
  const rx = R * (1 + elong * 0.95), ry = R * (1 - elong * 0.28);
  const k = 2 + Math.floor(lobes * 6);
  const asym = (1 - symm) * 0.2;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * TAU;
    let m = 1 + lobes * 0.2 * Math.cos(k * a + wob) + asym * Math.cos(a - 1) + asym * 0.5 * Math.cos(2 * a + 0.5);
    m += 0.025 * Math.sin(a * 3 + t * 2.2 + wob);
    const x = Math.cos(a) * rx * m, y = Math.sin(a) * ry * m;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Desenha uma criatura. `R` é o raio em pixels, `ang` a direção do corpo (rad), `t` o tempo em s.
 */
function drawUnicell(ctx: CanvasRenderingContext2D, v: ArrayLike<number>, o: number, x: number, y: number, R: number, ang: number, t: number, outline = false, bgHue?: number): void {
  const g = (k: number) => v[o + k] / 255;
  const elong = g(V.ELONG), lobes = g(V.LOBES), symm = g(V.SYMM), photo = g(V.PHOTO), osmo = g(V.OSMO);
  const pred = g(V.PRED), motil = g(V.MOTIL), def = g(V.DEF), spike = g(V.SPIKE), flag = g(V.FLAG);
  const pattern = g(V.PATTERN), nucleus = g(V.NUCLEUS);
  const col = bodyColor(v, o);
  const camo0 = v[o + V.CAMO] / 255;
  if (camo0 > 0 && bgHue !== undefined) ctx.globalAlpha *= 1 - 0.55 * camo0 * camoMatch(col.h, bgHue);
  const seed = (v[o + V.HUE] * 31 + v[o + V.PATTERN] * 17 + v[o + V.SIZE] * 7) | 0;
  const r = rnd(seed);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  const breathe = 1 + 0.03 * Math.sin(t * 2 + seed);
  const rx = R * (1 + elong * 0.95) * breathe;

  // flagelos (atrás do corpo)
  const nFlag = motil > 0.12 || flag > 0.3 ? 1 + Math.floor(flag * 3.99) : 0;
  if (nFlag > 0) {
    ctx.lineWidth = Math.max(1, R * 0.07);
    ctx.strokeStyle = hsl(col, 12, 0.85);
    ctx.lineCap = 'round';
    const len = R * (1.4 + 2.2 * flag + 1.2 * motil);
    for (let k = 0; k < nFlag; k++) {
      const off = nFlag === 1 ? 0 : (k / (nFlag - 1) - 0.5) * R * 0.9;
      ctx.beginPath();
      ctx.moveTo(-rx * 0.92, off);
      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        ctx.lineTo(-rx * 0.92 - u * len, off + Math.sin(t * (6 + 4 * motil) - u * 5 + k) * R * 0.28 * u);
      }
      ctx.stroke();
    }
  }
  // cílios curtos (osmótrofos de superfície grande)
  if (osmo > 0.5 && R > 6) {
    ctx.strokeStyle = hsl(col, 15, 0.5);
    ctx.lineWidth = 1;
    const n = 14;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const cx = Math.cos(a) * rx, cy = Math.sin(a) * R * (1 - elong * 0.28);
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx * 1.18 + Math.sin(t * 5 + i) * 0.8, cy * 1.18 + Math.cos(t * 5 + i) * 0.8);
    }
    ctx.stroke();
  }
  // espinhos
  if (spike > 0.12) {
    const n = 5 + Math.floor(spike * 9);
    ctx.fillStyle = hsl(col, -22, 0.95);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (1 - symm) * 0.4;
      const bx = Math.cos(a) * rx, by = Math.sin(a) * R * (1 - elong * 0.28);
      const tipL = 1 + 0.32 + spike * 0.7;
      ctx.beginPath();
      ctx.moveTo(bx * 0.96 - Math.sin(a) * R * 0.1, by * 0.96 + Math.cos(a) * R * 0.1);
      ctx.lineTo(bx * tipL, by * tipL);
      ctx.lineTo(bx * 0.96 + Math.sin(a) * R * 0.1, by * 0.96 - Math.cos(a) * R * 0.1);
      ctx.fill();
    }
  }

  // corpo
  bodyPath(ctx, R * breathe, elong, lobes, symm, t, seed);
  const grad = ctx.createRadialGradient(-R * 0.25, -R * 0.25, R * 0.1, 0, 0, rx * 1.1);
  grad.addColorStop(0, hsl(col, 14, 0.95));
  grad.addColorStop(1, hsl(col, -10, 0.92));
  ctx.fillStyle = grad;
  ctx.fill();

  // padrões (recortados no corpo)
  if (pattern > 0.25) {
    ctx.save();
    bodyPath(ctx, R * breathe, elong, lobes, symm, t, seed);
    ctx.clip();
    ctx.fillStyle = hsl(col, -18, 0.55);
    ctx.strokeStyle = hsl(col, -18, 0.55);
    if (pattern < 0.5) {
      const n = 4 + Math.floor(pattern * 12);
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc((r() - 0.5) * rx * 1.6, (r() - 0.5) * R * 1.4, R * (0.08 + r() * 0.12), 0, TAU);
        ctx.fill();
      }
    } else if (pattern < 0.75) {
      ctx.lineWidth = Math.max(1, R * 0.1);
      const n = 3 + Math.floor((pattern - 0.5) * 12);
      for (let i = 0; i < n; i++) {
        const xx = (i / (n - 1) - 0.5) * rx * 1.7;
        ctx.beginPath();
        ctx.moveTo(xx, -R * 1.2);
        ctx.quadraticCurveTo(xx + R * 0.3, 0, xx, R * 1.2);
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = Math.max(1, R * 0.09);
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.ellipse(0, 0, rx * 0.28 * i, R * 0.25 * i, 0, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // cloroplastos
  if (photo > 0.25) {
    const n = 2 + Math.floor(photo * 7);
    ctx.fillStyle = `hsla(${(125 + r() * 20).toFixed(0)},70%,${(30 + 10 * photo).toFixed(0)}%,0.9)`;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * 0.7;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * rx * d, Math.sin(a) * R * d, R * 0.13, R * 0.08, a, 0, TAU);
      ctx.fill();
    }
  }
  // núcleo
  ctx.fillStyle = hsl(col, -26, 0.9);
  ctx.beginPath();
  ctx.arc((1 - symm) * R * 0.3, 0, R * (0.16 + 0.2 * nucleus), 0, TAU);
  ctx.fill();
  ctx.fillStyle = hsl(col, 20, 0.9);
  ctx.beginPath();
  ctx.arc((1 - symm) * R * 0.3 + R * 0.04, -R * 0.04, R * 0.05, 0, TAU);
  ctx.fill();

  // boca / vacúolo alimentar dos predadores
  if (pred > 0.2) {
    ctx.fillStyle = 'rgba(40,6,10,0.85)';
    ctx.beginPath();
    ctx.ellipse(rx * 0.82, 0, R * (0.1 + 0.2 * pred), R * (0.07 + 0.12 * pred), 0, 0, TAU);
    ctx.fill();
  }

  // contorno / carapaça
  bodyPath(ctx, R * breathe, elong, lobes, symm, t, seed);
  ctx.lineWidth = Math.max(1, R * (0.06 + def * 0.2));
  ctx.strokeStyle = hsl(col, -28 - def * 10, 0.95);
  ctx.stroke();
  if (def > 0.4) {
    ctx.save();
    ctx.scale(0.78, 0.78);
    bodyPath(ctx, R * breathe, elong, lobes, symm, t, seed);
    ctx.lineWidth = Math.max(1, R * 0.05);
    ctx.strokeStyle = hsl(col, 28, 0.55);
    ctx.stroke();
    ctx.restore();
  }
  if (outline) {
    bodyPath(ctx, R * breathe * 1.35, elong, lobes, symm, t, seed);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
  ctx.restore();
}

export { VIS };


// =====================================================================================
// Planos corporais complexos (Etapa 3): segmentos, membros, nadadeiras, olhos, antenas, carapaça
// =====================================================================================

function isComplex(v: ArrayLike<number>, o: number): boolean {
  return v[o + V.SEGM] > 0 || v[o + V.LIMBS] > 0 || v[o + V.FINS] > 0 || v[o + V.TAIL] > 0 || v[o + V.EYES] > 0 || v[o + V.ANT] > 0;
}

/** Desenha um organismo: unicelular simples ou corpo complexo, conforme o fenótipo expresso. */
export function drawCreature(ctx: CanvasRenderingContext2D, v: ArrayLike<number>, o: number, x: number, y: number, R: number, ang: number, t: number, outline = false, bgHue?: number): void {
  if (!isComplex(v, o)) {
    ctx.save();
    drawUnicell(ctx, v, o, x, y, R, ang, t, outline, bgHue);
    ctx.restore();
    return;
  }
  drawBody(ctx, v, o, x, y, R, ang, t, outline, bgHue);
}

function limb(ctx: CanvasRenderingContext2D, bx: number, by: number, side: number, len: number, swing: number, terr: number, climb: number, col: BodyColor, R: number): void {
  // duas articulações: terrestres se dobram para baixo (pernas), aquáticas viram remos
  const ux = bx + Math.sin(swing) * len * 0.35, uy = by + side * len * 0.55;
  const fx = ux + Math.sin(swing * 1.4 + 0.5) * len * 0.45 * (terr > 0.3 ? 0.6 : 1), fy = uy + side * len * (terr > 0.3 ? 0.35 : 0.55);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = hsl(col, -20, 0.95);
  ctx.lineWidth = Math.max(1.2, R * (terr > 0.3 ? 0.2 : 0.14));
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(ux, uy);
  ctx.lineTo(fx, fy);
  ctx.stroke();
  ctx.fillStyle = hsl(col, -8, 0.95);
  ctx.beginPath();
  ctx.arc(ux, uy, Math.max(1, R * 0.11), 0, TAU);
  ctx.fill();
  if (terr <= 0.3) {
    // remo: pá achatada na ponta
    ctx.fillStyle = hsl(col, 10, 0.75);
    ctx.beginPath();
    ctx.ellipse(fx, fy, R * 0.3, R * 0.13, side * 0.9 + swing, 0, TAU);
    ctx.fill();
  } else if (climb > 0.3) {
    // garra em gancho para escalar
    ctx.strokeStyle = hsl(col, -35, 1);
    ctx.lineWidth = Math.max(1, R * 0.09);
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo(fx + R * 0.22, fy + side * R * 0.28, fx + R * 0.02, fy + side * R * 0.42);
    ctx.stroke();
  } else {
    // pé apoiado (membro terrestre)
    ctx.fillStyle = hsl(col, -25, 0.95);
    ctx.beginPath();
    ctx.ellipse(fx + R * 0.05, fy, R * 0.16, R * 0.09, 0, 0, TAU);
    ctx.fill();
  }
}

function drawBody(ctx: CanvasRenderingContext2D, v: ArrayLike<number>, o: number, x: number, y: number, R: number, ang: number, t: number, outline: boolean, bgHue?: number): void {
  const g = (k: number) => v[o + k] / 255;
  const segN = Math.round(g(V.SEGM) * 8), limbsN = Math.round(g(V.LIMBS) * 4), limbLen = g(V.LIMBLEN);
  const fins = g(V.FINS), eyesN = Math.round(g(V.EYES) * 3), camo = g(V.CAMO), climb = g(V.CLIMB), terr = g(V.TERR);
  const ant = g(V.ANT), tail = g(V.TAIL), head = g(V.HEAD), mature = Math.max(0.4, g(V.MATURE));
  const symm = g(V.SYMM), elong = g(V.ELONG), def = g(V.DEF), spike = g(V.SPIKE), pred = g(V.PRED), pattern = g(V.PATTERN);
  const radial = symm > 0.66 && segN === 0;
  const asym = symm < 0.33;
  const col = bodyColor(v, o);
  const seed = (v[o + V.HUE] * 31 + v[o + V.PATTERN] * 17 + v[o + V.SIZE] * 7 + v[o + V.HUE2] * 13) | 0;
  const r = rnd(seed);
  const accent: BodyColor = { h: (v[o + V.HUE2] / 255) * 360, s: 55 + 25 * g(V.SAT), l: 52 };
  const match = bgHue !== undefined ? camoMatch(col.h, bgHue) : 0;
  const bg: BodyColor | null = bgHue !== undefined ? { h: bgHue, s: 35, l: 40 } : null;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  if (camo > 0) ctx.globalAlpha *= 1 - 0.55 * camo * match;

  const L = R * (1.5 + elong * 1.5 + 0.1 * segN);
  const wd = R * (0.78 - elong * 0.22) * (0.75 + 0.25 * mature);
  const n = radial ? 1 : Math.max(1, segN);
  const swimmer = fins > 0 || tail > 0;
  const undul = (swimmer || segN > 1 ? 0.1 : 0.03) * R;
  const segX = (i: number) => -L / 2 + ((i + 0.5) * L) / n;
  const segY = (i: number) => (asym ? Math.sin(i * 0.9 + seed) * R * 0.18 : 0) + Math.sin(t * 4 - i * 0.8) * undul;
  const segRY = (i: number) => (n === 1 ? wd : wd * (0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / n)));

  // ---- cauda propulsora (atrás) e nadadeiras laterais
  if (tail > 0 && !radial) {
    const tl = R * (0.7 + 1.7 * tail) * mature;
    ctx.fillStyle = hsl(col, 14, 0.7);
    ctx.strokeStyle = hsl(col, -12, 0.9);
    ctx.lineWidth = Math.max(1, R * 0.05);
    const sw = Math.sin(t * 6) * 0.35;
    ctx.beginPath();
    ctx.moveTo(-L / 2, segY(0));
    ctx.quadraticCurveTo(-L / 2 - tl * 0.7, segY(0) - tl * (0.5 + sw), -L / 2 - tl, segY(0) - tl * 0.55 * (1 + sw));
    ctx.quadraticCurveTo(-L / 2 - tl * 0.7, segY(0), -L / 2 - tl, segY(0) + tl * 0.55 * (1 - sw));
    ctx.quadraticCurveTo(-L / 2 - tl * 0.7, segY(0) + tl * (0.5 - sw), -L / 2, segY(0));
    ctx.fill();
    ctx.stroke();
  }
  if (fins > 0 && !radial) {
    const fl = R * (0.45 + 1.1 * fins) * mature;
    ctx.fillStyle = hsl(col, 12, 0.7);
    ctx.strokeStyle = hsl(col, -14, 0.9);
    ctx.lineWidth = Math.max(1, R * 0.045);
    for (const sd of [-1, 1]) {
      const fx = L * 0.12, fy = sd * segRY(Math.min(n - 1, Math.floor(n * 0.6)));
      const fw = Math.sin(t * 5 + (sd > 0 ? 0 : 1.6)) * 0.25;
      ctx.beginPath();
      ctx.moveTo(fx + fl * 0.4, fy);
      ctx.quadraticCurveTo(fx - fl * 0.2, fy + sd * fl * (0.9 + fw), fx - fl * 1.1, fy + sd * fl * (0.55 + fw));
      ctx.quadraticCurveTo(fx - fl * 0.5, fy + sd * fl * 0.1, fx - fl * 0.25, fy);
      ctx.fill();
      ctx.stroke();
    }
  }

  // ---- membros (pares ao longo do corpo, marcha alternada) ou braços radiais
  if (radial && limbsN > 0) {
    const arms = Math.max(5, limbsN * 2 + 1);
    const al = R * (0.9 + 1.4 * limbLen) * mature;
    ctx.strokeStyle = hsl(col, -6, 0.95);
    ctx.lineCap = 'round';
    for (let a = 0; a < arms; a++) {
      const th = (a / arms) * TAU + t * 0.15;
      const w2 = Math.sin(t * 2.4 + a) * 0.18;
      ctx.lineWidth = Math.max(1.5, R * 0.34);
      ctx.beginPath();
      ctx.moveTo(Math.cos(th) * R * 0.4, Math.sin(th) * R * 0.4);
      ctx.quadraticCurveTo(Math.cos(th + w2) * (R * 0.4 + al * 0.55), Math.sin(th + w2) * (R * 0.4 + al * 0.55), Math.cos(th + w2 * 1.8) * (R * 0.3 + al), Math.sin(th + w2 * 1.8) * (R * 0.3 + al));
      ctx.stroke();
      if (climb > 0.3) {
        ctx.fillStyle = hsl(col, -30, 1);
        ctx.beginPath();
        ctx.arc(Math.cos(th + w2 * 1.8) * (R * 0.3 + al), Math.sin(th + w2 * 1.8) * (R * 0.3 + al), R * 0.1, 0, TAU);
        ctx.fill();
      }
    }
  } else if (limbsN > 0) {
    const ll = R * (0.5 + 1.5 * limbLen) * mature;
    for (let p = 0; p < limbsN; p++) {
      const bx = -L / 2 + L * ((p + 0.75) / (limbsN + 0.5));
      const seg = Math.min(n - 1, Math.max(0, Math.floor(((bx + L / 2) / L) * n)));
      for (const sd of [-1, 1]) {
        const swing = Math.sin(t * (terr > 0.3 ? 3.2 : 4.5) + p * 1.6 + (sd > 0 ? 0 : Math.PI)) * 0.55;
        const lenSide = asym ? ll * (sd > 0 ? 1 : 0.62) : ll;
        limb(ctx, bx, segY(seg) + sd * segRY(seg) * 0.85, sd, lenSide, swing, terr, climb, col, R);
      }
    }
  }

  // ---- antenas (à frente)
  if (ant > 0 && !radial) {
    const al = R * (0.7 + 1.9 * ant) * mature;
    ctx.strokeStyle = hsl(col, -15, 0.95);
    ctx.lineWidth = Math.max(1, R * 0.05);
    for (const sd of [-1, 1]) {
      const sw = Math.sin(t * 3 + sd) * 0.25;
      ctx.beginPath();
      ctx.moveTo(L / 2 - R * 0.1, sd * wd * 0.28);
      ctx.quadraticCurveTo(L / 2 + al * 0.5, sd * (wd * 0.5 + al * (0.35 + sw)), L / 2 + al * 0.95, sd * (wd * 0.4 + al * (0.7 + sw)));
      ctx.stroke();
      ctx.fillStyle = hsl(accent, 0, 0.9);
      ctx.beginPath();
      ctx.arc(L / 2 + al * 0.95, sd * (wd * 0.4 + al * (0.7 + sw)), Math.max(1, R * 0.06), 0, TAU);
      ctx.fill();
    }
  }

  // ---- corpo: radial (disco) ou cadeia de segmentos
  const shade = (i: number) => (i % 2 ? -6 : 0);
  ctx.lineWidth = Math.max(1, R * (0.05 + def * 0.16));
  if (radial) {
    ctx.fillStyle = hsl(col, 6, 0.95);
    ctx.strokeStyle = hsl(col, -28, 0.95);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.55 * (0.8 + 0.2 * mature), 0, TAU);
    ctx.fill();
    ctx.stroke();
  } else {
    for (let i = 0; i < n; i++) {
      const cx = segX(i), cy = segY(i), rx = (L / n) * (n === 1 ? 0.52 : 0.64), ry = segRY(i);
      const grd = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.4, ry * 0.1, cx, cy, Math.max(rx, ry) * 1.1);
      grd.addColorStop(0, hsl(col, 14 + shade(i), 0.97));
      grd.addColorStop(1, hsl(col, -10 + shade(i), 0.95));
      ctx.fillStyle = grd;
      ctx.strokeStyle = hsl(col, -30, 0.95);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      // placas da carapaça sobre cada segmento
      if (def > 0.35) {
        ctx.strokeStyle = hsl(col, 30, 0.55);
        ctx.lineWidth = Math.max(1, R * 0.05);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * 0.72, ry * 0.7, 0, -1.2, 1.2);
        ctx.stroke();
        ctx.lineWidth = Math.max(1, R * (0.05 + def * 0.16));
      }
      // padrões de acento e mosqueado de camuflagem
      if (pattern > 0.25) {
        ctx.fillStyle = hsl(accent, 0, 0.7);
        for (let k = 0; k < 2; k++) {
          ctx.beginPath();
          ctx.arc(cx + (r() - 0.5) * rx, cy + (r() - 0.5) * ry * 1.2, Math.max(1, R * (0.07 + 0.07 * r())), 0, TAU);
          ctx.fill();
        }
      }
      if (camo > 0.2 && bg) {
        ctx.fillStyle = hsl(bg, 0, 0.55 * camo * (0.4 + 0.6 * match));
        ctx.beginPath();
        ctx.ellipse(cx + (r() - 0.5) * rx * 0.6, cy, rx * 0.5, ry * 0.55, 0, 0, TAU);
        ctx.fill();
      }
    }
  }
  // espinhos ao longo do dorso
  if (spike > 0.15 && !radial) {
    ctx.fillStyle = hsl(col, -26, 0.95);
    for (let i = 0; i < n; i++) {
      for (const sd of [-1, 1]) {
        const cx = segX(i), cy = segY(i) + sd * segRY(i);
        ctx.beginPath();
        ctx.moveTo(cx - R * 0.1, cy);
        ctx.lineTo(cx, cy + sd * R * (0.25 + 0.55 * spike));
        ctx.lineTo(cx + R * 0.1, cy);
        ctx.fill();
      }
    }
  }
  // fotossíntese: cloroplastos visíveis
  if (g(V.PHOTO) > 0.3) {
    ctx.fillStyle = 'hsla(130,70%,32%,0.85)';
    for (let k = 0; k < 3 + Math.floor(g(V.PHOTO) * 4); k++) {
      const i = Math.floor(r() * n);
      ctx.beginPath();
      ctx.ellipse(segX(i) + (r() - 0.5) * (L / n) * 0.4, segY(i) + (r() - 0.5) * segRY(i), R * 0.1, R * 0.06, 0, 0, TAU);
      ctx.fill();
    }
  }

  // ---- cabeça: olhos e boca
  if (!radial) {
    const hx = L / 2 - (L / n) * 0.3, hy = segY(n - 1);
    if (pred > 0.2) {
      ctx.fillStyle = 'rgba(40,6,10,0.85)';
      ctx.beginPath();
      ctx.ellipse(L / 2 + R * 0.04, hy, R * (0.08 + 0.18 * pred), R * (0.06 + 0.1 * pred), 0, 0, TAU);
      ctx.fill();
    }
    if (eyesN > 0) {
      const er = R * (0.13 + 0.08 * head) * (0.7 + 0.3 * mature);
      const spots = eyesN === 1 ? [[0, 0]] : eyesN === 2 ? [[0, -1], [0, 1]] : [[0, -1], [0, 1], [-0.5, 0]];
      for (const [ex, ey] of spots) {
        const px = hx + ex * er * 1.4, py = hy + ey * wd * 0.42;
        ctx.fillStyle = '#f2f6fb';
        ctx.beginPath();
        ctx.arc(px, py, er, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#0a1018';
        ctx.beginPath();
        ctx.arc(px + er * 0.3, py, er * 0.55, 0, TAU);
        ctx.fill();
      }
    }
  }
  if (outline) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.75 + R * 0.5, Math.max(wd, R) * 1.5, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** Raio de desenho recomendado para o retrato de uma criatura de bytes `v` (cabe no canvas). */
export function portraitScale(v: ArrayLike<number>, o: number, box: number): number {
  const elong = v[o + V.ELONG] / 255, segN = Math.round((v[o + V.SEGM] / 255) * 8);
  const limbs = (v[o + V.LIMBS] / 255) * 4, limbLen = v[o + V.LIMBLEN] / 255;
  const tail = v[o + V.TAIL] / 255 > 0 ? 1.2 : 0, ant = v[o + V.ANT] / 255;
  const extent = (1.5 + elong * 1.5 + 0.1 * segN) / 2 + tail + ant * 1.2 + (limbs > 0 ? 0.5 + 1.5 * limbLen : 0) * 0.6 + 0.5;
  return Math.min(box * 0.22, (box * 0.46) / Math.max(1.3, extent));
}
