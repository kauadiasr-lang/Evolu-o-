import { describe, expect, it } from 'vitest';
import { ARCHETYPES, ArchetypeKind, archetypeGenome } from '../src/core/archetypes';
import { BASE_GENES, DEFAULT_MUTATION, G, GENE_COUNT, inherit, protocellGenome } from '../src/core/genome';
import { camoMatch, bodyHueDeg, develop } from '../src/core/phenotype';
import { Rng } from '../src/core/rng';
import { VIS, V, visFromGenes } from '../src/core/snapshot';
import { T, TR, deriveTraits } from '../src/core/traits';
import { cells, genome, stage3Sim } from './helpers';

const traits = (g: Float32Array, stage3 = true) => {
  const o = new Float32Array(TR);
  deriveTraits(g, 0, o, 0, stage3);
  return o;
};
const vis = (g: Float32Array) => {
  const o = new Uint8Array(VIS);
  visFromGenes(g, 0, o, 0);
  return o;
};
const mk = (over: Partial<Record<keyof typeof G, number>>) => genome({ PHOTO: 0.4, OSMO: 0.4, PRED: 0, ...over }, 3);

describe('fenótipo: estruturas só se expressam com os pré-requisitos', () => {
  it('membros exigem motilidade e tamanho; sem eles o gene fica críptico (sem efeito visual nem custo)', () => {
    const cryptic = mk({ LIMBS: 0.8, LIMBLEN: 0.6, MOTIL: 0.05, SIZE: 0.1 });
    expect(develop(cryptic, 0).limbs).toBe(0);
    expect(vis(cryptic)[V.LIMBS]).toBe(0);
    const base = mk({ LIMBS: 0, LIMBLEN: 0, MOTIL: 0.05, SIZE: 0.1 });
    expect(traits(cryptic)[T.COST_MULT]).toBeCloseTo(traits(base)[T.COST_MULT], 10);
    const expressed = mk({ LIMBS: 0.8, LIMBLEN: 0.6, MOTIL: 0.5, SIZE: 0.4 });
    expect(develop(expressed, 0).limbs).toBeGreaterThanOrEqual(3);
    expect(vis(expressed)[V.LIMBS]).toBeGreaterThan(100);
    expect(traits(expressed)[T.COST_MULT]).toBeGreaterThan(traits(mk({ LIMBS: 0, MOTIL: 0.5, SIZE: 0.4 }))[T.COST_MULT]);
  });

  it('escalada e adaptação terrestre exigem membros; segmentos exigem corpo alongado; olhos exigem quimiotaxia', () => {
    expect(develop(mk({ CLIMB: 0.9, TERR: 0.9, MOTIL: 0.5, SIZE: 0.4, LIMBS: 0 }), 0).climb).toBe(0);
    expect(develop(mk({ CLIMB: 0.9, TERR: 0.9, MOTIL: 0.5, SIZE: 0.4, LIMBS: 0 }), 0).terr).toBe(0);
    const legs = develop(mk({ CLIMB: 0.9, TERR: 0.9, MOTIL: 0.5, SIZE: 0.4, LIMBS: 0.6, LIMBLEN: 0.7 }), 0);
    expect(legs.climb).toBeGreaterThan(0);
    expect(legs.terr).toBeGreaterThan(0);
    expect(develop(mk({ SEGM: 0.9, ELONG: 0.02, SIZE: 0.4 }), 0).segments).toBe(0);
    expect(develop(mk({ SEGM: 0.9, ELONG: 0.5, SIZE: 0.4 }), 0).segments).toBeGreaterThanOrEqual(2);
    expect(develop(mk({ EYES: 0.9, SENSE: 0.05 }), 0).eyes).toBe(0);
    expect(develop(mk({ EYES: 0.9, SENSE: 0.5 }), 0).eyes).toBeGreaterThan(0);
  });

  it('simetria define o plano corporal: radial não tem segmentos nem cabeça', () => {
    const radial = develop(mk({ SYMM: 0.9, SEGM: 0.9, ELONG: 0.5, SIZE: 0.4, LIMBS: 0.7, MOTIL: 0.5, EYES: 0.9, SENSE: 0.5, HEAD: 0.9 }), 0);
    expect(radial.plan).toBe('radial');
    expect(radial.segments).toBe(0);
    expect(radial.head).toBe(0);
    expect(develop(mk({ SYMM: 0.5, SEGM: 0.9, ELONG: 0.5, SIZE: 0.4 }), 0).plan).toBe('segmentado');
    expect(develop(mk({ SYMM: 0.1, LIMBS: 0.7, MOTIL: 0.5, SIZE: 0.4 }), 0).plan).toBe('assimétrico');
    expect(develop(mk({ LIMBS: 0, FINS: 0, TAIL: 0, SEGM: 0, EYES: 0 }), 0).plan).toBe('unicelular');
  });
});

