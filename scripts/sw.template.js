/* GS Evolução — service worker (gerado no build por scripts/vite-gs-plugin.ts; NÃO editar o arquivo gerado).
 *
 * Garantias:
 *  1. Todos os arquivos de UMA build são guardados juntos num cache com o id da build; a página e o Worker da simulação
 *     vêm sempre do mesmo cache ⇒ nunca há mistura de versões.
 *  2. Uma build nova NÃO assume o controle sozinha: fica "em espera" até o jogador confirmar (mensagem SKIP_WAITING).
 *     Assim uma simulação em andamento nunca é interrompida sem aviso.
 *  3. O escopo é o diretório deste arquivo; caches de outros escopos (outras versões hospedadas) nunca são apagados aqui.
 */
const VERSION = '__GS_VERSION__';
const BUILD = '__GS_BUILD__';
const SCOPE = self.registration.scope;
const PREFIX = 'gs-evolucao::' + SCOPE + '::';
const CACHE = PREFIX + BUILD;
const ASSETS = __GS_ASSETS__;
const INDEX = new URL('index.html', SCOPE).href;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(new URL(u, SCOPE).href, { cache: 'reload' })))),
  );
  // sem skipWaiting aqui, de propósito (garantia 2)
});

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  else if (d.type === 'GET_VERSION' && e.source) e.source.postMessage({ type: 'VERSION', version: VERSION, build: BUILD });
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.href.startsWith(SCOPE)) return;
  if (req.mode === 'navigate') {
    // a "casca" do app é o index.html desta build, ignorando ?seed=…&speed=… (parâmetros do jogo)
    e.respondWith(caches.open(CACHE).then((c) => c.match(INDEX)).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.open(CACHE).then((c) => c.match(req)).then((r) => r || fetch(req)));
});
