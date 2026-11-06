// Servidor estático mínimo para testar o site montado como se estivesse na hospedagem (inclusive sob um subcaminho).
//   node scripts/serve-site.mjs [diretório=site-dist] [--port 4180] [--prefix /Evolu-o-]
// Imita o GitHub Pages: cabeçalho Cache-Control: max-age=600, 404.html para o que não existe.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const argDir = resolve(args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || 'site-dist');
const argPort = Number(opt('port', 4180));
const argPrefix = (opt('prefix', '') || '').replace(/\/$/, '');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

/** opts: { dir, port (0 = livre), prefix } — sobrescrevem os argumentos de linha de comando */
export function start(opts = {}) {
  const dir = opts.dir ? resolve(opts.dir) : argDir;
  const port = opts.port ?? argPort;
  const prefix = (opts.prefix ?? argPrefix).replace(/\/$/, '');
  return new Promise((res) => {
    const srv = createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (prefix) { if (p === prefix) { rsp.writeHead(301, { Location: prefix + '/' }); return rsp.end(); } if (!p.startsWith(prefix + '/')) p = '/__fora__'; else p = p.slice(prefix.length); }
      let f = normalize(join(dir, p));
      if (!f.startsWith(dir)) { rsp.writeHead(403); return rsp.end(); }
      if (existsSync(f) && statSync(f).isDirectory()) {
        if (!p.endsWith('/')) { rsp.writeHead(301, { Location: prefix + p + '/' }); return rsp.end(); }
        f = join(f, 'index.html');
      }
      if (!existsSync(f)) { const nf = join(dir, '404.html'); rsp.writeHead(404, { 'content-type': MIME['.html'] }); return rsp.end(existsSync(nf) ? readFileSync(nf) : 'não encontrado'); }
      rsp.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=600', 'access-control-allow-origin': '*' });
      rsp.end(readFileSync(f));
    });
    srv.listen(port, '127.0.0.1', () => res({ srv, port: srv.address().port, url: `http://127.0.0.1:${srv.address().port}${prefix}/` }));
  });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await start();
  console.log(`servindo ${dir} em ${url}`);
}
