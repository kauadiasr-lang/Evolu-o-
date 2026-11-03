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

  // ---- Etapa 3: continentes, hidrologia e substrato (zeros/ignorados quando stage3 = false)
  stage3 = false;
  land: Uint8Array;
  /** altitude acima do nível do mar (0..1); 0 na água */
  elev: Float32Array;
  /** precipitação potencial (0..1), calculada da distância ao oceano, latitude e relevo */
  rain: Float32Array;
  /** água disponível no solo (0..1): recarregada pela chuva, consumida pelas plantas */
  soilWater: Float32Array;
  /** matiz (graus) do substrato visível: água, solo ou vegetação — base da camuflagem */
  bgHue: Float32Array;
  landCells: Int32Array = new Int32Array(0);

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
    this.land = new Uint8Array(n);
    this.elev = new Float32Array(n);
    this.rain = new Float32Array(n);
    this.soilWater = new Float32Array(n);
    this.bgHue = new Float32Array(n).fill(195);
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

  /**
   * Mundo com continentes (Etapa 3). Caminho separado de generate(): não toca no RNG do caminho clássico.
   * ~32% da superfície é terra emersa; o restante é oceano com plataformas rasas e abismos.
   */
  generateContinents(rng: Rng, nutrientPerCell = 7, landFraction = 0.32): void {
    const { w, h, n } = this;
    this.stage3 = true;
    const noise = makeNoise2D((rng.next() * 1e9) | 0);
    const ox = rng.range(0, 100), oy = rng.range(0, 100);
    const v = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const a = noise(ox + u * 3.2, oy + (y / h) * 2.4, 5);
        const b = noise(ox + (u - 1) * 3.2, oy + (y / h) * 2.4, 5);
        v[y * w + x] = a * (1 - u) + b * u;
        this.lat[y * w + x] = (y / (h - 1)) * 2 - 1;
      }
    }
    const sorted = Float32Array.from(v).sort();
    const sea = sorted[Math.floor(n * (1 - landFraction))];
    const vmin = sorted[0], vmax = sorted[n - 1];
    for (let i = 0; i < n; i++) {
      if (v[i] > sea) {
        this.land[i] = 1;
        this.elev[i] = Math.min(1, (v[i] - sea) / Math.max(1e-6, vmax - sea));
        this.depth[i] = 0;
      } else {
        this.land[i] = 0;
        this.elev[i] = 0;
        this.depth[i] = Math.pow(Math.min(1, Math.max(0, (sea - v[i]) / Math.max(1e-6, sea - vmin))), 0.9);
      }
    }
    const lc: number[] = [];
    for (let i = 0; i < n; i++) if (this.land[i]) lc.push(i);
    this.landCells = Int32Array.from(lc);

    // fontes hidrotermais nas águas mais profundas
    const idx = Array.from({ length: n }, (_, i) => i).filter((i) => !this.land[i]).sort((a, b) => this.depth[b] - this.depth[a]);
    const vents: number[] = [];
    for (const i of idx) {
      const x = i % w, y = (i / w) | 0;
      if (vents.every((q) => Math.hypot((q % w) - x, ((q / w) | 0) - y) > Math.max(8, w / 8))) vents.push(i);
      if (vents.length >= 6) break;
    }
    this.vents = Int32Array.from(vents);

    this.nutrient.fill(nutrientPerCell);
    this.detritus.fill(0);
    this.reservoir = n * nutrientPerCell * 0.25;
    this.pressure = 0;
    this.computeRain();
    for (let i = 0; i < n; i++) this.bgHue[i] = this.land[i] ? 34 : 200 - 25 * this.depth[i];
    for (const i of lc) this.soilWater[i] = this.rain[i];
    this.updateEnvironment(0, true);
  }

  /** Umidade atmosférica vinda do oceano, atenuada pela distância, latitude (desertos subtropicais) e altitude. */
  private computeRain(): void {
    const { w, h, n } = this;
    let m = new Float32Array(n), nx = new Float32Array(n);
    for (let i = 0; i < n; i++) m[i] = this.land[i] ? 0 : 1;
    for (let it = 0; it < 18; it++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!this.land[i]) { nx[i] = 1; continue; }
          const west = m[y * w + ((x - 1 + w) % w)], east = m[y * w + ((x + 1) % w)];
          const north = y > 0 ? m[i - w] : m[i], south = y + 1 < h ? m[i + w] : m[i];
          nx[i] = 0.965 * (0.4 * west + 0.15 * east + 0.225 * north + 0.225 * south);
        }
      }
      [m, nx] = [nx, m];
    }
    for (let i = 0; i < n; i++) {
      if (!this.land[i]) { this.rain[i] = 0; continue; }
      const lat = Math.abs(this.lat[i]);
      const band = 1 - 0.7 * Math.exp(-(((lat - 0.4) / 0.16) ** 2)) + 0.25 * Math.exp(-((lat / 0.2) ** 2));
      this.rain[i] = Math.min(1, Math.max(0, (0.3 + 0.9 * Math.sqrt(m[i])) * Math.min(1, band) * (1 - 0.45 * this.elev[i])));
    }
  }

  /** Clima: o aquecimento seca a terra; chuva recarrega o solo (as plantas o esvaziam). */
  private updateHydrology(): void {
    const rf = Math.min(1.4, Math.max(0.4, 1 - 0.035 * this.climateOffset));
    for (let k = 0; k < this.landCells.length; k++) {
      const i = this.landCells[k];
      const evap = 1 - 0.014 * Math.max(0, this.temp[i] - 22);
      const freeze = this.temp[i] < -4 ? 0.5 : 1; // água congelada não está disponível
      const target = Math.min(1, Math.max(0, this.rain[i] * rf * (1 + 0.25 * (1 - this.elev[i])) * evap * freeze));
      this.soilWater[i] += (target - this.soilWater[i]) * 0.15;
    }
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
      if (this.stage3) t -= 14 * this.elev[i]; // gradiente térmico com a altitude
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
    if (this.stage3) this.updateHydrology();
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