describe('custos e benefícios das estruturas (coerentes com o motor)', () => {
  it('cada estrutura expressa aumenta a manutenção', () => {
    const base = mk({ MOTIL: 0.5, SIZE: 0.4, SENSE: 0.5, ELONG: 0.4 });
    const c0 = traits(base)[T.COST_MULT];
    for (const over of [{ FINS: 0.8 }, { EYES: 0.9 }, { TAIL: 0.8 }, { SEGM: 0.8 }, { ANTENNA: 0.8 }, { CAMO: 0.8 }, { LIMBS: 0.8, LIMBLEN: 0.6 }] as Partial<Record<keyof typeof G, number>>[]) {
      const g = new Float32Array(base);
      for (const [k, v] of Object.entries(over)) g[G[k as keyof typeof G]] = v as number;
      expect(traits(g)[T.COST_MULT], JSON.stringify(over)).toBeGreaterThan(c0);
    }
  });

  it('nadadeiras, cauda e segmentos aceleram a natação (benefício) e membros dão mobilidade em terra', () => {
    const base = mk({ MOTIL: 0.5, SIZE: 0.3, ELONG: 0.5 });
    const s0 = traits(base)[T.SPEED];
    expect(traits(mk({ MOTIL: 0.5, SIZE: 0.3, ELONG: 0.5, FINS: 0.8 }))[T.SPEED]).toBeGreaterThan(s0);
    expect(traits(mk({ MOTIL: 0.5, SIZE: 0.3, ELONG: 0.5, TAIL: 0.8 }))[T.SPEED]).toBeGreaterThan(s0);
    expect(traits(mk({ MOTIL: 0.5, SIZE: 0.3, ELONG: 0.5, SEGM: 0.8 }))[T.SPEED]).toBeGreaterThan(s0);
    expect(traits(base)[T.LSPEED]).toBe(0); // sem membros não anda em terra
    expect(traits(mk({ MOTIL: 0.5, SIZE: 0.3, LIMBS: 0.7, LIMBLEN: 0.6 }))[T.LSPEED]).toBeGreaterThan(0);
  });

  it('escalador alcança plantas mais altas que quem não tem garras (alcance)', () => {
    const walker = traits(mk({ MOTIL: 0.5, SIZE: 0.35, LIMBS: 0.6, LIMBLEN: 0.7, TERR: 0.6 }));
    const climber = traits(mk({ MOTIL: 0.5, SIZE: 0.35, LIMBS: 0.6, LIMBLEN: 0.7, TERR: 0.6, CLIMB: 0.9 }));
    expect(climber[T.REACH]).toBeGreaterThan(walker[T.REACH] * 1.5);
  });

  it('com stage3 desligado nenhuma estrutura é aplicada (física da Etapa 1 intacta)', () => {
    const g = mk({ MOTIL: 0.5, SIZE: 0.4, FINS: 0.9, LIMBS: 0.8, EYES: 0.9, SENSE: 0.5 });
    const off = traits(g, false), plain = traits(mk({ MOTIL: 0.5, SIZE: 0.4, SENSE: 0.5 }), false);
    expect(off[T.COST_MULT]).toBeCloseTo(plain[T.COST_MULT], 10);
    expect(off[T.SPEED]).toBeCloseTo(plain[T.SPEED], 10);
    for (let k = T.SEG; k <= T.REACH; k++) expect(off[k]).toBe(0);
  });

  it('camuflagem: casamento de matiz com o substrato (0..1) e custo de pigmentação', () => {
    const hue = bodyHueDeg(0.55, 0, 0, 0);
    expect(camoMatch(hue, hue)).toBe(1);
    expect(camoMatch(hue, hue + 90)).toBe(0);
    expect(traits(mk({ CAMO: 0.9 }))[T.COST_MULT]).toBeGreaterThan(traits(mk({ CAMO: 0 }))[T.COST_MULT]);
  });
});

