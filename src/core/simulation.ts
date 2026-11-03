import { DEFAULT_MUTATION, G, GENE_COUNT, MutationParams, inherit, protocellGenome, protocellMorph } from './genome';
import { ARCHETYPES, ArchetypeKind, archetypeGenome } from './archetypes';
import { Flora } from './flora';
import { camoMatch, develop } from './phenotype';
import { BIOME_INFO, computeTerrain, landMean } from './biomes';
import { OrganismPool } from './organisms';
import { P } from './params';
import { Rng } from './rng';
import { EventLog, History, HISTORY_KEYS } from './stats';
import { SpeciationEvent, SpeciesRegistry, updateSpecies, TROPHIC_LABEL } from './species';
import { Planet } from './world';
import { T, TR, deriveTraits } from './traits';

export interface SimConfig {
  width: number;
  height: number;
  seed: number;
  maxOrganisms: number;
  initialPopulation: number;
  nutrientPerCell: number;
  mutation: MutationParams;
  /** Etapa 3: continentes, flora, morfologia e biomas. false = física da Etapa 1/2, bit a bit. */
  stage3: boolean;
  maxPlants: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  width: 96,
  height: 60,
  seed: 1,
  maxOrganisms: 40000,
  initialPopulation: 700,
  nutrientPerCell: 7,
  mutation: DEFAULT_MUTATION,
  stage3: false,
  maxPlants: 12000,
};

export type DeathCause = 'starve' | 'age' | 'predation' | 'thermal' | 'impact';
export const DEATH_LABEL: Record<DeathCause, string> = {
  starve: 'Fome',
  age: 'Envelhecimento',
  predation: 'Predação',
  thermal: 'Estresse térmico',
  impact: 'Catástrofe',
};

export type PaintMode = 'warm' | 'cool' | 'deepen' | 'shallow' | 'nutrients' | 'impact' | 'seed' | 'erupt' | 'archetype';

/** Motor de simulação: independente de interface, IA e renderização. */
export class Simulation {
  cfg: SimConfig;
  rng: Rng;
  tick = 0;
  planet: Planet;
  pool: OrganismPool;
  species = new SpeciesRegistry();
  history = new History(HISTORY_KEYS);
  events = new EventLog();

  // buckets espaciais (por célula)
  cellStart: Int32Array;
  cellItems: Int32Array;
  cellCount: Int32Array;
  shade: Float32Array;

  // contadores do intervalo atual
  births = 0;
  deathsInterval: Record<DeathCause, number> = { starve: 0, age: 0, predation: 0, thermal: 0, impact: 0 };
  deathsTotal: Record<DeathCause, number> = { starve: 0, age: 0, predation: 0, thermal: 0, impact: 0 };
  mutationsTotal = 0;
  birthsTotal = 0;
  maxGeneration = 0;

  /** fluxos de predação recentes, chave = pred*1e6+presa, valor = massa consumida (suavizada) */
  predFlow = new Map<number, number>();
  /** energia obtida recentemente por espécie e fonte: [luz, detrito, presas] */
  energySrc = new Float64Array(3 * 64);

  private extinctionsInWindow: number[] = [];
  private lastBiomass: number[] = [];
  private lastEventTick = { bloom: -9999, crash: -9999 };
  private topSpecies = 0;
  totalExtinct = false;

  // ---- Etapa 3
  readonly stage3: boolean;
  /** fluxo de RNG exclusivo dos genes morfológicos (não perturba a física clássica) */
  mrng: Rng;
  flora: Flora | null = null;
  private capable = false;
  /** primeira vez que cada estrutura foi expressa por vários indivíduos (para registrar o evento evolutivo) */
  structuresSeen = new Set<string>();

