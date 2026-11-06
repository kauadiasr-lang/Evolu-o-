// Arquiva uma versão como compilação imutável em releases/<id>/ (publicada em /v/<id>/), a partir do commit indicado.
//   node scripts/archive-release.mjs <id> <commit>        ex.: node scripts/archive-release.mjs 0.4.0 68ffeb4
// - compila o commit num worktree temporário com base relativa (não altera a árvore atual);
// - versões antigas (sem informação de versão própria) recebem uma faixa "arquivo" injetada (gs-badge.js) na página.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const [id, commitArg] = process.argv.slice(2);
if (!id || !commitArg) { console.error('uso: node scripts/archive-release.mjs <id> <commit>'); process.exit(2); }
const reg = JSON.parse(readFileSync('versions/versions.json', 'utf8'));
const v = reg.versions.find((x) => x.id === id);
if (!v) { console.error(`versão ${id} não está em versions/versions.json`); process.exit(2); }
const sha = execFileSync('git', ['rev-parse', '--short', commitArg]).toString().trim();
const target = resolve('releases', id);
const wt = join(tmpdir(), `gs-archive-${id}-${Date.now()}`);
const root = resolve('.');
try {
  execFileSync('git', ['worktree', 'add', '--detach', wt, sha], { stdio: 'ignore' });
  symlinkSync(join(root, 'node_modules'), join(wt, 'node_modules'));
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  execFileSync('npx', ['vite', 'build', '--base', './', '--outDir', target, '--emptyOutDir'], { cwd: wt, stdio: 'inherit', env: { ...process.env, GS_VERSION: id, GS_COMMIT: sha, GS_CHANNEL: v.channel } });
  if (!existsSync(join(target, 'gs-build.json'))) {
    // build antiga: injeta a faixa de identificação
    const badge = readFileSync('scripts/gs-badge.template.js', 'utf8').replace('__GS_INFO__', JSON.stringify({ version: id, channel: v.channel, commit: sha, title: v.title, home: '../../' }));
    writeFileSync(join(target, 'gs-badge.js'), badge);
    const idx = join(target, 'index.html');
    writeFileSync(idx, readFileSync(idx, 'utf8').replace('</body>', '<script src="./gs-badge.js"></script>\n</body>'));
  }
  writeFileSync(join(target, 'gs-release.json'), JSON.stringify({ id, commit: sha, channel: v.channel, archivedAt: new Date().toISOString() }, null, 1));
  console.log(`arquivada v${id} (commit ${sha}) em releases/${id}/`);
} finally {
  try { execFileSync('git', ['worktree', 'remove', '--force', wt], { stdio: 'ignore' }); } catch {}
}