describe('hereditariedade e mutação das características visuais', () => {
  const NO_MUT = { ...DEFAULT_MUTATION, baseRate: 0, rateRange: 0 };

  it('sem mutação o filho tem exatamente o mesmo fenótipo (e a mesma aparência) do pai', () => {
    const rng = new Rng(1), mrng = new Rng(2);
    for (const kind of Object.keys(ARCHETYPES) as ArchetypeKind[]) {
      const p = new Float32Array(GENE_COUNT);
      archetypeGenome(kind, rng, mrng, p, 0);
      const c = new Float32Array(GENE_COUNT);
      inherit(p, 0, c, 0, rng, NO_MUT, mrng);
      expect(Array.from(c)).toEqual(Array.from(p));
      expect(Array.from(vis(c))).toEqual(Array.from(vis(p)));
    }
  });

  it('mutações dos genes morfológicos alteram a aparência dos descendentes, de forma gradual', () => {
    const rng = new Rng(3), mrng = new Rng(4);
    const p = new Float32Array(GENE_COUNT);
    archetypeGenome('swimmer', rng, mrng, p, 0);
    p[G.MUT] = 1;
    const c = new Float32Array(GENE_COUNT);
    let changedVisual = 0, bigJumps = 0, total = 0;
    const v0 = vis(p);
    for (let n = 0; n < 400; n++) {
      inherit(p, 0, c, 0, rng, DEFAULT_MUTATION, mrng);
      const v1 = vis(c);
      let diff = 0;
      for (let k = V.SEGM; k <= V.HEAD; k++) diff += Math.abs(v1[k] - v0[k]);
      if (diff > 0) changedVisual++;
      for (let i = BASE_GENES; i < GENE_COUNT; i++) {
        const d = Math.abs(c[i] - p[i]);
        if (d > 0) { total++; if (d > 0.3) bigJumps++; }
        expect(c[i]).toBeGreaterThanOrEqual(0);
        expect(c[i]).toBeLessThanOrEqual(1);
      }
    }
    expect(changedVisual).toBeGreaterThan(40); // há descendentes visivelmente diferentes
    expect(changedVisual).toBeLessThan(400); // mas nem todos: a maioria dos filhos é parecida com o pai
    expect(bigJumps / total).toBeLessThan(0.08); // mudanças grandes são raras
  });

  it('o fluxo de RNG morfológico é independente: os genes clássicos mutam igual com ou sem ele', () => {
    const p = genome({ MUT: 0.8 }, 5);
    const a = new Float32Array(GENE_COUNT), b = new Float32Array(GENE_COUNT);
    inherit(p, 0, a, 0, new Rng(9), DEFAULT_MUTATION);
    inherit(p, 0, b, 0, new Rng(9), DEFAULT_MUTATION, new Rng(77));
    for (let i = 0; i < BASE_GENES; i++) expect(a[i]).toBe(b[i]);
  });

  it('uma mutação pode criar uma estrutura nova quando o pré-requisito já existe (membros)', () => {
    const p = mk({ MOTIL: 0.5, SIZE: 0.4, LIMBS: 0.12, LIMBLEN: 0.5, MUT: 1 });
    expect(develop(p, 0).limbs).toBe(0);
    const rng = new Rng(11), mrng = new Rng(12), c = new Float32Array(GENE_COUNT);
    let gained = 0;
    for (let n = 0; n < 600; n++) {
      inherit(p, 0, c, 0, rng, DEFAULT_MUTATION, mrng);
      if (develop(c, 0).limbs > 0) gained++;
    }
    expect(gained).toBeGreaterThan(0);
  });
});

