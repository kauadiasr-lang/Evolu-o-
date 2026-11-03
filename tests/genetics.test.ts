import { describe, expect, it } from 'vitest';
import { BASE_GENES, DEFAULT_MUTATION, G, GENE_COUNT, geneDistance, inherit, mutationRate, protocellGenome } from '../src/core/genome';
import { Rng } from '../src/core/rng';
import { T, TR, deriveTraits } from '../src/core/traits';
import { genome } from './helpers';

describe('RNG', () => {
  it('é determinístico e serializável', () => {
    const a = new Rng(42), b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    const s = a.state;
    const x = a.next();
    const c = new Rng(1);
    c.state = s;
    expect(c.next()).toBe(x);
  });
});

describe('hereditariedade e mutação', () => {
  it('sem mutação o filho é cópia exata do genoma do pai', () => {
    const rng = new Rng(1);
    const p = genome();
    const c = new Float32Array(GENE_COUNT);
    const mp = { ...DEFAULT_MUTATION, baseRate: 0, rateRange: 0 };
    expect(inherit(p, 0, c, 0, rng, mp)).toBe(0);
    expect(Array.from(c)).toEqual(Array.from(p));
  });

  it('mutações são graduais, limitadas a [0,1] e raramente grandes', () => {
    const rng = new Rng(2);
    const p = genome({ MUT: 1 });
    const c = new Float32Array(GENE_COUNT);
    let changed = 0, big = 0, total = 0, sumAbs = 0;
    for (let n = 0; n < 4000; n++) {
      changed += inherit(p, 0, c, 0, rng);
      for (let i = 0; i < GENE_COUNT; i++) {
        expect(c[i]).toBeGreaterThanOrEqual(0);
        expect(c[i]).toBeLessThanOrEqual(1);
        const d = Math.abs(c[i] - p[i]);
        if (d > 0) { total++; sumAbs += d; if (d > 0.2) big++; }
      }
    }
    expect(changed).toBeGreaterThan(0);
    expect(sumAbs / total).toBeLessThan(0.08); // pequenas em média
    expect(big / total).toBeLessThan(0.05); // grandes são raras
    // taxa observada ≈ taxa esperada
    const expected = mutationRate(1) * BASE_GENES * 4000; // só os genes clássicos mutam com o RNG principal
    expect(Math.abs(changed - expected) / expected).toBeLessThan(0.1);
  });

  it('distância genética é simétrica, nula para iguais e cresce com a divergência', () => {
    const a = genome(), b = genome({ PRED: 0.9, SIZE: 0.9 });
    expect(geneDistance(a, 0, a, 0)).toBe(0);
    expect(geneDistance(a, 0, b, 0)).toBeCloseTo(geneDistance(b, 0, a, 0), 10);
    expect(geneDistance(a, 0, b, 0)).toBeGreaterThan(0.03);
  });
});

describe('adaptações têm custos', () => {
  const tr = (g: Float32Array) => {
    const o = new Float32Array(TR);
    deriveTraits(g, 0, o, 0);
    return o;
  };
  const base = genome({ PHOTO: 0, OSMO: 0, PRED: 0, MOTIL: 0, SENSE: 0, TTOL: 0, DEFENSE: 0, AFFIN: 0, LONGEV: 0, SPIKE: 0, FLAG: 0 });

  it.each(['PHOTO', 'OSMO', 'PRED', 'MOTIL', 'SENSE', 'TTOL', 'DEFENSE', 'AFFIN', 'LONGEV'] as const)('gene %s aumenta o custo de manutenção', (k) => {
    const g = new Float32Array(base);
    g[G[k]] = 1;
    expect(tr(g)[T.COST_MULT]).toBeGreaterThan(tr(base)[T.COST_MULT]);
  });

  it('corpo grande: exige mais massa para reproduzir e é mais lento', () => {
    const small = tr(genome({ SIZE: 0.1, MOTIL: 0.5 })), big = tr(genome({ SIZE: 0.95, MOTIL: 0.5 }));
    expect(big[T.MASS_REPRO]).toBeGreaterThan(small[T.MASS_REPRO] * 3);
    expect(big[T.SPEED]).toBeLessThan(small[T.SPEED]);
  });

  it('defesa reduz velocidade (carapaça pesa)', () => {
    expect(tr(genome({ DEFENSE: 1, MOTIL: 0.6 }))[T.SPEED]).toBeLessThan(tr(genome({ DEFENSE: 0, MOTIL: 0.6 }))[T.SPEED]);
  });

  it('o genoma primordial é viável: variações pequenas permanecem em [0,1]', () => {
    const rng = new Rng(5);
    const g = new Float32Array(GENE_COUNT);
    for (let i = 0; i < 100; i++) {
      protocellGenome(rng, g, 0);
      for (const v of g) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
  });
});
