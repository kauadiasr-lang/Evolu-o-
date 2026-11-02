import type { LayerKind } from '../core/layers';
import { V, VIS } from '../core/snapshot';
import type { FrameMsg } from '../app/simClient';
import { dotColor, drawCreature } from './morphology';

type RGB = [number, number, number];
const RAMPS: Record<string, RGB[]> = {
  ocean: [[92, 196, 196], [38, 128, 168], [14, 62, 118], [6, 26, 68], [3, 10, 34]],
  temp: [[44, 60, 160], [50, 150, 200], [90, 200, 150], [240, 220, 90], [235, 120, 50], [190, 40, 40]],
  light: [[8, 10, 30], [60, 60, 110], [170, 150, 110], [255, 230, 140]],
  nutrient: [[10, 18, 34], [30, 80, 90], [70, 160, 120], [200, 230, 110]],
  detritus: [[14, 12, 20], [70, 40, 50], [160, 100, 60], [235, 190, 100]],
  biomass: [[8, 18, 30], [20, 90, 70], [70, 180, 90], [220, 245, 120]],
  biodiversity: [[10, 8, 30], [70, 30, 120], [190, 60, 140], [250, 170, 90], [255, 240, 150]],
  density: [[8, 14, 30], [30, 60, 120], [80, 130, 200], [170, 210, 255], [255, 255, 255]],
  species: [[8, 14, 30], [90, 40, 120], [230, 80, 140], [255, 200, 90], [255, 255, 200]],
};