describe('consistência visual dentro da espécie e diferença entre espécies', () => {
  it('indivíduos da mesma linhagem são reconhecíveis (variação pequena); linhagens distintas diferem muito', () => {
    const rng = new Rng(21), mrng = new Rng(22);
    const sample = (kind: ArchetypeKind, n: number) =>
      Array.from({ length: n }, () => {
        const g = new Float32Array(GENE_COUNT);
        archetypeGenome(kind, rng, mrng, g, 0);
        return vis(g);
      });
    const dist = (a: Uint8Array, b: Uint8Array) => {
      let s = 0;
      for (let k = 0; k < VIS - 1; k++) s += (a[k] - b[k]) ** 2;
      return Math.sqrt(s / (VIS - 1));
    };
    const kinds = Object.keys(ARCHETYPES) as ArchetypeKind[];
    const groups = kinds.map((k) => sample(k, 12));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const intra = mean(groups.flatMap((g) => g.flatMap((a, i) => g.slice(i + 1).map((b) => dist(a, b)))));
    const inter: number[] = [];
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) inter.push(dist(groups[i][0], groups[j][0]));
    expect(intra).toBeLessThan(15); // variação individual pequena (σ=0,02 por gene)
    expect(mean(inter)).toBeGreaterThan(intra * 3); // espécies com planos corporais diferentes
    // planos corporais realmente distintos (não só cor)
    const plans = new Set(kinds.map((k) => { const g = new Float32Array(GENE_COUNT); archetypeGenome(k, rng, mrng, g, 0); return develop(g, 0).plan; }));
    expect(plans.size).toBeGreaterThanOrEqual(3);
  });

  it('os arquétipos expressam as estruturas prometidas', () => {
    const rng = new Rng(31), mrng = new Rng(32);
    const get = (k: ArchetypeKind) => { const g = new Float32Array(GENE_COUNT); archetypeGenome(k, rng, mrng, g, 0); return develop(g, 0); };
    expect(get('swimmer').fins).toBeGreaterThan(0);
    expect(get('swimmer').segments).toBeGreaterThanOrEqual(2);
    expect(get('amphibian').limbs).toBeGreaterThan(0);
    expect(get('amphibian').terr).toBeGreaterThan(0);
    expect(get('climber').climb).toBeGreaterThan(0);
    expect(get('camouflaged').camo).toBeGreaterThan(0.5);
    expect(get('radial').plan).toBe('radial');
    expect(get('armored').segments).toBeGreaterThanOrEqual(2);
  });
});

