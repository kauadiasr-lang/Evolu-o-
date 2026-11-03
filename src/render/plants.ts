import { PVIS } from '../core/flora';

/**
 * Desenho procedural de plantas a partir dos genes (bytes): altura, largura da folha, densidade,
 * raízes, pigmentação, tolerância à sombra e à seca. v[o..o+8] = [altura, folha, densidade, raiz,
 * pigmento, sombra, seca, maturidade, forma].
 */
export const PV = { HEIGHT: 0, LEAF: 1, DENSITY: 2, ROOT: 3, PIGMENT: 4, SHADE: 5, DROUGHT: 6, MATURE: 7, FORM: 8 } as const;
const TAU = Math.PI * 2;

function rnd(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Cor da folhagem: matiz do pigmento; sombra-tolerantes mais escuras; resistentes à seca mais acinzentadas. */
export function leafColor(v: ArrayLike<number>, o: number, dl = 0, a = 1): string {
  const pig = v[o + PV.PIGMENT] / 255, shade = v[o + PV.SHADE] / 255, dry = v[o + PV.DROUGHT] / 255;
  const hue = 24 + 112 * pig;
  const sat = 62 - 30 * dry;
  const l = 40 - 10 * shade + 6 * dry + dl;
  return `hsla(${hue.toFixed(0)},${sat.toFixed(0)}%,${Math.max(8, Math.min(90, l)).toFixed(0)}%,${a})`;
}

/**
 * Desenha uma planta com a base em (x,y). S = tamanho de referência em pixels (≈ 1 célula).
 * showRoots desenha o perfil do solo e as raízes (retrato de inspeção).
 */
export function drawPlant(ctx: CanvasRenderingContext2D, v: ArrayLike<number>, o: number, x: number, y: number, S: number, t: number, showRoots = false): void {
  const hG = v[o + PV.HEIGHT] / 255, leaf = v[o + PV.LEAF] / 255, dens = v[o + PV.DENSITY] / 255, root = v[o + PV.ROOT] / 255;
  const dry = v[o + PV.DROUGHT] / 255, mature = Math.max(0.25, v[o + PV.MATURE] / 255), form = v[o + PV.FORM];
  const seed = (v[o] * 31 + v[o + 1] * 17 + v[o + 4] * 7 + v[o + 3] * 13) | 0;
  const r = rnd(seed);
  const H = S * (0.3 + 1.7 * hG) * (0.45 + 0.55 * mature);
  const sway = Math.sin(t * 1.3 + seed) * 0.05;
  ctx.save();
  ctx.translate(x, y);
  if (showRoots) {
    // perfil do solo e raízes: profundidade do gene
    ctx.fillStyle = 'rgba(86,62,44,0.55)';
    ctx.fillRect(-S * 1.6, 0, S * 3.2, S * 1.6);
    ctx.strokeStyle = 'rgba(214,190,150,0.85)';
    ctx.lineWidth = Math.max(1, S * 0.05);
    const depth = S * (0.25 + 1.25 * root);
    for (let k = 0; k < 5; k++) {
      const sx = (k - 2) * S * 0.18 * (1 + root);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(sx * 0.5, depth * 0.5, sx + (r() - 0.5) * S * 0.2, depth * (0.6 + 0.4 * r()));
      ctx.stroke();
    }
  }
  const stem = (w: number, h: number) => {
    ctx.strokeStyle = 'hsla(28,35%,28%,0.95)';
    ctx.lineWidth = Math.max(1, w);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(h * sway * 2, -h * 0.5, h * sway * 3, -h);
    ctx.stroke();
  };
  switch (form) {
    case 0: {
      // musgo: almofada de pequenas cúpulas
      const n = 5 + Math.floor(dens * 5);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = leafColor(v, o, (r() - 0.5) * 10);
        ctx.beginPath();
        ctx.arc((r() - 0.5) * S * 0.7, -S * 0.04, S * (0.07 + 0.1 * r()) * (0.5 + 0.5 * mature), Math.PI, TAU);
        ctx.fill();
      }
      break;
    }
    case 2: {
      // gramínea: tufo de lâminas finas
      const n = 5 + Math.floor(dens * 7);
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const bx = (i / n - 0.5) * S * 0.5, h = H * (0.6 + 0.5 * r()), bend = (r() - 0.5) * H * 0.7 + sway * H * 2;
        ctx.strokeStyle = leafColor(v, o, (r() - 0.5) * 12);
        ctx.lineWidth = Math.max(1, S * (0.02 + 0.05 * leaf));
        ctx.beginPath();
        ctx.moveTo(bx, 0);
        ctx.quadraticCurveTo(bx + bend * 0.3, -h * 0.6, bx + bend, -h);
        ctx.stroke();
      }
      break;
    }
    case 1: {
      // erva: haste fina com folhas largas alternadas
      stem(S * 0.04, H);
      const n = 3 + Math.floor(dens * 4);
      for (let i = 0; i < n; i++) {
        const yy = -H * ((i + 1) / (n + 0.5)), sd = i % 2 ? 1 : -1;
        ctx.fillStyle = leafColor(v, o, (r() - 0.5) * 10);
        ctx.beginPath();
        ctx.ellipse(sd * S * (0.1 + 0.12 * leaf), yy, S * (0.1 + 0.2 * leaf), S * (0.05 + 0.07 * leaf), sd * -0.5 + sway, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 3: {
      // arbusto: vários caules curtos sob massa de folhas densa
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.rotate((i - 1) * 0.35 + sway);
        stem(S * 0.05, H * 0.6);
        ctx.restore();
      }
      const n = 4 + Math.floor(dens * 6);
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = leafColor(v, o, (r() - 0.5) * 14 - 4);
        ctx.beginPath();
        ctx.ellipse((r() - 0.5) * S * 0.8, -H * (0.45 + 0.5 * r()), S * (0.16 + 0.16 * leaf), S * (0.12 + 0.12 * leaf), 0, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 4: {
      // árvore: tronco proporcional à altura; copa larga (folhas largas) ou em camadas cônicas (folhas finas)
      stem(S * (0.05 + 0.1 * hG), H * 0.62);
      ctx.save();
      ctx.translate(H * sway * 2, -H * 0.55);
      if (leaf < 0.35) {
        const layers = 3 + Math.floor(dens * 3);
        for (let i = 0; i < layers; i++) {
          ctx.fillStyle = leafColor(v, o, -3 + i * 2);
          const w = S * (0.55 - 0.08 * i) * (0.7 + 0.5 * dens), yy = -H * 0.42 * (i / layers);
          ctx.beginPath();
          ctx.moveTo(-w, yy);
          ctx.lineTo(0, yy - H * 0.38);
          ctx.lineTo(w, yy);
          ctx.fill();
        }
      } else {
        const n = 5 + Math.floor(dens * 7);
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = leafColor(v, o, (r() - 0.5) * 16 - 3 + (i < 2 ? -5 : 0));
          ctx.beginPath();
          ctx.arc((r() - 0.5) * S * (0.6 + 0.5 * leaf), -H * 0.3 * r(), S * (0.2 + 0.2 * leaf) * (0.5 + 0.7 * mature), 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
      break;
    }
    default: {
      // suculenta: pás carnudas e braços (cacto), tons acinzentados
      const pads = 1 + Math.floor(dens * 2.5);
      for (let i = 0; i < pads; i++) {
        const ox = (i - (pads - 1) / 2) * S * 0.22, h = H * (0.7 + 0.5 * r());
        ctx.fillStyle = leafColor(v, o, -2 + i);
        ctx.beginPath();
        ctx.ellipse(ox, -h * 0.5, S * (0.09 + 0.07 * leaf), h * 0.5, 0, 0, TAU);
        ctx.fill();
        if (dry > 0.7 && h > S * 0.3) {
          ctx.beginPath();
          ctx.ellipse(ox + S * 0.14, -h * 0.55, S * 0.06, h * 0.22, 0.3, 0, TAU);
          ctx.fill();
        }
      }
    }
  }
  ctx.restore();
}

/** Retrato de linhagem: planta grande centralizada, com perfil de raízes. */
export function drawPlantPortrait(canvas: HTMLCanvasElement, v: ArrayLike<number>, t: number): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h * 0.7);
  grad.addColorStop(0, '#0a1626');
  grad.addColorStop(1, '#14304a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h * 0.7);
  const full = Array.from(v);
  full[PV.MATURE] = 255;
  drawPlant(ctx, full, 0, w / 2, h * 0.7, h * 0.34, t, true);
}

export { PVIS };
