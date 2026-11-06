import { GS } from './version';

/**
 * PWA: registro do service worker, aviso de nova versão e convite de instalação.
 *
 * Regras de segurança (ver docs/PWA.md):
 *  - o service worker novo NUNCA assume sozinho: fica em espera até o jogador confirmar;
 *  - antes de atualizar o jogo oferece salvar o mundo; a simulação em andamento segue na versão atual até a confirmação;
 *  - só registra em produção (o servidor de desenvolvimento não usa service worker).
 */
export interface PwaHooks {
  /** chamada quando há versão nova pronta (em espera) */
  onUpdateReady(info: { version: string; build: string }): void;
  /** o navegador permite instalar o app agora */
  onInstallAvailable(): void;
  onInstalled(): void;
  onOfflineReady(): void;
}

let reg: ServiceWorkerRegistration | null = null;
let applying = false;
let deferredInstall: any = null;
let waitingInfo: { version: string; build: string } | null = null;

export const pwaState = {
  supported: 'serviceWorker' in navigator,
  registered: false,
  controlled: false,
  get standalone() {
    return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || (navigator as any).standalone === true;
  },
  get canInstall() { return !!deferredInstall; },
  get updateWaiting() { return !!waitingInfo; },
  get waitingInfo() { return waitingInfo; },
};

export function initPwa(h: PwaHooks): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    h.onInstallAvailable();
  });
  window.addEventListener('appinstalled', () => { deferredInstall = null; h.onInstalled(); });
  if (!pwaState.supported || !import.meta.env.PROD) return;

  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'VERSION') { waitingInfo = { version: e.data.version, build: e.data.build }; h.onUpdateReady(waitingInfo); }
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    pwaState.controlled = true;
    if (applying) location.reload(); // só recarrega depois de o jogador confirmar
  });

  const announce = (w: ServiceWorker) => {
    // há versão nova em espera: pergunta a versão dela e avisa (não ativa)
    waitingInfo = { version: '?', build: '?' };
    w.postMessage({ type: 'GET_VERSION' });
    h.onUpdateReady(waitingInfo);
  };
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((r) => {
    reg = r;
    pwaState.registered = true;
    pwaState.controlled = !!navigator.serviceWorker.controller;
    if (r.waiting && navigator.serviceWorker.controller) announce(r.waiting);
    r.addEventListener('updatefound', () => {
      const w = r.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed') {
          if (navigator.serviceWorker.controller) announce(w); // atualização
          else h.onOfflineReady(); // primeira instalação: o jogo já funciona offline
        }
      });
    });
    // procura versão nova ao voltar para o app e a cada 30 min
    const check = () => r.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
}

/** Ativa a versão em espera e recarrega. Chame só depois da confirmação do jogador (e de salvar, se ele quis). */
export function applyUpdate(): void {
  if (!reg?.waiting) { location.reload(); return; }
  applying = true;
  reg.waiting.postMessage({ type: 'SKIP_WAITING' });
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredInstall) return 'unavailable';
  deferredInstall.prompt();
  const r = await deferredInstall.userChoice;
  deferredInstall = null;
  return r.outcome;
}

export async function cacheNames(): Promise<string[]> {
  try { return (await caches.keys()).filter((k) => k.startsWith('gs-evolucao::')); } catch { return []; }
}
export const buildInfoLine = () => `${GS.nome} v${GS.version} (${GS.channel}) · commit ${GS.commit} · ${GS.buildDate}`;