export function rampColor(name: string, t: number): RGB {
  const stops = RAMPS[name] ?? RAMPS.density;
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function rampCss(name: string): string {
  const stops = Array.from({ length: 9 }, (_, i) => rampColor(name, i / 8)).map((c, i) => `rgb(${c.map(Math.round).join(',')}) ${(i / 8) * 100}%`);
  return `linear-gradient(90deg, ${stops.join(',')})`;
}

export class MapRenderer {
  readonly ctx: CanvasRenderingContext2D;
  private off = document.createElement('canvas');
  private offCtx = this.off.getContext('2d')!;
  private img?: ImageData;
  w = 96;
  h = 60;
  cx = 48;
  cy = 30;
  zoom = 10; // pixels por célula
  frame: FrameMsg | null = null;
  layerKind: LayerKind = 'ocean';
  species = 0;
  hoverCell: { x: number; y: number } | null = null;
  brush: { r: number; active: boolean } = { r: 3, active: false };
  pointer = { x: 0, y: 0, inside: false };
  selectedOrganism: { x: number; y: number } | null = null;
  private fitted = false;
  /** pausa a animação de flagelos/corpo quando desligado */
  animate = true;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  setWorld(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.off.width = w;
    this.off.height = h;
    this.img = this.offCtx.createImageData(w, h);
    this.fitted = false;
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(10, Math.floor(r.width * dpr));
    this.canvas.height = Math.max(10, Math.floor(r.height * dpr));
    if (!this.fitted) this.fit();
  }

  get dpr(): number {
    return this.canvas.width / Math.max(1, this.canvas.getBoundingClientRect().width);
  }

  fit(): void {
    const r = this.canvas.getBoundingClientRect();
    this.zoom = Math.min(r.width / this.w, r.height / this.h) * 0.98;
    this.cx = this.w / 2;
    this.cy = this.h / 2;
    this.fitted = true;
  }

  get minZoom(): number {
    const r = this.canvas.getBoundingClientRect();
    return Math.min(r.width / this.w, r.height / this.h) * 0.6;
  }

  // coordenadas em px CSS
  worldToScreen(x: number, y: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(x - this.cx) * this.zoom + r.width / 2, (y - this.cy) * this.zoom + r.height / 2];
  }
  screenToWorld(sx: number, sy: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(sx - r.width / 2) / this.zoom + this.cx, (sy - r.height / 2) / this.zoom + this.cy];
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(140, this.zoom * factor));
    const r = this.canvas.getBoundingClientRect();
    this.cx = wx - (sx - r.width / 2) / this.zoom;
    this.cy = wy - (sy - r.height / 2) / this.zoom;
  }

  pan(dx: number, dy: number): void {
    this.cx -= dx / this.zoom;
    this.cy -= dy / this.zoom;
    this.cy = Math.max(0, Math.min(this.h, this.cy));
    this.cx = ((this.cx % this.w) + this.w) % this.w;
  }

  setFrame(f: FrameMsg): void {
    this.frame = f;
    this.layerKind = f.layerKind;
    this.paintLayer(f);
  }

  legend(): { name: string; min: number; max: number } {
    const f = this.frame;
    return { name: this.layerKind, min: f?.lmin ?? 0, max: f?.lmax ?? 1 };
  }

  private paintLayer(f: FrameMsg): void {
    if (!this.img) return;
    const d = this.img.data;
    const n = this.w * this.h;
    const kind = f.layerKind;
    const range = Math.max(1e-9, f.lmax - f.lmin);
    for (let i = 0; i < n; i++) {
      // sempre há oceano de fundo; camadas analíticas o cobrem parcialmente
      const base = rampColor('ocean', f.depth[i] * (0.4 + 0.6 * f.depth[i]));
      let r = base[0], g = base[1], b = base[2];
      if (kind !== 'ocean') {
        let t = (f.layer[i] - f.lmin) / range;
        if (kind === 'density' || kind === 'biomass' || kind === 'species' || kind === 'biodiversity') t = Math.sqrt(Math.max(0, t));
        const c = rampColor(kind, t);
        const a = kind === 'temp' || kind === 'light' || kind === 'nutrient' || kind === 'detritus' ? 0.88 : 0.35 + 0.65 * Math.min(1, t * 1.5);
        r = r * (1 - a) + c[0] * a;
        g = g * (1 - a) + c[1] * a;
        b = b * (1 - a) + c[2] * a;
      }
      d[i * 4] = r;
      d[i * 4 + 1] = g;
      d[i * 4 + 2] = b;
      d[i * 4 + 3] = 255;
    }
    this.offCtx.putImageData(this.img, 0, 0);
  }

  draw(time: number): void {
    const { ctx, canvas } = this;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = '#04070f';
    ctx.fillRect(0, 0, rect.width, rect.height);
    if (!this.frame) return;

    const z = this.zoom;
    // cópias horizontais (mundo cilíndrico)
    const [x0] = this.worldToScreen(0, 0);
    const copies = [-1, 0, 1].filter((k) => {
      const sx = x0 + k * this.w * z;
      return sx < rect.width && sx + this.w * z > 0;
    });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const k of copies) {
      const [sx, sy] = this.worldToScreen(k * this.w, 0);
      ctx.drawImage(this.off, sx, sy, this.w * z, this.h * z);
    }
    // fontes hidrotermais
    const f = this.frame;
    for (const k of copies) {
      ctx.fillStyle = 'rgba(255,170,90,0.35)';
      for (let i = 0; i < f.vents.length; i++) {
        const vx = f.vents[i] % this.w, vy = Math.floor(f.vents[i] / this.w);
        const [sx, sy] = this.worldToScreen(vx + 0.5 + k * this.w, vy + 0.5);
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(2, z * (0.5 + 0.15 * Math.sin(time * 3 + i))), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // organismos
    const zf = Math.sqrt(Math.max(0.4, z / 8));
    const sel = this.species;
    let detailed = 0;
    const vis = f.vis;
    let lastColor = '';
    for (const k of copies) {
      for (let i = 0; i < f.n; i++) {
        const [sx, sy] = this.worldToScreen(f.x[i] + k * this.w, f.y[i]);
        if (sx < -20 || sy < -20 || sx > rect.width + 20 || sy > rect.height + 20) continue;
        const o = i * VIS;
        const R = (1.2 + 3.2 * (vis[o + V.SIZE] / 255)) * zf;
        const isSel = sel !== 0 && f.sp[i] === sel;
        const dim = sel !== 0 && !isSel;
        ctx.globalAlpha = dim ? 0.22 : 1;
        if (R >= 5.5 && detailed < 1400) {
          detailed++;
          drawCreature(ctx, vis, o, sx, sy, R, (f.ang[i] / 255 - 0.5) * Math.PI * 2, this.animate ? time : 0, isSel && z > 18);
        } else if (R >= 1.8) {
          const c = dotColor(vis, o);
          if (c !== lastColor) { ctx.fillStyle = c; lastColor = c; }
          ctx.beginPath();
          ctx.arc(sx, sy, R, 0, 6.2832);
          ctx.fill();
        } else {
          const c = dotColor(vis, o);
          if (c !== lastColor) { ctx.fillStyle = c; lastColor = c; }
          ctx.fillRect(sx - 1, sy - 1, 2, 2);
        }
      }
    }
    ctx.globalAlpha = 1;

    // limites do planeta
    ctx.strokeStyle = 'rgba(120,180,220,0.25)';
    ctx.lineWidth = 1;
    {
      const [sx, sy] = this.worldToScreen(0, 0);
      ctx.strokeRect(sx, sy, this.w * z, this.h * z);
    }
    // seleção de organismo
    if (this.selectedOrganism) {
      const [sx, sy] = this.worldToScreen(this.selectedOrganism.x, this.selectedOrganism.y);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 10 + 2 * Math.sin(time * 5), 0, Math.PI * 2);
      ctx.stroke();
    }
    // pincel / célula sob o cursor
    if (this.pointer.inside) {
      if (this.brush.active) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(this.pointer.x, this.pointer.y, this.brush.r * z, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (this.hoverCell) {
        const [sx, sy] = this.worldToScreen(this.hoverCell.x, this.hoverCell.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.strokeRect(sx, sy, z, z);
      }
    }
  }
}
