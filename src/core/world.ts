import { Rng, makeNoise2D } from './rng';
import { P } from './params';

/**
 * Planeta: grade de células ambientais.
 * Massa conservada: nutrient + detritus (+ biomassa dos organismos) + reservoir (sedimento/manto).
 */
export class Planet {
  readonly w: number;
  readonly h: number;
  readonly n: number;
  depth: Float32Array; // 0 raso .. 1 abissal
  baseTemp: Float32Array;
  temp: Float32Array;
  userTemp: Float32Array; // anomalia local (impactos, erupções, ferramentas do jogador)
  light: Float32Array;
  lat: Float32Array; // -1..1
  nutrient: Float64Array;
  detritus: Float64Array;
  vents: Int32Array;
  reservoir = 0;
  climateOffset = 0;
  climateTarget = 0;
  season = 0;
  /** pressão geológica: cresce com o sedimento enterrado e dispara erupções */
  pressure = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.n = w * h;
    const n = this.n;
    this.depth = new Float32Array(n);
    this.baseTemp = new Float32Array(n);
    this.temp = new Float32Array(n);
    this.userTemp = new Float32Array(n);
    this.light = new Float32Array(n);
    this.lat = new Float32Array(n);
    this.nutrient = new Float64Array(n);
    this.detritus = new Float64Array(n);
    this.vents = new Int32Array(0);
  }

  /** Oceano primordial: relevo submarino, fontes hidrotermais e nutrientes iniciais. */
  generate(rng: Rng, nutrientPerCell = 7): void {
    const { w, h } = this;
    const noise = makeNoise2D((rng.next() * 1e9) | 0);
    const ox = rng.range(0, 100), oy = rng.range(0, 100);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        // ruído periódico em x (mundo cilíndrico): mistura de duas amostras deslocadas
        const u = x / w;
        const a = noise(ox + u * 4, oy + (y / h) * 3, 4);
        const b = noise(ox + (u - 1) * 4, oy + (y / h) * 3, 4);
        const v = a * (1 - u) + b * u;
        // 0..1 : plataformas rasas onde v é alto
        let d = 1 - Math.min(1, Math.max(0, (v - 0.25) * 2.0));
        d = Math.pow(d, 1.1);
        this.depth[i] = d;
        this.lat[i] = (y / (h - 1)) * 2 - 1;
      }
    }
    // fontes hidrotermais nas cristas mais profundas
    const idx = Array.from({ length: this.n }, (_, i) => i).sort((a, b) => this.depth[b] - this.depth[a]);
    const vents: number[] = [];
    for (const i of idx) {
      const x = i % w, y = (i / w) | 0;
      if (vents.every((v) => Math.hypot((v % w) - x, ((v / w) | 0) - y) > Math.max(8, w / 8))) vents.push(i);
      if (vents.length >= 6) break;
    }
    this.vents = Int32Array.from(vents);

    this.nutrient.fill(nutrientPerCell);
    this.detritus.fill(0);
    this.reservoir = this.n * nutrientPerCell * 0.25;
    this.pressure = 0;
    this.updateEnvironment(0, true);
  }

  /** Recalcula temperatura e luz (sazonalidade, clima global, anomalias locais). */
  updateEnvironment(tick: number, force = false): void {
    const { w, h } = this;
    this.season = Math.sin((2 * Math.PI * tick) / P.SEASON_PERIOD);
    // clima global relaxa suavemente para o alvo
    this.climateOffset += (this.climateTarget - this.climateOffset) * 0.01;
    for (let i = 0; i < this.n; i++) {
      const lat = this.lat[i];
      const c = Math.cos((lat * Math.PI) / 2);
      const d = this.depth[i];
      let t = 31 * Math.pow(Math.max(c, 0), 1.15) - 3;
      t -= 15 * Math.pow(d, 0.8);
      t += 3.0 * this.season * lat; // hemisférios em oposição
      t += this.climateOffset + this.userTemp[i];
      this.baseTemp[i] = t;
      const solar = 0.3 + 0.7 * Math.pow(Math.max(c, 0), 0.9);
      const seas = 1 + 0.18 * this.season * lat;
      this.light[i] = solar * seas * Math.exp(-d * 3.2);
    }
    // calor hidrotermal
    for (let k = 0; k < this.vents.length; k++) {
      const v = this.vents[k];
      const vx = v % w, vy = (v / w) | 0;
      for (let dy = -3; dy <= 3; dy++) {
        const y = vy + dy;
        if (y < 0 || y >= h) continue;
        for (let dx = -3; dx <= 3; dx++) {
          const x = (vx + dx + w) % w;
          const r2 = dx * dx + dy * dy;
          if (r2 > 9) continue;
          this.baseTemp[y * w + x] += 16 * Math.exp(-r2 / 3.5);
        }
      }
    }
    this.temp.set(this.baseTemp);
    // anomalias locais decaem lentamente
    for (let i = 0; i < this.n; i++) this.userTemp[i] *= 0.9985;
  }

  /** Difusão conservativa do nutriente + decomposição + sedimentação + fontes. */
  stepChemistry(): void {
    const { w, h, nutrient, detritus, temp } = this;
    const D = P.DIFFUSION;
    // fluxo por arestas (conserva massa)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const r = y * w + ((x + 1) % w);
        let f = D * 0.25 * (nutrient[i] - nutrient[r]);
        nutrient[i] -= f;
        nutrient[r] += f;
        if (y + 1 < h) {
          const d = i + w;
          f = D * 0.25 * (nutrient[i] - nutrient[d]);
          nutrient[i] -= f;
          nutrient[d] += f;
        }
      }
    }
    let buried = 0;
    for (let i = 0; i < this.n; i++) {
      const q = Math.min(2, Math.max(0.15, 0.5 + 0.035 * temp[i]));
      const dec = detritus[i] * P.DECOMP_RATE * q;
      detritus[i] -= dec;
      nutrient[i] += dec;
      if (this.depth[i] > 0.6) {
        const b = detritus[i] * P.BURIAL_RATE;
        detritus[i] -= b;
        buried += b;
      }
    }
    this.reservoir += buried;
    this.pressure += buried;
    // fontes hidrotermais devolvem massa do reservatório ao oceano
    for (let k = 0; k < this.vents.length; k++) {
      const f = Math.min(this.reservoir, P.VENT_FLUX);
      nutrient[this.vents[k]] += f;
      this.reservoir -= f;
    }
  }

  totalMass(): { nutrient: number; detritus: number; reservoir: number } {
    let n = 0, d = 0;
    for (let i = 0; i < this.n; i++) {
      n += this.nutrient[i];
      d += this.detritus[i];
    }
    return { nutrient: n, detritus: d, reservoir: this.reservoir };
  }
}
