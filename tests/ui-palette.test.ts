import { describe, expect, it } from 'vitest';
import { speciesCss, speciesHue } from '../src/render/palette';

/** A cor de uma espécie depende SÓ do seu id (vindo do motor): estável, reproduzível e sem estado oculto. */
describe('paleta de espécies (interface)', () => {
  it('é determinística e o mesmo id sempre tem a mesma cor', () => {
    for (let id = 1; id <= 200; id++) expect(speciesCss(id)).toBe(speciesCss(id));
    expect(speciesCss(7)).toBe('hsl(' + speciesHue(7).toFixed(0) + ',82%,' + (56 + ((7 * 7) % 3) * 7) + '%)');
  });
  it('espécies com ids próximos (irmãs) ficam bem separadas no círculo cromático', () => {
    for (let id = 1; id < 200; id++) {
      const d = Math.abs(speciesHue(id + 1) - speciesHue(id));
      const circ = Math.min(d, 360 - d);
      expect(circ).toBeGreaterThan(30);
    }
  });
  it('as primeiras 24 espécies têm cores todas diferentes', () => {
    const set = new Set(Array.from({ length: 24 }, (_, i) => speciesCss(i + 1)));
    expect(set.size).toBe(24);
  });
});
