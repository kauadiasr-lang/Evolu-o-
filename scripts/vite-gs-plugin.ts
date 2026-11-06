import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

/** Informação de versão embutida no jogo (lida de versions/versions.json + git). Constantes de build, nunca da simulação. */
export interface GsInfo {
  nome: string;
  version: string;
  channel: string;
  stage: number;
  commit: string;
  buildDate: string;
  title: string;
}

const git = (cmd: string): string => {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
};

export function gsInfo(): GsInfo {
  const reg = JSON.parse(readFileSync('versions/versions.json', 'utf8'));
  const id = process.env.GS_VERSION || reg.current;
  const v = reg.versions.find((x: { id: string }) => x.id === id) ?? { id, channel: 'dev', stage: 0, title: 'build local' };
  const sha = process.env.GS_COMMIT || process.env.GITHUB_SHA?.slice(0, 7) || git('git rev-parse --short HEAD') || 'local';
  const dirty = !process.env.GITHUB_SHA && !process.env.GS_COMMIT && git('git status --porcelain') ? '+local' : '';
  return {
    nome: reg.produto,
    version: v.id,
    channel: process.env.GS_CHANNEL || v.channel,
    stage: v.stage,
    commit: sha + dirty,
    // data do commit (builds do mesmo commit saem idênticas e não geram aviso de atualização à toa); árvore suja usa agora
    buildDate: (!dirty && (process.env.GS_BUILD_DATE || git('git log -1 --format=%cI'))) || new Date().toISOString(),
    title: v.title,
  };
}

function walk(dir: string, root = dir): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p, root));
    else out.push(relative(root, p).split('\\').join('/'));
  }
  return out;
}

/** Gera dist/sw.js com a lista EXATA de arquivos da build e um id de build derivado do conteúdo (muda se qualquer arquivo mudar). */
export function gsPwa(info: GsInfo): Plugin {
  let outDir = 'dist';
  return {
    name: 'gs-pwa',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    closeBundle() {
      const files = walk(outDir).filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort();
      const h = createHash('sha256');
      for (const f of files) { h.update(f); h.update(readFileSync(join(outDir, f))); }
      const build = h.digest('hex').slice(0, 12);
      const tpl = readFileSync('scripts/sw.template.js', 'utf8');
      const sw = tpl
        .replace('__GS_VERSION__', info.version)
        .replace('__GS_BUILD__', build)
        .replace('__GS_ASSETS__', JSON.stringify(['./', ...files], null, 1));
      writeFileSync(join(outDir, 'sw.js'), sw);
      writeFileSync(join(outDir, 'gs-build.json'), JSON.stringify({ ...info, build, arquivos: files.length }, null, 1));
    },
  };
}
