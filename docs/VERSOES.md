# Sistema de versões (Etapa 7)

Fonte única da verdade: **`versions/versions.json`**. Dele saem a página inicial, o histórico, a identificação dentro do jogo e o registro público `versions.json`.

## Canais (nunca misturados)
| canal | significado | quando usar |
|---|---|---|
| **stable** (estável) | validada pela suíte da etapa, sem ressalvas científicas abertas que afetem o uso | só por promoção explícita do dono do projeto |
| **experimental** | funciona e foi testada, mas tem ressalvas documentadas (validação só em emulação, mecanismos não comprovados…) | padrão para versões novas |
| **dev** (desenvolvimento) | build intermediária; pode quebrar | trabalho em andamento |
A versão atual (0.7.0) é **experimental**: não foi validada em aparelho Android físico.

## O que cada versão registra
`id`, `channel`, `date`, `stage`, `commit` (da etapa), `title`, `novelties`, `visual`, `evolutionary`, `ecological`, `fixes`, `knownIssues`, `tests`.
`etapas[]` lista as etapas do projeto e a versão que as concluiu.

## Onde a versão aparece
* **Dentro do jogo**: faixa no HUD (`GS Evolução v0.7.0 · experimental`) e **⋯ → Sobre / versão** (versão, canal, etapa, commit, data da compilação, modo app/navegador, estado offline e de atualização, link para a página de versões).
  Esses dados são **constantes de build** (`__GS__`, definidas no Vite a partir do registro e do git); nunca vêm da simulação.
* **Páginas arquivadas (v0.1.0–v0.6.0)**: compilações dos commits antigos (o motor daquela época, sem alterações). Elas não têm informação de versão própria, então o arquivamento injeta uma faixa
  `GS Evolução vX · canal · arquivo (commit …) ↩ versões` (`scripts/gs-badge.template.js`).
* **Página inicial** (`/`): versão atual, canal, commit e data publicados, novidades, etapas, histórico completo com "Abrir vX", problemas conhecidos.

## Versões e commits
| versão | canal | etapa | commit |
|---|---|---|---|
| 0.1.0 | estável | 1 | `2016952` |
| 0.2.0 | estável | 2 | `17451f6` |
| 0.3.0 | estável | 3 | `9b30df1` |
| 0.4.0 | estável | 4 | `68ffeb4` |
| 0.5.0 | experimental | 5 | `56d5e45` |
| 0.5.1 | experimental | 5 (auditoria) | `31923d9` |
| 0.6.0 | experimental | 6 | `d995881` |
| 0.7.0 | experimental | 7 | ver `/versions.json` |

## Arquivar uma versão
`node scripts/archive-release.mjs <id> <commit>` compila o commit num worktree temporário (a árvore de trabalho não é tocada) com `--base ./` e grava `releases/<id>/`. É determinístico o suficiente para comparação,
mas não "reescreve" a história: o motor de cada versão é exatamente o do commit. As versões ficam no repositório (≈ 0,2 MB cada).

## Compatibilidade entre versões
Todas as versões hospedadas no mesmo domínio compartilham o armazenamento do navegador (IndexedDB `evolvere`). Saves de uma versão nova podem não abrir em uma antiga; o inverso funciona
(o formato é versionado em `src/core/serialize.ts`). Para comparar versões sem mexer em saves use os parâmetros de URL com a mesma semente (`?seed=3&size=64x40&pop=300`): o motor é determinístico.