describe('ecologia das estruturas no motor (Etapa 3)', () => {
  const NO_MUT = { ...DEFAULT_MUTATION, baseRate: 0, rateRange: 0 };

  it('camuflagem casada com o fundo reduz a predação (benefício real, ligado ao substrato)', () => {
    const run = (camoHue: number) => {
      const sim = stage3Sim({ mutation: NO_MUT, initialPopulation: 0, seed: 5 });
      const { water, w } = cells(sim);
      const x = (water % w) + 0.5, y = ((water / w) | 0) + 0.5;
      const bg = sim.planet.bgHue[water];
      sim.planet.nutrient[water] += 400;
      sim.planet.reservoir = Math.max(0, sim.planet.reservoir - 400);
      const topt = (sim.planet.temp[water] + 5) / 50;
      const pred = genome({ PRED: 0.9, SIZE: 0.4, PHOTO: 0, OSMO: 0, MOTIL: 0, DEFENSE: 0, TOPT: topt, TTOL: 0.6 }, 6);
      const rng = new Rng(1);
      void rng;
      const mkPrey = (camo: number, hue: number) => genome({ PRED: 0, SIZE: 0.04, PHOTO: 0.3, OSMO: 0, DEFENSE: 0, MOTIL: 0, CAMO: camo, HUE: hue, TOPT: topt, TTOL: 0.6 }, 7);
      const camoPrey = mkPrey(0.9, camoHue / 360), plain = mkPrey(0, bg / 360);
      const sA = sim.species.create(null, camoPrey, 0, 0, sim.rng, 'camuflada').id;
      const sB = sim.species.create(null, plain, 0, 0, sim.rng, 'simples').id;
      const sP = sim.species.create(null, pred, 0, 0, sim.rng, 'predador').id;
      for (let k = 0; k < 40; k++) { sim.addOrganism(camoPrey, 0, x, y, 0.8, 6, sA); sim.addOrganism(plain, 0, x, y, 0.8, 6, sB); }
      for (let k = 0; k < 6; k++) sim.addOrganism(pred, 0, x, y, 3, 30, sP);
      const before = [sim.species.get(sA).count, sim.species.get(sB).count];
      sim.run(25);
      return [before[0] - sim.species.get(sA).count, before[1] - sim.species.get(sB).count];
    };
    const sim0 = stage3Sim({ initialPopulation: 0, seed: 5 });
    const bg = sim0.planet.bgHue[cells(sim0).water];
    const [lostMatch, lostPlainA] = run(bg);
    expect(lostPlainA).toBeGreaterThan(0);
    expect(lostMatch).toBeLessThan(lostPlainA); // camuflada casada com o fundo perde menos
    // camuflagem com cor errada (oposta ao fundo) NÃO protege: depende do ambiente
    const [lostWrong, lostPlainB] = run(bg + 180);
    expect(lostWrong).toBeGreaterThanOrEqual(lostMatch);
    expect(lostPlainB).toBeGreaterThan(0);
  });

  it('em terra: sem adaptação terrestre a costa é barreira; com membros e integumento é possível ocupá-la', () => {
    const sim = stage3Sim({ mutation: NO_MUT, initialPopulation: 0, seed: 8 });
    const pl = sim.planet;
    // célula de água vizinha à terra
    let shore = -1;
    for (let i = 1; i < pl.n - 1 && shore < 0; i++) if (!pl.land[i] && pl.land[i + 1] && pl.depth[i] < 0.5 && (i % pl.w) > 2 && (i % pl.w) < pl.w - 3) shore = i;
    expect(shore).toBeGreaterThan(0);
    const x = (shore % pl.w) + 0.9, y = ((shore / pl.w) | 0) + 0.5;
    pl.nutrient[shore] += 300;
    const swimmer = genome({ MOTIL: 0.9, SIZE: 0.2, SENSE: 0.1, PHOTO: 0.6, OSMO: 0.2, PRED: 0 }, 9);
    const walker = genome({ MOTIL: 0.9, SIZE: 0.3, SENSE: 0.1, PHOTO: 0.6, OSMO: 0.2, PRED: 0, LIMBS: 0.6, LIMBLEN: 0.5, TERR: 0.8 }, 10);
    const s1 = sim.species.create(null, swimmer, 0, 0, sim.rng, 'nadador').id, s2 = sim.species.create(null, walker, 0, 0, sim.rng, 'andarilho').id;
    for (let k = 0; k < 25; k++) { sim.addOrganism(swimmer, 0, x, y, 1.5, 12, s1); sim.addOrganism(walker, 0, x, y, 2, 14, s2); }
    let swimmerOnLand = 0, walkerOnLand = 0;
    for (let t = 0; t < 500; t++) {
      sim.step();
      for (let i = 0; i < sim.pool.used; i++) {
        if (!sim.pool.alive[i] || !pl.land[sim.pool.cell[i]]) continue;
        if (sim.pool.species[i] === s1) swimmerOnLand++;
        else walkerOnLand++;
      }
    }
    expect(swimmerOnLand).toBe(0);
    expect(walkerOnLand).toBeGreaterThan(0);
  });

  it('dessecação: em terra seca, quem tem integumento (TERR) gasta menos energia', () => {
    const energyAfter = (terr: number) => {
      const sim = stage3Sim({ mutation: NO_MUT, initialPopulation: 0, seed: 8 });
      const { land, w } = cells(sim);
      sim.planet.soilWater[land] = 0;
      sim.planet.nutrient[land] += 50;
      const g = genome({ MOTIL: 0.25, SIZE: 0.3, PHOTO: 0, OSMO: 0, PRED: 0, LIMBS: 0.6, LIMBLEN: 0.5, TERR: terr, META: 0.2, TOPT: (sim.planet.temp[land] + 5) / 50, TTOL: 0.8 }, 11);
      const i = sim.addOrganism(g, 0, (land % w) + 0.5, ((land / w) | 0) + 0.5, 3, 20);
      sim.run(6);
      return sim.pool.alive[i] ? sim.pool.energy[i] : -1;
    };
    expect(energyAfter(1)).toBeGreaterThan(energyAfter(0.12));
  });
});