  constructor(cfg: Partial<SimConfig> = {}, init = true) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this.rng = new Rng(this.cfg.seed);
    this.stage3 = this.cfg.stage3;
    this.mrng = new Rng((this.cfg.seed ^ 0x5bd1e995) >>> 0);
    this.planet = new Planet(this.cfg.width, this.cfg.height);
    this.pool = new OrganismPool(this.cfg.maxOrganisms);
    const n = this.planet.n;
    this.cellStart = new Int32Array(n + 1);
    this.cellCount = new Int32Array(n);
    this.cellItems = new Int32Array(this.cfg.maxOrganisms);
    this.shade = new Float32Array(n);
    if (this.stage3) this.flora = new Flora(n, this.cfg.maxPlants, (this.cfg.seed ^ 0x9e3779b1) >>> 0);
    if (init) {
      if (this.stage3) this.planet.generateContinents(this.rng, this.cfg.nutrientPerCell);
      else this.planet.generate(this.rng, this.cfg.nutrientPerCell);
      this.seedPrimordialLife(this.cfg.initialPopulation);
    }
  }

  // ------------------------------------------------------------------ criação

  /** Panspermia: cria protocélulas a partir do nutriente local (massa conservada). */
  seedPrimordialLife(count: number, cx?: number, cy?: number, radius = 0): number {
    const { planet, rng } = this;
    const clumps = cx === undefined ? 8 : 1;
    const centers: [number, number][] = [];
    if (cx !== undefined && cy !== undefined) centers.push([cx, cy]);
    else {
      let guard = 0;
      while (centers.length < clumps && guard++ < 500) {
        const x = rng.int(planet.w), y = rng.int(planet.h);
        const i = y * planet.w + x;
        if (planet.light[i] > 0.3 && planet.temp[i] > 14 && planet.temp[i] < 30 && !(this.stage3 && planet.land[i])) centers.push([x + 0.5, y + 0.5]);
      }
      if (centers.length === 0) centers.push([planet.w / 2, planet.h / 2]);
    }
    let created = 0;
    const tmp = new Float32Array(GENE_COUNT);
    let sp = this.species.list.length ? this.species.list[0] : null;
    for (let k = 0; k < count; k++) {
      const [bx, by] = centers[k % centers.length];
      const rr = cx === undefined ? 5 : Math.max(radius, 1);
      let x = bx + rng.gauss() * rr * 0.6;
      let y = by + rng.gauss() * rr * 0.6;
      x = ((x % planet.w) + planet.w) % planet.w;
      y = Math.min(planet.h - 0.001, Math.max(0, y));
      const c = Math.floor(y) * planet.w + Math.floor(x);
      protocellGenome(rng, tmp, 0);
      if (this.stage3) {
        if (planet.land[c]) continue; // a vida primordial nasce no mar
        protocellMorph(this.mrng, tmp, 0);
      }
      const j = this.spawnRaw(tmp, 0, x, y, c, sp);
      if (j >= 0) {
        created++;
        if (!sp) sp = this.species.list[0];
      }
    }
    if (created > 0) this.events.add({ tick: this.tick, type: 'user', title: 'Vida semeada', text: `${created} protocélulas foram introduzidas no oceano.`, magnitude: created });
    return created;
  }

  /** Cria um organismo "do nada" retirando massa do nutriente local. Retorna índice ou -1. */
  /** Introduz um organismo (massa retirada do nutriente da célula, conservando o total). */
  addOrganism(genes: Float32Array, go: number, x: number, y: number, mass?: number, energy?: number, speciesId?: number): number {
    if (!(x >= 0 && x < this.planet.w && y >= 0 && y < this.planet.h)) return -1;
    const c = Math.floor(y) * this.planet.w + Math.floor(x);
    const sp = speciesId ? this.species.get(speciesId) : this.species.list[0] ?? null;
    return this.spawnRaw(genes, go, x, y, c, sp, mass, energy);
  }

  private spawnRaw(genes: Float32Array, go: number, x: number, y: number, c: number, sp: ReturnType<SpeciesRegistry['create']> | null, massOverride?: number, energyOverride?: number): number {
    const pool = this.pool, planet = this.planet;
    const tr = new Float32Array(TR);
    deriveTraits(genes, go, tr, 0, this.stage3);
    const want = massOverride ?? tr[T.MASS_REPRO] * 0.6;
    // reúne massa da célula e vizinhas
    const take = Math.min(planet.nutrient[c], want);
    if (take < want * 0.8) return -1;
    const j = pool.alloc();
    if (j < 0) return -1;
    planet.nutrient[c] -= take;
    for (let k = 0; k < GENE_COUNT; k++) pool.genes[j * GENE_COUNT + k] = genes[go + k];
    pool.tr.set(tr, j * TR);
    let species = sp;
    if (!species) {
      species = this.species.create(null, genes, go, this.tick, this.rng, 'Protocellula primordialis');
    }
    pool.species[j] = species.id;
    species.count++;
    species.totalBorn++;
    if (species.count > species.peak) {
      species.peak = species.count;
      species.peakTick = this.tick;
    }
    pool.parent[j] = 0;
    pool.gen[j] = 0;
    pool.born[j] = this.tick - 1; // permite processar no próximo tick
    pool.age[j] = 0;
    pool.x[j] = x;
    pool.y[j] = y;
    pool.vx[j] = 0;
    pool.vy[j] = 0;
    pool.mass[j] = take;
    pool.energy[j] = energyOverride ?? take * 3;
    pool.cell[j] = c;
    return j;
  }

  // ------------------------------------------------------------------ passo

  private buildBuckets(): void {
    const { pool, planet } = this;
    const { cellCount, cellStart, cellItems, shade } = this;
    const w = planet.w, n = pool.used;
    cellCount.fill(0);
    shade.fill(0);
    const { alive, x, y, cell, mass, tr } = pool;
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const c = (y[i] | 0) * w + (x[i] | 0);
      cell[i] = c;
      cellCount[c]++;
      const ph = tr[i * TR + T.PHOTO];
      if (ph > 0.01) shade[c] += ph * Math.cbrt(mass[i] * mass[i]);
    }
    let acc = 0;
    for (let c = 0; c < planet.n; c++) {
      cellStart[c] = acc;
      acc += cellCount[c];
    }
    cellStart[planet.n] = acc;
    const fill = this.fillPos ?? (this.fillPos = new Int32Array(planet.n));
    fill.fill(0);
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      const c = cell[i];
      cellItems[cellStart[c] + fill[c]++] = i;
    }
  }
  private fillPos?: Int32Array;

  step(): void {
    const { pool, planet } = this;
    if (this.tick % P.ENV_UPDATE_EVERY === 0) planet.updateEnvironment(this.tick);
    this.buildBuckets();
    const n = pool.used;
    const off = n > 0 ? this.rng.int(n) : 0;
    for (let k = 0; k < n; k++) {
      let i = k + off;
      if (i >= n) i -= n;
      if (!pool.alive[i] || pool.born[i] === this.tick) continue;
      this.updateOrganism(i);
    }
    if (this.flora) this.flora.step(planet, this.tick);
    planet.stepChemistry();
    this.geology();
    this.tick++;
    if (this.tick % P.SPECIATION_EVERY === 0) this.speciationPass();
    if (this.tick % P.HISTORY_EVERY === 0) this.sampleHistory();
    if (pool.count === 0 && !this.totalExtinct && this.tick > 10) {
      this.totalExtinct = true;
      this.events.add({ tick: this.tick, type: 'total_extinction', title: 'Extinção total', text: 'Nenhum organismo restou no planeta. A história da vida terminou — a menos que algo a recomece.' });
    }
    if (pool.count > 0) this.totalExtinct = false;
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  private kill(i: number, cause: DeathCause, toDetritus = true): void {
    const { pool, planet } = this;
    if (toDetritus) planet.detritus[pool.cell[i]] += pool.mass[i];
    const sp = this.species.get(pool.species[i]);
    sp.count--;
    if (sp.count <= 0 && sp.extinctTick < 0) this.markExtinct(sp, cause);
    pool.release(i);
    this.deathsInterval[cause]++;
    this.deathsTotal[cause]++;
  }

  private markExtinct(sp: ReturnType<SpeciesRegistry['get']>, cause: DeathCause): void {
    sp.count = 0;
    sp.extinctTick = this.tick;
    sp.cause = DEATH_LABEL[cause];
    this.extinctionsInWindow.push(this.tick);
    if (sp.peak >= 25 || this.tick - sp.bornTick > 600) {
      this.events.add({
        tick: this.tick,
        type: 'extinction',
        title: `Extinção: ${sp.name}`,
        text: `${sp.name} (${TROPHIC_LABEL[sp.trophic]}) desapareceu após ${this.tick - sp.bornTick} ticks de existência, com pico de ${sp.peak} indivíduos. Causa principal: ${sp.cause.toLowerCase()}.`,
        speciesId: sp.id,
        magnitude: sp.peak,
      });
    }
  }

  private updateOrganism(i: number): void {
    const { pool, planet, rng, tick } = this;
    const c = pool.cell[i];
    const tb = i * TR;
    const tr = pool.tr;
    const T_ = planet.temp[c];
    let mass = pool.mass[i];
    let energy = pool.energy[i];
    const sId = pool.species[i];

    // eficiência térmica (curva gaussiana em torno do ótimo)
    const dT = (T_ - tr[tb + T.TOPT]) / tr[tb + T.TWIDTH];
    const tf = Math.exp(-dT * dT);
    const m23 = Math.cbrt(mass * mass);
    const land = this.stage3 && planet.land[c] === 1;
    // em terra, o dossel das plantas sombreia o chão (Etapa 3)
    const lightHere = land ? planet.light[c] * this.flora!.understory[c] : planet.light[c];

    // --- fotossíntese (luz compartilhada e sombreada pelos vizinhos)
    const photo = tr[tb + T.PHOTO];
    if (photo > 0.01) {
      const gain = P.PHOTO_K * photo * (lightHere / (1 + P.SHADE_K * this.shade[c])) * m23 * tf;
      energy += gain;
      this.addSrc(sId, 0, gain);
    }

    // --- osmotrofia: absorve detritos (devolve parte como nutriente dissolvido)
    const osmo = tr[tb + T.OSMO];
    if (osmo > 0.01) {
      const det = planet.detritus[c];
      if (det > 0.0005) {
        const cap = P.OSMO_K * osmo * m23 * tf;
        const a = Math.min(cap, det * P.OSMO_SHARE);
        planet.detritus[c] = det - a;
        mass += a * P.ASSIM_DETRITUS;
        planet.nutrient[c] += a * (1 - P.ASSIM_DETRITUS);
        const e = a * P.E_PER_MASS * P.DET_EFF;
        energy += e;
        this.addSrc(sId, 1, e);
      }
    }

    // --- predação
    const pred = tr[tb + T.PRED];
    if (pred > P.PRED_MIN) {
      const cnt = this.cellCount[c];
      energy -= P.ATTACK_COST * pred * m23;
      if (cnt > 1) {
        const j = this.cellItems[this.cellStart[c] + rng.int(cnt)];
        if (j !== i && pool.alive[j] && pool.born[j] !== tick) {
          const mj = pool.mass[j];
          if (mj <= mass * P.PREY_MASS_RATIO) {
            const jb = j * TR;
            const evade = 1 - 0.45 * Math.min(1, tr[jb + T.SPEED] * 5);
            let p = pred * (1 - 0.88 * tr[jb + T.DEF]) * evade;
            p *= Math.min(1, 0.45 + 0.55 * (mass / Math.max(mj, 1e-6) - 1) * 0.5 + 0.25);
            if (this.stage3) {
              // olhos melhoram a caça; camuflagem (casada com o substrato) e escalada reduzem a captura
              p *= 1 + 0.3 * (tr[tb + T.EYES] / 3) * (1 + 0.3 * tr[tb + T.HEAD]);
              const cj = tr[jb + T.CAMO];
              if (cj > 0) p *= 1 - 0.6 * cj * camoMatch(tr[jb + T.BODYHUE], planet.bgHue[c]);
              if (land && tr[jb + T.CLIMB] > 0) p *= 1 - 0.35 * tr[jb + T.CLIMB];
            }
            if (rng.next() < p * tf) {
              const gainM = mj * P.PRED_ASSIM;
              mass += gainM;
              planet.detritus[c] += mj - gainM;
              const e = pool.energy[j] * P.PRED_ENERGY_STEAL + mj * P.E_PER_MASS * P.PRED_ENERGY_EFF;
              energy += e;
              this.addSrc(sId, 2, e);
              const key = sId * 1e6 + pool.species[j];
              this.predFlow.set(key, (this.predFlow.get(key) ?? 0) + mj);
              // morte da presa (massa já redistribuída)
              const spj = this.species.get(pool.species[j]);
              spj.count--;
              if (spj.count <= 0 && spj.extinctTick < 0) this.markExtinct(spj, 'predation');
              pool.release(j);
              this.deathsInterval.predation++;
              this.deathsTotal.predation++;
            }
          }
        }
      }
    }

    // --- herbivoria (Etapa 3): morde plantas ao alcance; alturas fora do alcance só são acessíveis a escaladores
    if (land && pred > P.PRED_MIN && this.flora) {
      const eat = this.flora.graze(planet, c, tr[tb + T.REACH], 0.35 * pred * m23);
      if (eat > 0) {
        const gainM = eat * P.PRED_ASSIM;
        mass += gainM;
        planet.detritus[c] += eat - gainM;
        const e = eat * P.E_PER_MASS * 0.45;
        energy += e;
        this.addSrc(sId, 2, e);
      }
    }

    // --- manutenção metabólica (custos das adaptações embutidos em COST_MULT)
    const q = Math.min(2.5, Math.max(0.3, Math.exp(0.05 * (T_ - 15))));
    let up = P.UP_K * Math.pow(mass, 0.75) * tr[tb + T.META] * q * tr[tb + T.COST_MULT];
    up *= 1 + P.THERMAL_STRESS * (1 - tf); // fora do ótimo, o reparo celular custa mais
    if (land) up += P.DESICCATION * (1 - tr[tb + T.TERR]) * (1 - 0.7 * planet.soilWater[c]) * m23; // dessecação
    energy -= up;

    // --- crescimento (absorção de nutriente dissolvido)
    const massMax = tr[tb + T.MASS_MAX];
    const reserve = P.RESERVE_PER_MASS * mass;
    if (energy > reserve && mass < massMax) {
      const nut = planet.nutrient[c];
      if (nut > 0.001) {
        const cap = P.GROW_K * Math.pow(mass, 0.75) * tr[tb + T.META] * tf;
        const avail = nut * P.NUT_SHARE * Math.min(1, tr[tb + T.AFFIN]);
        const g = Math.min(cap, avail, (energy - reserve) / P.BUILD_COST, massMax - mass);
        if (g > 0) {
          mass += g;
          energy -= g * P.BUILD_COST;
          planet.nutrient[c] = nut - g;
        }
      }
    }
    const ecap = P.ECAP_PER_MASS * mass;
    if (energy > ecap) energy = ecap;

    // --- reprodução
    const age = pool.age[i];
    if (mass >= tr[tb + T.MASS_REPRO] && age >= P.MIN_REPRO_AGE) {
      const crowd = this.cellCount[c];
      const crowdFactor = crowd > P.CROWD_SOFT ? 1 / (1 + 0.35 * (crowd - P.CROWD_SOFT)) : 1;
      const cf = tr[tb + T.CHILD_FRAC];
      const childMass = mass * cf;
      const cost = P.REPRO_COST * childMass;
      if (energy > cost + reserve * 0.5 && rng.next() < crowdFactor) {
        const childEnergy = (energy - cost) * cf;
        if (this.spawnChild(i, childMass, childEnergy)) {
          mass -= childMass;
          energy = (energy - cost) * (1 - cf);
        }
      }
    }
    if (mass > massMax) {
      planet.detritus[c] += mass - massMax;
      mass = massMax;
    }

    // --- morte
    pool.mass[i] = mass;
    pool.energy[i] = energy;
    if (energy <= 0) {
      this.kill(i, tf < 0.3 ? 'thermal' : 'starve');
      return;
    }
    const life = tr[tb + T.LIFESPAN];
    if (age > life && rng.next() < ((age - life) / life) * P.SENESCENCE) {
      this.kill(i, 'age');
      return;
    }
    pool.age[i] = age + 1;

    this.move(i, c, tf);
  }

  private addSrc(sp: number, k: number, v: number): void {
    const idx = sp * 3 + k;
    if (idx >= this.energySrc.length) {
      const n = new Float64Array(Math.max(this.energySrc.length * 2, idx + 3));
      n.set(this.energySrc);
      this.energySrc = n;
    }
    this.energySrc[idx] += v;
  }

  private spawnChild(p: number, childMass: number, childEnergy: number): boolean {
    const { pool, rng, planet } = this;
    const j = pool.alloc();
    if (j < 0) return false;
    const muts = inherit(pool.genes, p * GENE_COUNT, pool.genes, j * GENE_COUNT, rng, this.cfg.mutation, this.stage3 ? this.mrng : undefined);
    this.mutationsTotal += muts;
    deriveTraits(pool.genes, j * GENE_COUNT, pool.tr, j * TR, this.stage3);
    const sid = pool.species[p];
    pool.species[j] = sid;
    const sp = this.species.get(sid);
    sp.count++;
    sp.totalBorn++;
    if (sp.count > sp.peak) {
      sp.peak = sp.count;
      sp.peakTick = this.tick;
    }
    pool.parent[j] = pool.id[p];
    const gen = pool.gen[p] + 1;
    pool.gen[j] = gen;
    if (gen > this.maxGeneration) this.maxGeneration = gen;
    pool.born[j] = this.tick;
    pool.age[j] = 0;
    const disp = 0.25 + 1.2 * pool.tr[p * TR + T.MOTIL];
    let x = pool.x[p] + (rng.next() - 0.5) * 2 * disp;
    let y = pool.y[p] + (rng.next() - 0.5) * 2 * disp;
    x = ((x % planet.w) + planet.w) % planet.w;
    y = y < 0 ? 0 : y >= planet.h ? planet.h - 0.001 : y;
    if (this.stage3 && planet.land[(y | 0) * planet.w + (x | 0)] && !(pool.tr[p * TR + T.TERR] > 0 && pool.tr[p * TR + T.LSPEED] > 0)) {
      x = pool.x[p]; // prole aquática não nasce em terra firme
      y = pool.y[p];
    }
    pool.x[j] = x;
    pool.y[j] = y;
    pool.vx[j] = 0;
    pool.vy[j] = 0;
    pool.cell[j] = (y | 0) * planet.w + (x | 0);
    pool.mass[j] = childMass;
    pool.energy[j] = childEnergy;
    this.births++;
    this.birthsTotal++;
    return true;
  }

  private move(i: number, c: number, tf: number): void {
    const { pool, planet, rng } = this;
    const tb = i * TR;
    const tr = pool.tr;
    const onLand = this.stage3 && planet.land[c] === 1;
    const spd = onLand ? tr[tb + T.LSPEED] : tr[tb + T.SPEED];
    if (this.stage3) this.capable = tr[tb + T.TERR] > 0 && tr[tb + T.LSPEED] > 0;
    const w = planet.w, h = planet.h;
    let vx = pool.vx[i] * 0.6 + (rng.next() - 0.5) * 2 * (spd * 0.7 + P.BROWN);
    let vy = pool.vy[i] * 0.6 + (rng.next() - 0.5) * 2 * (spd * 0.7 + P.BROWN);
    const sense = tr[tb + T.SENSE];
    if (spd > 0.004 && sense > 0.05 && ((this.tick + i) & 3) === 0) {
      // quimiotaxia: compara a célula atual com as 4 vizinhas
      const cx = c % w, cy = (c / w) | 0;
      const photo = tr[tb + T.PHOTO], osmo = tr[tb + T.OSMO], pred = tr[tb + T.PRED];
      const topt = tr[tb + T.TOPT], tw = tr[tb + T.TWIDTH];
      let best = this.score(c, photo, osmo, pred, topt, tw);
      let bx = 0, by = 0;
      for (let d = 0; d < 4; d++) {
        const dx = d === 0 ? 1 : d === 1 ? -1 : 0;
        const dy = d === 2 ? 1 : d === 3 ? -1 : 0;
        const ny = cy + dy;
        if (ny < 0 || ny >= h) continue;
        const nc = ny * w + ((cx + dx + w) % w);
        const s = this.score(nc, photo, osmo, pred, topt, tw);
        if (s > best + 0.02) {
          best = s;
          bx = dx;
          by = dy;
        }
      }
      vx += bx * spd * sense * 2.2;
      vy += by * spd * sense * 2.2;
    }
    let x = pool.x[i] + vx;
    let y = pool.y[i] + vy;
    x = x < 0 ? x + w : x >= w ? x - w : x;
    if (y < 0) { y = 0; vy = -vy; } else if (y >= h) { y = h - 0.001; vy = -vy; }
    if (this.stage3 && !this.capable && planet.land[(y | 0) * w + (x | 0)]) {
      // sem membros e integumento adaptado, a costa é uma barreira
      x = pool.x[i];
      y = pool.y[i];
      vx = -vx * 0.5;
      vy = -vy * 0.5;
    }
    pool.x[i] = x;
    pool.y[i] = y;
    pool.vx[i] = vx;
    pool.vy[i] = vy;
    // custo de nadar: ao quadrado da velocidade
    const speed2 = vx * vx + vy * vy;
    pool.energy[i] -= 0.9 * speed2 * Math.cbrt(pool.mass[i]);
  }

  private score(c: number, photo: number, osmo: number, pred: number, topt: number, tw: number): number {
    const p = this.planet;
    if (this.stage3 && p.land[c] === 1) {
      if (!this.capable) return -1e9;
      // em terra, vegetação ao alcance atrai herbívoros
      const veg = this.flora!.cellMass[c];
      const dl = (p.temp[c] - topt) / tw;
      return pred * 0.8 * Math.min(1, veg / 6) + osmo * 0.6 * Math.min(1, p.detritus[c] / 2) + 0.6 * Math.exp(-dl * dl) - 0.15;
    }
    const d = (p.temp[c] - topt) / tw;
    const tf = Math.exp(-d * d);
    const s =
      photo * (p.light[c] / (1 + P.SHADE_K * this.shade[c])) +
      osmo * 0.6 * Math.min(1, p.detritus[c] / 2) +
      pred * 0.6 * Math.min(1, this.cellCount[c] / 5) +
      0.25 * Math.min(1, p.nutrient[c] / 8);
    return s * (0.4 + 0.6 * tf) + 0.6 * tf;
  }

  /**
   * Sandbox: introduz uma linhagem com plano corporal de um arquétipo (massa vinda do nutriente local).
   * É só um ponto de partida: custos, ambiente e predação decidem se ela persiste.
   */
  seedArchetype(kind: ArchetypeKind, cx: number, cy: number, count = 24, radius = 2): number {
    const { planet, rng } = this;
    const info = ARCHETYPES[kind];
    const tmp = new Float32Array(GENE_COUNT);
    archetypeGenome(kind, rng, this.mrng, tmp, 0);
    const probe = new Float32Array(TR);
    deriveTraits(tmp, 0, probe, 0, this.stage3);
    const terrestrial = probe[T.TERR] > 0 && probe[T.LSPEED] > 0;
    const parent = this.species.list[0] ?? null;
    const sp = this.species.create(parent, tmp, 0, this.tick, rng);
    let created = 0;
    for (let k = 0; k < count; k++) {
      archetypeGenome(kind, rng, this.mrng, tmp, 0);
      const x = (((cx + rng.gauss() * radius * 0.6) % planet.w) + planet.w) % planet.w;
      const y = Math.min(planet.h - 0.001, Math.max(0, cy + rng.gauss() * radius * 0.6));
      const c = Math.floor(y) * planet.w + Math.floor(x);
      if (this.stage3 && planet.land[c] && !terrestrial) continue;
      // se o nutriente local não basta, completa a massa com o sedimento (reservatório): só move matéria
      const need = probe[T.MASS_REPRO] * 0.6 - planet.nutrient[c];
      if (need > 0 && planet.reservoir > 0) {
        const mv = Math.min(need, planet.reservoir);
        planet.nutrient[c] += mv;
        planet.reservoir -= mv;
      }
      // reserva energética inicial cheia: o sandbox permite observar o plano corporal antes da seleção agir
      const j = this.spawnRaw(tmp, 0, x, y, c, sp, undefined, 4 * probe[T.MASS_REPRO] * 0.6);
      if (j >= 0) created++;
    }
    if (created === 0) {
      sp.extinctTick = this.tick;
      sp.cause = 'sem nutrientes ou habitat';
    } else {
      this.events.add({ tick: this.tick, type: 'user', title: `Arquétipo semeado: ${info.label}`, text: `${created} indivíduos de ${sp.name} foram introduzidos (${info.desc}) Daqui em diante, apenas a seleção natural decide.`, speciesId: sp.id, magnitude: created });
    }
    return created;
  }

  // ------------------------------------------------------------------ geologia

  /** Erupções surgem da pressão acumulada por sedimentos — não são aleatórias. */
  private geology(): void {
    const pl = this.planet;
    if (pl.pressure > P.ERUPTION_PRESSURE && pl.vents.length > 0 && pl.reservoir > 20) {
      const v = pl.vents[this.rng.int(pl.vents.length)];
      const amount = Math.min(pl.reservoir * 0.6, pl.pressure * 0.8);
      pl.pressure = 0;
      this.eruption(v % pl.w, (v / pl.w) | 0, 4, amount, true);
    }
  }

  /** Libera massa do reservatório (manto/sedimento) no oceano e aquece a região. */
  eruption(cx: number, cy: number, radius: number, amount: number, natural = false): number {
    const pl = this.planet;
    amount = Math.min(amount, pl.reservoir);
    if (amount <= 0) return 0;
    const cells: { c: number; wgt: number; d: number }[] = [];
    let wsum = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const y = Math.floor(cy) + dy;
      if (y < 0 || y >= pl.h) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const x = (((Math.floor(cx) + dx) % pl.w) + pl.w) % pl.w;
        const wgt = Math.exp(-(d * d) / (radius * radius * 0.5));
        cells.push({ c: y * pl.w + x, wgt, d });
        wsum += wgt;
      }
    }
    let killed = 0;
    const inCell = new Set<number>();
    for (const e of cells) {
      pl.nutrient[e.c] += (amount * e.wgt) / wsum;
      pl.userTemp[e.c] += 14 * e.wgt;
      if (e.d <= 1.6) inCell.add(e.c);
    }
    pl.reservoir -= amount;
    for (let i = 0; i < this.pool.used; i++) {
      if (this.pool.alive[i] && inCell.has(this.pool.cell[i])) {
        this.kill(i, 'thermal');
        killed++;
      }
    }
    this.events.add({
      tick: this.tick,
      type: 'eruption',
      title: natural ? 'Erupção hidrotermal' : 'Erupção induzida',
      text: `${natural ? 'A pressão acumulada pelos sedimentos enterrados rompeu uma fonte hidrotermal' : 'Uma intervenção abriu uma fenda no leito oceânico'}: ${amount.toFixed(0)} unidades de massa mineral subiram ao oceano, aquecendo a região e matando ${killed} organismos no epicentro.`,
      magnitude: amount,
    });
    return amount;
  }

  /**
   * Ressurgência: leva massa mineral do reservatório (sedimento) à água em torno de (cx,cy).
   * Não aquece nem mata: apenas redistribui recursos (massa total conservada).
   */
  upwelling(cx: number, cy: number, radius: number, amount: number): number {
    const pl = this.planet;
    amount = Math.min(amount, pl.reservoir);
    if (amount <= 0) return 0;
    const cells: { c: number; w: number }[] = [];
    let ws = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const y = Math.floor(cy) + dy;
      if (y < 0 || y >= pl.h) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const x = (((Math.floor(cx) + dx) % pl.w) + pl.w) % pl.w;
        const w = Math.exp(-(d * d) / (radius * radius * 0.6));
        cells.push({ c: y * pl.w + x, w });
        ws += w;
      }
    }
    for (const e of cells) pl.nutrient[e.c] += (amount * e.w) / ws;
    pl.reservoir -= amount;
    return amount;
  }

  /** Impacto: mata tudo no raio, devolvendo a massa como detrito, e aquece a água. */
  impact(cx: number, cy: number, radius: number): number {
    const pl = this.planet;
    let killed = 0;
    const r2 = radius * radius;
    for (let i = 0; i < this.pool.used; i++) {
      if (!this.pool.alive[i]) continue;
      let dx = Math.abs(this.pool.x[i] - cx);
      if (dx > pl.w / 2) dx = pl.w - dx;
      const dy = this.pool.y[i] - cy;
      if (dx * dx + dy * dy <= r2) {
        this.kill(i, 'impact');
        killed++;
      }
    }
    const R = Math.ceil(radius * 1.5);
    for (let dy = -R; dy <= R; dy++) {
      const y = Math.floor(cy) + dy;
      if (y < 0 || y >= pl.h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > R * R) continue;
        const x = (((Math.floor(cx) + dx) % pl.w) + pl.w) % pl.w;
        pl.userTemp[y * pl.w + x] += 10 * Math.exp(-d2 / (radius * radius));
      }
    }
    this.events.add({
      tick: this.tick,
      type: 'impact',
      title: 'Impacto de asteroide',
      text: `Um impacto devastou uma região de raio ${radius.toFixed(0)}, eliminando ${killed} organismos. A biomassa virou detrito e a água local aqueceu.`,
      magnitude: killed,
    });
    return killed;
  }

  /** Extinção em massa induzida: reduz a população global (massa -> detrito). */
  massExtinction(fraction: number): number {
    let killed = 0;
    for (let i = 0; i < this.pool.used; i++) {
      if (this.pool.alive[i] && this.rng.next() < fraction) {
        this.kill(i, 'impact');
        killed++;
      }
    }
    this.events.add({
      tick: this.tick,
      type: 'mass_extinction',
      title: 'Extinção em massa',
      text: `Uma catástrofe global eliminou ${killed} organismos (${(fraction * 100).toFixed(0)}% da vida). Os sobreviventes herdam um mundo vazio.`,
      magnitude: killed,
    });
    return killed;
  }

  setClimate(deltaT: number): void {
    this.planet.climateTarget = deltaT;
    this.events.add({
      tick: this.tick,
      type: 'climate',
      title: deltaT > 0 ? 'Aquecimento global' : deltaT < 0 ? 'Resfriamento global' : 'Clima restaurado',
      text: `O clima global está sendo ajustado para ${deltaT >= 0 ? '+' : ''}${deltaT.toFixed(0)} °C em relação à linha de base.`,
      magnitude: deltaT,
    });
  }

  /** Ferramenta de pincel do jogador. Todas as operações respeitam a conservação de massa. */
  paint(mode: PaintMode, cx: number, cy: number, radius: number, kind?: ArchetypeKind): void {
    const pl = this.planet;
    if (mode === 'archetype') {
      this.seedArchetype(kind ?? 'swimmer', cx, cy, Math.round(12 + radius * 4), Math.max(1.5, radius));
      return;
    }
    if (mode === 'impact') {
      this.impact(cx, cy, radius);
      return;
    }
    if (mode === 'erupt') {
      this.eruption(cx, cy, Math.max(2, Math.round(radius)), 60);
      return;
    }
    if (mode === 'seed') {
      this.seedPrimordialLife(Math.round(10 + radius * 8), cx, cy, radius);
      return;
    }
    const R = Math.ceil(radius);
    for (let dy = -R; dy <= R; dy++) {
      const y = Math.floor(cy) + dy;
      if (y < 0 || y >= pl.h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const x = (((Math.floor(cx) + dx) % pl.w) + pl.w) % pl.w;
        const i = y * pl.w + x;
        const f = 1 - d / (radius + 0.001);
        if (mode === 'warm') pl.userTemp[i] += 3 * f;
        else if (mode === 'cool') pl.userTemp[i] -= 3 * f;
        else if (mode === 'deepen') { if (!(this.stage3 && pl.land[i])) pl.depth[i] = Math.min(1, pl.depth[i] + 0.08 * f); }
        else if (mode === 'shallow') { if (!(this.stage3 && pl.land[i])) pl.depth[i] = Math.max(0, pl.depth[i] - 0.08 * f); }
        else if (mode === 'nutrients') {
          const amt = Math.min(pl.reservoir, 3 * f);
          pl.nutrient[i] += amt;
          pl.reservoir -= amt;
        }
      }
    }
    pl.updateEnvironment(this.tick);
  }

  // ------------------------------------------------------------------ periódicos

  private speciationPass(): void {
    const evs: SpeciationEvent[] = updateSpecies(this.species, this.pool, this.tick, this.rng);
    for (const e of evs) {
      this.events.add({
        tick: this.tick,
        type: 'speciation',
        title: `Nova espécie: ${e.species.name}`,
        text: `${e.size} indivíduos de ${e.parent.name} divergiram geneticamente (${e.reason}) e passaram a formar ${e.species.name}, classificada como ${TROPHIC_LABEL[e.species.trophic].toLowerCase()}.`,
        speciesId: e.species.id,
        magnitude: e.size,
      });
    }
    // trilha evolutiva: genoma médio de cada espécie ao longo do tempo
    if (this.tick % 400 === 0) {
      for (const sp of this.species.list) {
        if (sp.extinctTick >= 0 || sp.count < 8) continue;
        sp.trail.push({ tick: this.tick, genes: Array.from(sp.centroid) });
        if (sp.trail.length > 16) sp.trail = sp.trail.filter((_, i) => i === 0 || i % 2 === 1 || i === sp.trail.length - 1);
      }
    }
    if (this.flora && !this.flora.colonized) this.checkColonization();
  }

  /**
   * Colonização da terra: acontece quando o mar acumula biomassa fotossintética suficiente
   * (condição observada no estado real, não um sorteio): esporos/algas chegam às margens úmidas.
   */
  private checkColonization(): void {
    if (this.tick < 500) return;
    const pool = this.pool;
    let pb = 0;
    for (let i = 0; i < pool.used; i++) if (pool.alive[i] && pool.tr[i * TR + T.PHOTO] > 0.3) pb += pool.mass[i];
    if (pb < 400) return;
    const n = this.flora!.colonize(this.planet, this.tick, 48);
    if (n > 0) {
      this.events.add({
        tick: this.tick,
        type: 'flora',
        title: 'Colonização da terra',
        text: `Com ${pb.toFixed(0)} unidades de biomassa fotossintética no mar, as primeiras ${n} plantas pioneiras se estabeleceram nas margens úmidas dos continentes.`,
        magnitude: n,
      });
    }
  }

  /** Eventos evolutivos reais: primeiras estruturas expressas, primeiros animais em terra, mudanças de bioma. */
  private detectStage3Events(): void {
    const pool = this.pool, pl = this.planet;
    const names = ['segmentos', 'membros', 'nadadeiras', 'olhos', 'camuflagem', 'escalada', 'adaptação terrestre', 'antenas', 'cauda propulsora'];
    const idxs = [T.SEG, T.LIMBS, T.FINS, T.EYES, T.CAMO, T.CLIMB, T.TERR, T.ANT, T.TAIL];
    const cnt = new Int32Array(idxs.length);
    const perSp = new Map<string, Map<number, number>>();
    let onLand = 0;
    for (let i = 0; i < pool.used; i++) {
      if (!pool.alive[i]) continue;
      const tb = i * TR;
      if (pl.land[pool.cell[i]]) onLand++;
      for (let k = 0; k < idxs.length; k++) {
        if (pool.tr[tb + idxs[k]] > 0) {
          cnt[k]++;
          if (!this.structuresSeen.has(names[k])) {
            const m = perSp.get(names[k]) ?? new Map<number, number>();
            m.set(pool.species[i], (m.get(pool.species[i]) ?? 0) + 1);
            perSp.set(names[k], m);
          }
        }
      }
    }
    for (let k = 0; k < idxs.length; k++) {
      if (cnt[k] >= 8 && !this.structuresSeen.has(names[k]) && pool.count > 0) {
        this.structuresSeen.add(names[k]);
        const top = [...(perSp.get(names[k]) ?? [])].sort((a, b) => b[1] - a[1])[0];
        const sp = top ? this.species.get(top[0]) : null;
        this.events.add({
          tick: this.tick,
          type: 'adaptation',
          title: `Surgem ${names[k]}`,
          text: `${cnt[k]} indivíduos (${((cnt[k] / pool.count) * 100).toFixed(1)}% da população) passaram a expressar ${names[k]}${sp ? `, principalmente em ${sp.name}` : ''}. A estrutura surgiu por mutações herdadas e se mantém enquanto seus benefícios superarem o custo de manutenção.`,
          speciesId: sp?.id,
          magnitude: cnt[k],
        });
      }
    }
    if (onLand >= 3 && !this.structuresSeen.has('terra')) {
      this.structuresSeen.add('terra');
      this.events.add({ tick: this.tick, type: 'adaptation', title: 'Animais em terra firme', text: `${onLand} organismos vivem fora d'água, em células continentais — apenas possível porque possuem membros e integumento que retém água.`, magnitude: onLand });
    }
    // mudanças de bioma: compara com ~1500 ticks atrás, citando as causas medidas
    const h = this.history;
    const look = Math.min(h.ticks.length - 1, 60);
    if (look >= 20 && this.tick - this.lastBiomeEvent > 1500) {
      const keys: [string, string][] = [['bForest', 'Floresta'], ['bGrass', 'Pradaria'], ['bDesert', 'Deserto'], ['bTundra', 'Tundra'], ['bSwamp', 'Pântano'], ['bShrub', 'Arbustal']];
      for (const [key, label] of keys) {
        const ser = h.series[key];
        const a = ser[ser.length - 1 - look], b = ser[ser.length - 1];
        if (Math.max(a, b) > 0.02 && Math.abs(b - a) > 0.25 * Math.max(a, b) && Math.abs(b - a) > 0.015) {
          this.lastBiomeEvent = this.tick;
          const dT = h.series.landTemp[h.series.landTemp.length - 1] - h.series.landTemp[h.series.landTemp.length - 1 - look];
          const dW = h.series.landWater[h.series.landWater.length - 1] - h.series.landWater[h.series.landWater.length - 1 - look];
          const dC = h.series.cover[h.series.cover.length - 1] - h.series.cover[h.series.cover.length - 1 - look];
          this.events.add({
            tick: this.tick,
            type: 'biome',
            title: `${label} ${b > a ? 'avança' : 'recua'}`,
            text: `${label}: ${(a * 100).toFixed(1)}% → ${(b * 100).toFixed(1)}% da superfície em ${look * P.HISTORY_EVERY} ticks. Medido no período: temperatura média em terra ${dT >= 0 ? '+' : ''}${dT.toFixed(1)} °C, umidade do solo ${dW >= 0 ? '+' : ''}${(dW * 100).toFixed(0)} p.p., cobertura vegetal ${dC >= 0 ? '+' : ''}${(dC * 100).toFixed(0)} p.p.`,
            magnitude: b - a,
          });
          break;
        }
      }
    }
  }
  private lastBiomeEvent = -9999;

  private stage3Series(): Record<string, number> {
    if (!this.stage3 || !this.flora) return {};
    const t = computeTerrain(this);
    const a = t.areas;
    return {
      plants: this.flora.pool.count,
      plantMass: this.flora.totalMass(),
      cover: landMean(this, 'cover'),
      canopy: landMean(this, 'lai'),
      bForest: a[10], bGrass: a[8], bShrub: a[9], bDesert: a[6], bTundra: a[5] + a[4], bSwamp: a[11],
      landTemp: landMean(this, 'temp'),
      landWater: landMean(this, 'water'),
    };
  }

  sampleHistory(): void {
    const { pool, planet } = this;
    let pop = 0, biomass = 0, tsum = 0;
    let nPhoto = 0, nMixo = 0, nOsmo = 0, nPred = 0;
    const gsum = new Float64Array(GENE_COUNT);
    for (let i = 0; i < pool.used; i++) {
      if (!pool.alive[i]) continue;
      pop++;
      biomass += pool.mass[i];
      tsum += planet.temp[pool.cell[i]];
      const o = i * GENE_COUNT;
      for (let k = 0; k < GENE_COUNT; k++) gsum[k] += pool.genes[o + k];
    }
    for (const s of this.species.list) {
      if (s.extinctTick >= 0 || s.count === 0) continue;
      if (s.trophic === 'photo') nPhoto += s.count;
      else if (s.trophic === 'mixo') nMixo += s.count;
      else if (s.trophic === 'osmo' || s.trophic === 'none') nOsmo += s.count;
      else nPred += s.count;
    }
    const inv = pop > 0 ? 1 / pop : 0;
    const wm = planet.totalMass();
    const deaths = Object.values(this.deathsInterval).reduce((a, b) => a + b, 0);
    this.history.push(this.tick, {
      pop, species: this.species.aliveCount(), biomass, nutrient: wm.nutrient, detritus: wm.detritus, reservoir: wm.reservoir,
      temp: pop ? tsum / pop : 0, nPhoto, nMixo, nOsmo, nPred, births: this.births, deaths,
      mSize: gsum[G.SIZE] * inv, mPhoto: gsum[G.PHOTO] * inv, mOsmo: gsum[G.OSMO] * inv, mPred: gsum[G.PRED] * inv,
      mMotil: gsum[G.MOTIL] * inv, mDef: gsum[G.DEFENSE] * inv, mTopt: gsum[G.TOPT] * inv, mMeta: gsum[G.META] * inv, mTtol: gsum[G.TTOL] * inv,
      ...this.stage3Series(),
    });
    if (this.stage3) this.detectStage3Events();
    this.births = 0;
    for (const k of Object.keys(this.deathsInterval) as DeathCause[]) this.deathsInterval[k] = 0;
    // decaimento dos fluxos tróficos
    for (const [k, v] of this.predFlow) {
      const nv = v * 0.85;
      if (nv < 0.02) this.predFlow.delete(k);
      else this.predFlow.set(k, nv);
    }
    for (let i = 0; i < this.energySrc.length; i++) this.energySrc[i] *= 0.85;
    this.detectEcologicalEvents(biomass, pop);
  }

  /** Eventos observados a partir do estado real do planeta. */
  private detectEcologicalEvents(biomass: number, pop: number): void {
    this.lastBiomass.push(biomass);
    if (this.lastBiomass.length > 16) this.lastBiomass.shift();
    const t = this.tick;
    if (this.lastBiomass.length >= 12) {
      const past = this.lastBiomass[0];
      if (past > 20) {
        const ratio = biomass / past;
        if (ratio > 1.6 && t - this.lastEventTick.bloom > 1500) {
          this.lastEventTick.bloom = t;
          this.events.add({ tick: t, type: 'bloom', title: 'Explosão populacional', text: `A biomassa global cresceu ${((ratio - 1) * 100).toFixed(0)}% em ${(12 * P.HISTORY_EVERY)} ticks, chegando a ${biomass.toFixed(0)} unidades de massa (${pop} organismos).`, magnitude: ratio });
        } else if (ratio < 0.55 && t - this.lastEventTick.crash > 1500) {
          this.lastEventTick.crash = t;
          this.events.add({ tick: t, type: 'crash', title: 'Colapso de biomassa', text: `A biomassa global caiu ${((1 - ratio) * 100).toFixed(0)}% em ${(12 * P.HISTORY_EVERY)} ticks; restam ${pop} organismos (${biomass.toFixed(0)} unidades de massa).`, magnitude: ratio });
        }
      }
    }
    // dominância
    let top = 0, topN = 0;
    for (const s of this.species.list) if (s.extinctTick < 0 && s.count > topN) { top = s.id; topN = s.count; }
    if (top && top !== this.topSpecies && pop > 200 && topN > pop * 0.4) {
      const sp = this.species.get(top);
      this.events.add({ tick: t, type: 'dominance', title: `Dominância: ${sp.name}`, text: `${sp.name} agora representa ${((topN / pop) * 100).toFixed(0)}% da população (${topN} indivíduos).`, speciesId: top, magnitude: topN });
      this.topSpecies = top;
    }
    // extinção em massa observada
    this.extinctionsInWindow = this.extinctionsInWindow.filter((e) => t - e < 400);
    if (this.extinctionsInWindow.length >= 5 && this.species.aliveCount() >= 1) {
      this.extinctionsInWindow = [];
      this.events.add({ tick: t, type: 'mass_extinction', title: 'Onda de extinções', text: 'Ao menos cinco espécies desapareceram em curto intervalo: o ecossistema perdeu boa parte de sua diversidade.' });
    }
  }

  exportInternal() {
    return {
      lastBiomass: this.lastBiomass, lastEventTick: this.lastEventTick, topSpecies: this.topSpecies,
      extinctionsInWindow: this.extinctionsInWindow, lastBiomeEvent: this.lastBiomeEvent,
    };
  }
  importInternal(d: any): void {
    this.lastBiomass = d.lastBiomass;
    this.lastEventTick = d.lastEventTick;
    this.topSpecies = d.topSpecies;
    this.extinctionsInWindow = d.extinctionsInWindow;
    this.lastBiomeEvent = d.lastBiomeEvent ?? -9999;
  }

  // ------------------------------------------------------------------ consultas

  /** Soma total de massa do sistema (deve ser constante). */
  totalMass(): number {
    const wm = this.planet.totalMass();
    let org = 0;
    for (let i = 0; i < this.pool.used; i++) if (this.pool.alive[i]) org += this.pool.mass[i];
    return wm.nutrient + wm.detritus + wm.reservoir + org + (this.flora ? this.flora.totalMass() : 0);
  }

  massBreakdown() {
    const wm = this.planet.totalMass();
    let org = 0;
    for (let i = 0; i < this.pool.used; i++) if (this.pool.alive[i]) org += this.pool.mass[i];
    return { organisms: org, ...wm, plants: this.flora ? this.flora.totalMass() : 0 };
  }
}
