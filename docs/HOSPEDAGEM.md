# Hospedagem e publicação (Etapa 7)

O jogo é um site **100% estático** (HTML + JS + CSS + o arquivo do Web Worker da simulação). Não há servidor próprio: o motor real roda
no navegador, dentro do Worker. Por isso qualquer hospedagem de arquivos serve; escolhemos o **GitHub Pages**.

## Por que GitHub Pages (e não Cloudflare Pages / Vercel / Netlify)
| critério | GitHub Pages | Cloudflare Pages / Vercel / Netlify |
|---|---|---|
| link público, gratuito, HTTPS (exigido pelo PWA) | sim (repositório público) | sim |
| Vite + Web Worker `type: module` + Canvas + módulos ES | sim (arquivos estáticos com MIME correto) | sim |
| onde o código já está | **no mesmo GitHub**: sem conta nova, sem token, sem segredo | exige criar conta, autorizar o GitHub e guardar credenciais |
| atualizar pelo Claude Code, sem computador | `git push` basta; o workflow publica | também, mas depende da integração externa |
| versões antigas acessíveis | commitadas em `releases/` e servidas em `/v/<id>/` | possível, mais configuração |
| custo | zero | zero (planos gratuitos) |
Verificado em 2026-11-06 (consulta ao próprio repositório): `kauadiasr-lang/Evolu-o-` é **público** e o branch padrão é
`claude/evolvere-evolution-simulator-c9qt4h`; portanto o ambiente `github-pages` já aceita publicar a partir dele. Pages ainda **não estava ligado**
(`has_pages: false`): é o único passo manual (abaixo).

## Endereço público
`https://kauadiasr-lang.github.io/Evolu-o-/` (página de versões) · `.../jogo/` (versão atual) · `.../v/0.4.0/` (versões anteriores).

## Passo único para ligar (feito uma vez, pelo celular serve)
GitHub (app ou navegador) → repositório **Evolu-o-** → **Settings** → **Pages** → *Build and deployment* → **Source: GitHub Actions**.
Depois disso todo `git push` no branch padrão publica sozinho. (Sem esse passo o job "deploy" falha com *"Ensure GitHub Pages has been enabled"*;
os testes e a montagem do site continuam rodando e nada de errado é publicado.)

## Como o site é montado (`scripts/build-site.mjs`)
```
site-dist/
  index.html, landing.css, landing.js   página inicial de versões (site/)
  versions.json                         registro público (versions/versions.json + commit/data da publicação)
  jogo/                                 build ATUAL (vite --base ./) + manifest + sw.js + gs-build.json
  v/<id>/                               versões anteriores (releases/<id>/), imutáveis
  icon*.png, icon.svg, 404.html, .nojekyll
```
* **Base relativa** (`base: './'` em `vite.config.ts`): a mesma compilação funciona na raiz, em `/Evolu-o-/jogo/` ou em `/v/0.4.0/`. O Worker é carregado por
  `new URL('../worker/sim.worker.ts', import.meta.url)` (o Vite o emite em `assets/` e resolve relativo à página).
* O endereço do proxy de IA (`/api/ai`) passou a ser relativo à página; na hospedagem estática a IA opcional simplesmente não existe (o jogo funciona sem ela).
* Sem rotas no servidor: o jogo é uma página só; os parâmetros ficam na URL (`?seed=7&size=64x40&speed=5&paused=1`).

## Workflow (`.github/workflows/pages.yml`)
Em **todo push**: `npm ci` → `tsc` → `vitest run` (suíte completa) → `build-site` → Playwright/Chromium → `site-test` (assets, Worker, URL, toque, pausa, velocidade,
reinício, grades, PWA offline, todas as versões) → `pwa-update-test` (atualização segura). **Só no branch padrão**, depois de tudo passar, envia o artefato e publica.
Nada é publicado se algum teste falhar.

## Publicar uma nova versão (receita)
1. Termine a etapa; rode `npx vitest run`, `npx tsc --noEmit`, `npm run build:site` e `node scripts/site-test.mjs`.
2. Em `versions/versions.json`: acrescente a entrada da versão (id, `channel` = `experimental` ou `dev` — **`stable` só quando você mandar promover**, data, etapa, novidades, correções, problemas conhecidos, testes), atualize `current` e `etapas`; atualize `version` em `package.json`.
3. `git commit` do código. Arquive a versão **a partir desse commit**: `node scripts/archive-release.mjs <id> <commit>` → cria `releases/<id>/` → `git add releases/<id>` e `git commit`.
4. `git push` no branch padrão. O workflow publica; confira o link e o seu celular (a página inicial mostra o commit publicado).
Promover uma versão a estável = mudar o `channel` dela em `versions/versions.json` (e o texto em `knownIssues`), nunca antes de os testes e a validação em aparelho real.

## Testar localmente como na hospedagem
```bash
npm run build:site            # monta site-dist/
npm run serve:site            # http://127.0.0.1:4180/Evolu-o-/  (mesmo subcaminho do Pages, com Cache-Control 600 s)
node scripts/site-test.mjs                          # contra o site montado
node scripts/site-test.mjs https://kauadiasr-lang.github.io/Evolu-o-/    # contra o endereço público
node scripts/pwa-update-test.mjs                    # atualização segura do PWA
```

## Resolução de problemas
| sintoma | causa provável | o que fazer |
|---|---|---|
| link dá 404 | Pages não ligado, ou o workflow ainda não terminou | Settings → Pages → Source: GitHub Actions; veja a aba Actions |
| job "deploy" vermelho: *Ensure GitHub Pages has been enabled* | passo único não feito | idem |
| job "deploy" vermelho: *branch not allowed … environment protection* | publicando de um branch que não é o padrão | Settings → Environments → github-pages → Deployment branches |
| tela preta / nada acontece | Chrome antigo sem módulos em Worker | atualizar o Chrome (≥ 100) |
| mostra versão antiga | o app instalado só troca com sua confirmação | aceite o aviso "Nova versão disponível" ou limpe os dados do site |
| "mundo salvo não carrega em versão antiga" | formato de save mais novo | abra a versão em que foi salvo; versões arquivadas compartilham o mesmo armazenamento do navegador |
