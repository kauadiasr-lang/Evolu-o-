import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

/** Integridade do sistema de versões e do PWA (Etapa 7): o registro é a fonte única e não pode ficar incoerente. */
const reg = JSON.parse(readFileSync('versions/versions.json', 'utf8'));
const CH = new Set(['stable', 'experimental', 'dev']);

describe('registro de versões (versions/versions.json)', () => {
  it('ids únicos, canais válidos, versão atual existente e ordenação da mais nova para a mais antiga', () => {
    const ids = reg.versions.map((v: any) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of reg.versions) expect(CH.has(v.channel), v.id).toBe(true);
    expect(ids).toContain(reg.current);
    const num = (s: string) => s.split('.').map(Number);
    const sorted = [...ids].sort((a, b) => { const x = num(a), y = num(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; });
    expect(ids).toEqual(sorted);
    expect(Object.keys(reg.canais).sort()).toEqual(['dev', 'experimental', 'stable']);
  });

  it('campos obrigatórios de cada versão e datas válidas', () => {
    for (const v of reg.versions) {
      for (const k of ['id', 'channel', 'date', 'stage', 'title', 'novelties', 'visual', 'evolutionary', 'ecological', 'fixes', 'knownIssues', 'tests']) expect(v, `${v.id}.${k}`).toHaveProperty(k);
      expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(v.date))).toBe(false);
      expect(v.novelties.length).toBeGreaterThan(0);
    }
  });

  it('honestidade dos canais: a versão atual não é apresentada como estável sem validação (experimental/dev) e versões estáveis não têm problema aberto de validação', () => {
    const cur = reg.versions.find((v: any) => v.id === reg.current);
    expect(cur.channel).not.toBe('stable'); // 0.7.0: sem teste em aparelho físico
    for (const v of reg.versions.filter((x: any) => x.channel === 'stable')) expect(v.knownIssues.join(' ')).not.toMatch(/n[ãa]o (foi )?(testad|valid)/i);
  });

  it('cada etapa aponta para uma versão existente e cada versão arquivada (releases/) está no registro', () => {
    const ids = new Set(reg.versions.map((v: any) => v.id));
    for (const e of reg.etapas) expect(ids.has(e.versao), `etapa ${e.n}`).toBe(true);
    for (const v of reg.versions) if (v.id !== reg.current) expect(existsSync(`releases/${v.id}/index.html`), `releases/${v.id}`).toBe(true);
    for (const v of reg.versions) if (v.commit) expect(v.commit).toMatch(/^[0-9a-f]{7,40}$/);
  });
});

describe('PWA: manifesto e service worker', () => {
  const man = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  it('manifesto: nome, modo, escopo relativo e ícones existentes com o tamanho declarado', () => {
    expect(man.name).toBe('GS Evolução');
    expect(man.display).toBe('standalone');
    expect(man.scope).toBe('./');
    expect(man.start_url.startsWith('./')).toBe(true);
    for (const i of man.icons) {
      expect(existsSync(`public/${i.src}`), i.src).toBe(true);
      if (i.src.endsWith('.png')) {
        const b = readFileSync(`public/${i.src}`);
        const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
        expect(`${w}x${h}`).toBe(i.sizes);
      }
    }
    expect(man.icons.some((i: any) => i.purpose === 'maskable')).toBe(true);
  });
  it('service worker: sem skipWaiting automático (só por mensagem do jogador) e cache atrelado à build', () => {
    const sw = readFileSync('scripts/sw.template.js', 'utf8');
    expect(sw).toContain("SKIP_WAITING");
    expect((sw.match(/skipWaiting\(\)/g) ?? []).length).toBe(1); // única chamada: dentro do tratador da mensagem
    expect(sw.indexOf('skipWaiting()')).toBeGreaterThan(sw.indexOf("addEventListener('message'"));
    expect(sw).toContain('__GS_BUILD__');
    expect(sw).toContain('__GS_ASSETS__');
  });
});
