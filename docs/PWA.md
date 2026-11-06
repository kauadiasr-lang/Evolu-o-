# PWA e acesso pelo Android (Etapa 7)

## Usar no Android (passo a passo)
1. No **Chrome** abra `https://kauadiasr-lang.github.io/Evolu-o-/` e toque em **▶ Abrir o jogo**. Nada para instalar.
2. (Opcional) **⋮ → Instalar app** (ou *Adicionar à tela inicial*). O ícone "GS Evolução" aparece na tela inicial e abre **em tela cheia**, sem barra do navegador.
   Dentro do jogo também há **⋯ → Instalar app** quando o Chrome oferece a instalação.
3. Depois da primeira visita completa o jogo **abre sem internet** (arquivos e Worker ficam no aparelho).
4. Para ver a versão: **⋯ → Sobre / versão** ou a faixa no canto do mapa.

## Como funciona
* `public/manifest.webmanifest`: nome **GS Evolução**, `display: standalone` (com `fullscreen` como preferência), escopo e `start_url` relativos, ícones 192/512, *maskable* 512 e SVG.
  Os PNG são gerados de `public/icon.svg` por `npm run icons`.
* `sw.js` é **gerado no build** (`scripts/vite-gs-plugin.ts` + `scripts/sw.template.js`) com a lista exata dos arquivos da build e um **id de build derivado do conteúdo**.
* Escopo do service worker = a pasta do jogo (`/jogo/`, `/v/0.7.0/`…): cada versão hospedada tem o seu, sem interferir nas outras. A página inicial **não** usa service worker.

## Garantias de segurança do cache e da atualização
| risco | proteção |
|---|---|
| mistura de arquivos de versões diferentes | todos os arquivos de uma build entram **juntos** num cache `gs-evolucao::<escopo>::<id-da-build>`; a página (`index.html`) e o Worker vêm sempre desse mesmo cache |
| versão antiga sem aviso | o navegador procura `sw.js` novo a cada abertura, ao voltar para o app e a cada 30 min (`updateViaCache: 'none'`); quando há build nova aparece o aviso **"Nova versão disponível: vX"** |
| atualização que interrompe a simulação | o service worker novo **não** se ativa sozinho (sem `skipWaiting` automático): fica em espera. O jogador escolhe **Salvar mundo e atualizar**, **Atualizar** ou **Depois**; recarregar a página também **não** troca de versão |
| perder o mundo | "Salvar mundo e atualizar" grava o mundo (IndexedDB) antes; depois é só **Carregar** |
| cache velho acumulando | ao ativar a build nova, os caches de builds antigas **do mesmo escopo** são apagados |
| arquivos incompatíveis | o id da build muda se qualquer arquivo mudar; navegações usam o `index.html` da build ativa e ignoram `?seed=…` (parâmetros do jogo) |
Verificado por `scripts/pwa-update-test.mjs` (13 verificações: o servidor deixa de ter os arquivos de A e A continua íntegra pelo cache; a simulação não é interrompida; "Depois" e recarregar não trocam; "Salvar e atualizar" grava e troca; cache de A apagado).

## Desenvolvimento
O service worker só é registrado em produção (`import.meta.env.PROD`); `npm run dev` não usa cache.
## Limitações
* Instalação e tela cheia **testadas em emulação** (Chromium/Playwright: manifesto válido, nenhum erro de instalabilidade, service worker ativo, offline); **não** testadas em Chrome Android físico.
* iOS/Safari: o jogo abre, mas o convite de instalação e o "tela cheia" seguem regras próprias (Compartilhar → Adicionar à Tela de Início).
* Não há sincronização de saves entre aparelhos.
