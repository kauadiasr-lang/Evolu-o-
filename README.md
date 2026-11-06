# EVOLVERE

> *A vida não segue um roteiro. Ela escreve o próprio.*

Simulador de **evolução biológica e ecossistemas emergentes**. Organismos unicelulares sobrevivem, se
reproduzem, sofrem mutações, competem por luz, nutrientes e presas, e evoluem — ou desaparecem. Cada planeta
(semente) tem uma história evolutiva diferente. Não há espécies obrigatórias nem caminhos predeterminados.

## Como executar

Requer Node.js ≥ 18.

```bash
npm install
npm run dev          # abre o jogo em http://localhost:5173
npm test             # 63 testes (núcleo, evolução, estabilidade, trava da física, IA, desempenho, save/load)
npm run test:ui      # responsividade/toque/desempenho em emulação (precisa de `npm run build && npx vite preview --port 4173`)
npm run test:long    # simulações de longa duração (3 sementes × 30 000 ticks, ~8 min)
npm run build        # typecheck + build de produção (dist/)
npm run headless -- 3 8000   # roda o motor sem interface (semente 3, 8000 ticks) e imprime a evolução
```

### Celular e tablet

A interface se adapta por CSS/JS (sem versão separada): em telas ≤ 820 px (ou celulares em paisagem) os painéis
viram **folhas recolhíveis** acionadas por uma barra inferior (Mapa · Camadas · Ações · Dados · Gráficos). Gestos:
arrastar com um dedo move o mapa; **pinça** dá zoom; toque seleciona um organismo (ou mostra os dados da célula —
não há dependência de hover); botões ≥ 44 px, respeito às áreas seguras (notch). Em **⋯ → Gráficos** há a
qualidade (Automática/Alta/Média/Baixa) e a pausa em segundo plano. A qualidade só muda o desenho e a frequência
de atualização — a física é idêntica (provado por `tests/physics-lock.test.ts`).

### IA opcional (Diretora do planeta)

O jogo funciona integralmente **sem** internet e sem IA (um cronista local narra os fatos). Para ligar um
modelo de linguagem:

```bash
# Anthropic (padrão)                  # ou OpenAI-compatível:
ANTHROPIC_API_KEY=sk-... npm run ai-proxy      # EVOLVERE_AI_PROVIDER=openai OPENAI_API_KEY=sk-... npm run ai-proxy
npm run dev                                    # o Vite encaminha /api -> 8787
npm run ai-smoke                               # VALIDA a IA de verdade: 1 crônica + 1 rodada de eventos, com latência,
                                               # validação do motor e impacto medido (sai com código 2 se não houver chave)
```
Variáveis (ver `.env.example`): `EVOLVERE_AI_PROVIDER`, `EVOLVERE_AI_MODEL`, `EVOLVERE_AI_BASE_URL`, `EVOLVERE_AI_RPM`.

A chave existe **somente** no processo do proxy; o navegador nunca a vê. Depois, na aba **IA**, marque
"IA conectada".

## O que há no jogo (Etapa 1 completa + partes das Etapas 2, 5)

**Planeta** — grade de células (padrão 96×60, mundo cilíndrico) com relevo submarino, profundidade →
luz, temperatura por latitude/profundidade/estação, fontes hidrotermais, nutrientes dissolvidos (difusão),
detritos (decomposição dependente da temperatura) e sedimento que se acumula, pressiona o fundo e dispara
**erupções naturais** (não aleatórias: dependem da vida que morreu e foi enterrada).

**Organismos** — estruturas SoA (typed arrays), sem objeto JS por indivíduo. Cada um tem id, espécie,
genoma de 24 genes, idade, energia, massa, posição, geração, ascendência e traços derivados.
Morrem de **fome, estresse térmico, predação, envelhecimento ou catástrofe** — não há barra de vida.

**Genética e evolução** — hereditariedade, mutações pontuais gradativas (taxa que também evolui), seleção
natural emergente, competição por luz/nutrientes/espaço, deriva e **especiação** (agrupamentos
geneticamente bimodais e isolados geográfica ou ecologicamente), com árvore da vida e extinções.

**Custos de adaptação** — nada é grátis: fotossíntese, predação, motilidade, defesa, tolerância térmica,
afinidade por nutrientes, longevidade e tamanho cobram manutenção e/ou impõem restrições (ver
`src/core/traits.ts`). A vantagem depende do ambiente: um ótimo térmico perfeito num lugar é veneno em outro.

**Conservação de massa** — `nutriente + detrito + biomassa + sedimento` é constante (verificado nos testes
até 1e-9 de erro relativo, inclusive sob intervenções do jogador). A energia vem da luz e é dissipada.

**Morfogênese procedural** — o desenho de cada criatura sai dos genes: alongamento, lobos, simetria,
flagelos, cílios, espinhos, carapaça, núcleo, cloroplastos, boca de predador, padrões, pigmentação.

**Interface** — mapa com 8 camadas (oceano, temperatura, luz, nutrientes, detritos, biomassa,
biodiversidade, densidade) + distribuição da espécie selecionada; câmera com pan/zoom e LOD de criaturas;
painéis de espécies, ecossistema (balanço de massa, causas de morte), eventos, planeta e IA; linha do tempo,
**árvore da vida**, **teia alimentar** e evolução dos genes. Ferramentas: aquecer, resfriar, aprofundar, elevar
leito, nutrientes, semear vida, erupção, impacto, clima global e extinção em massa.

**Tempo** — simulação num **Web Worker**, independente da taxa de quadros (½× a 100×); o renderer roda a
parte. **Salvar/carregar** em IndexedDB (determinístico: um save carregado continua exatamente a mesma história).

**IA** — recebe um *digest* factual (só números reais), narra crônicas, responde perguntas e propõe
hipóteses. Números citados que não existem no digest são sinalizados. **A IA nunca altera o mundo
diretamente:** sugestões passam por `src/core/validate.ts` (limites, coerência com o estado real; uma
"adaptação" vira, no máximo, uma variante rara em poucos indivíduos que ainda terá de sobreviver).
Chamadas periódicas, com cache, limite por minuto e fallback local.

### Papel da IA e acontecimentos ecológicos (Etapa 2)

```
Simulação (núcleo, worker) ──resumo factual──▶ digest ──▶ Diretor (cache, throttle) ──▶ proxy local ──▶ LLM
        ▲                                                                                   │ propostas JSON
        └──── EcoEventManager: valida · limita frequência · aplica como ENTRADA AMBIENTAL ◀──┘
                     └─ depois mede o IMPACTO REAL (população/biomassa/espécies) e registra
```
A IA **nunca** escreve no estado do mundo. Tipos aceitos: variação climática (|ΔT| ≤ 6 °C), ressurgência de
nutrientes (massa do sedimento, conservada), erupção (só com pressão geológica alta, em águas profundas) e
variante genética rara (|Δgene| ≤ 0,12 em ≤ 5 indivíduos, que ainda precisam sobreviver à seleção). Há intervalo
mínimo (300 ticks) e teto (4 eventos/3000 ticks) para eventos automáticos; ações manuais do jogador não consomem
essa cota. O modo "Diretora autônoma" é opcional e desligado por padrão. Gases/atmosfera ainda não existem na
física, portanto a IA não pode propô-los.

## Arquitetura

```
src/core/      NÚCLEO (sem DOM, sem IA, roda em Node): rng, genome, traits, world, organisms,
               species, simulation, layers, snapshot, serialize, validate, events, stats, params
src/worker/    sim.worker.ts + protocolo — simulação fora da thread da UI
src/render/    mapRenderer (camadas, câmera, LOD), morphology (criaturas), charts (séries, árvore, teia)
src/app/       main (orquestração), panels (painéis), simClient, storage (IndexedDB), styles
src/ai/        digest (resumo factual), chronicler (cronista local), director (cache/throttle/proxy)
server/        ai-proxy.mjs + providers.mjs (Anthropic / OpenAI-compatível) + prompts.mjs — backend local que guarda a chave
tests/         genética, fisiologia, evolução, estabilidade, save/load, IA, longa duração
```

Fluxo de um tick (`Simulation.step`): ambiente (clima/luz) → indexação espacial por célula → para cada
organismo [fotossíntese → osmotrofia → predação → manutenção → crescimento → reprodução → morte →
movimento] → química da célula (difusão, decomposição, sedimentação, fontes) → geologia → periódicos
(especiação a cada 100 ticks, histórico a cada 25).

### Principais dificuldades de implementação (e como foram tratadas)

1. **Balanço energético** — pequenas mudanças de parâmetro levam à extinção ou à explosão. Todas as
   constantes estão em `params.ts`; o custo de construir massa (`BUILD_COST`) é igual à energia que ela
   libera (`E_PER_MASS`), impedindo moto-perpétuo; testes de longa duração vigiam a estabilidade.
2. **Especiação sem "inventar" espécies** — a distância à âncora falhava porque a variação interna de uma
   espécie já é comparável ao limiar; o critério final é bimodalidade (2-means) + isolamento.
3. **Canibalismo generalizado** — se qualquer célula puder comer qualquer vizinha, a população inteira vira
   predadora; predar exige aparato (`PRED_MIN`) e presa bem menor.
4. **Desempenho** — SoA, índice espacial por contagem, sem alocação por tick, simulação em worker com
   orçamento de tempo por quadro, instantâneos compactos (bytes por gene visual) e LOD no desenho.
5. **Determinismo** — RNG semeado e estado (inclusive lista livre do pool) salvo, para que o save/load
   reproduza a mesma história.

## Etapa 3 — morfogênese, flora e biomas

Tudo da Etapa 3 vive atrás da flag `stage3` da configuração do mundo. Com `stage3: false` o motor é **bit a bit
idêntico** ao das Etapas 1–2 (travado por `tests/physics-lock.test.ts`); o jogo cria mundos novos com `stage3: true`
(caixa "Continentes, flora, morfologia e biomas" no diálogo *Novo planeta*).

**Evolução visual dos animais.** O genoma passou a ter 36 genes: 12 morfológicos (segmentação, pares de membros e
comprimento, nadadeiras, olhos, camuflagem, escalada, adaptação terrestre, antenas, cauda, pigmento secundário,
cefalização). Eles são herdados e mutados por um fluxo de RNG separado (a física clássica não é perturbada).
A aparência vem do **fenótipo expresso** (`src/core/phenotype.ts`): uma estrutura só se desenvolve se os
pré-requisitos existem — membros exigem motilidade e tamanho; escalada e vida terrestre exigem membros; segmentos
exigem corpo alongado; olhos exigem quimiotaxia; radiais não têm cabeça nem segmentos. Genes sem pré-requisito ficam
*crípticos* (herdados, mas sem efeito visual nem custo). Planos corporais: unicelular, bilateral, segmentado,
radial, assimétrico.

| Estrutura | Benefício no motor | Custo |
|---|---|---|
| Nadadeiras / cauda / segmentos | velocidade na água | manutenção (por segmento, nadadeira…) |
| Membros | locomoção em terra | manutenção por par e comprimento |
| Adaptação terrestre | sem dessecação fora d'água | manutenção alta, inútil no mar |
| Escalada | alcança plantas altas; reduz predação por animais de solo | manutenção |
| Olhos / cefalização | caça mais eficaz, taxia melhor | manutenção |
| Camuflagem | reduz captura **se o matiz do corpo casar com o substrato** (água, solo ou vegetação) | pigmentação |
| Carapaça (defesa) | resistência à predação | peso, lentidão (Etapa 1) |

**Continentes e clima.** ~32% da superfície é terra emersa (relevo por ruído, nível do mar por percentil), com
umidade vinda do oceano, desertos subtropicais, gradiente térmico com a altitude e solo que recarrega com a chuva.
O aquecimento seca a terra. Animais sem membros e integumento não entram em terra; quem entra paga dessecação.

**Flora procedural** (`src/core/flora.ts`). Plantas são indivíduos com 11 genes: altura, largura da folha, densidade
foliar, profundidade das raízes, pigmentação, tolerância à sombra e à seca, temperatura ótima/tolerância, investimento
em sementes e taxa de mutação. Competem por **luz** (dossel com atenuação de Beer–Lambert: árvores altas sombreiam o
que está abaixo, inclusive o chão onde animais fotossintetizam), **água** (solo compartilhado; raízes profundas
alcançam mais) e **nutrientes** (a mesma reserva de massa conservada do oceano). Custos: altura e raízes cobram
manutenção; folha larga transpira mais; tolerar seca ou sombra reduz o rendimento máximo. Reprodução com dispersão
pelo vento e linhagens que se ramificam. Seis formas de crescimento emergem dos genes (musgo, erva, gramínea,
arbusto, árvore, suculenta). A colonização da terra acontece quando o mar acumula biomassa fotossintética
suficiente (condição observada, não sorteio).

**Biomas emergentes** (`src/core/biomes.ts`). Não há mapa fixo: cada célula é classificada a partir de temperatura,
umidade do solo, relevo e **vegetação realmente presente** (cobertura e altura): oceano aberto, abismo, plataforma,
recife, gelo, tundra, deserto, terra nua, pradaria, arbustal, floresta e pântano. O desenho mistura os mesmos campos
contínuos (cor do solo por umidade e frio + cor da vegetação pelo pigmento real e altura), então as transições são
graduais e mudam quando o clima muda. Eventos de bioma citam as variações medidas.

**Interface.** Camadas *Biomas*, *Umidade* e *Vegetação*; aba **Flora** (linhagens, retrato com perfil de raízes,
custos/benefícios); no painel de espécies: plano corporal, anatomia expressa com custo/benefício, **trilha de gerações**
(retratos da linhagem ao longo do tempo) e **comparação de duas espécies**; a ficha do organismo mostra a variação
individual em relação à média da espécie. Ferramenta sandbox **Semear plano corporal** (nadador segmentado, anfíbio,
escalador, camuflado, blindado, radial): são só sementes — a massa vem do nutriente/sedimento e a seleção decide.

**IA (Etapa 3).** O digest agora traz anatomia expressa, flora e biomas reais; novos modos *Analisar espécie* e *Narrar
biomas*. **A IA nunca altera genomas**: a antiga sugestão `adaptation` (que editava genes de até 5 indivíduos) foi
removida; hipóteses sobre adaptações são texto. Sem IA, o cronista local narra os fatos.

## Etapa 4 — evolução emergente, estabilidade e pressão ambiental

* **Ambiente estável opcional** (`stable`): sem estações nem erupções naturais; uma linhagem bem adaptada persiste, e mesmo
  assim há variação genética contínua. Nada obriga complexidade, mutação vantajosa ou especiação.
* **Pressões ambientais** que agem só por traços herdados: clima (gradual ou abrupto), aridez, luz, esgotamento de
  nutrientes (a massa vai ao sedimento — conservada), temperatura regional. Podem ser agendadas (`EnvChange`) e aplicadas
  pelo painel do planeta. A adaptação **não é garantida**; a extinção é possível (+25 °C abrupto extinguiu 4/4 sementes).
* **Experimento reproduzível A × B** (`src/core/experiment.ts`, `scripts/experiment.ts`): mesmo estado bifurcado em
  estável × alterado; compara população, ajuste térmico, deslocamento de TOPT, espécies, tempo de resposta e massa.
* **Isolamento geográfico** (barreiras térmicas) e **viabilidade de intermediários terrestres** (`scripts/land-viability.ts`).
* **Diagnósticos** (`src/core/diagnostics.ts`, aba *Evolução*): frequências de traços, pressões atuantes, divergência entre
  regiões, veredito de especiação ("por que não especiou": poucos indivíduos, homogêneo, sem lacuna, sem isolamento…),
  causa provável de extinção (hipótese), colonização de habitats. A IA (opcional/offline) só explica o que foi medido:
  não edita genes, não cria eventos sem validação e é instruída a tratar causas como hipóteses.
* Resultados por semente (inclusive as que não se adaptaram ou não especiaram): `docs/EXPERIMENTS.md`.

## Etapa 5 — ecologia emergente e relações naturais

Detalhes, diagnóstico, resultados (inclusive negativos) e limitações: **`docs/ECOLOGIA.md`**.

* Nenhuma relação é programada (sem tabela de pares, sem rótulo que determine comportamento). Com `SimConfig.ecology`
  (padrão desligado; caixa "Ecologia emergente" ao criar o mundo) entram dois mecanismos gerais: **exsudação** por excesso
  metabólico (energia saturada → matéria vaza para o detrito local) e **abrigo estrutural** (cobertura vegetal reduz a captura
  de presas pequenas), além de um **registro de fluxos** de matéria por espécie.
* **Análise causal** (`src/core/ecology.ts`, `scripts/ecology.ts`): remoção de um grupo em bifurcações do mesmo estado, com
  réplicas e controle, limitando o viés de matéria (detrito × sedimento). Se os dados não sustentam um sinal robusto, a relação
  fica **indeterminada**. Rótulos são interpretação de efeito líquido num horizonte, nunca causa do comportamento.
* Com `ecology:false` a física é a mesma de antes, bit a bit (`physics-lock`, fingerprint de 30 000 ticks).
* Não implementado: parasitismo (extração não letal), construção de abrigos, escolha ativa de presa, ledger energético fechado.

## Etapa 6 — primeira versão visual integrada

Detalhes, arquitetura e verificação: **`docs/INTERFACE.md`**.

* A interface já existia; a Etapa 6 tornou o **mundo vivo visível** (cor por espécie, contorno, HUD com semente/tempo/população/espécies/biomassa),
  acrescentou **Reiniciar**, o gráfico **População por espécie**, parâmetros de URL (`?seed=7&size=64x40&speed=5&paused=1`) e corrigiu dois erros de console.
* Tudo vem do motor real (Web Worker). `node scripts/ui-truth.mjs` compara o navegador com o mesmo motor em Node (cada organismo desenhado);
  `node scripts/ui-soak.mjs` roda uma sessão longa sob CPU lenta. Para abrir no celular: `npm run dev -- --host` e acesse `http://<IP>:5173`.

## Etapa 7 — acesso pelo celular, hospedagem e versões

**Jogar no Android (sem computador):** abra `https://kauadiasr-lang.github.io/Evolu-o-/` no Chrome → **Abrir o jogo**; opcional: ⋮ → **Instalar app**.
(Se o link ainda der 404: Settings → Pages → Source = **GitHub Actions**, uma vez — ver `docs/HOSPEDAGEM.md`.)

* Site estático no **GitHub Pages**, publicado por `.github/workflows/pages.yml` a cada push no branch padrão, **depois** de `tsc`, `vitest`, montagem e testes do site.
* **Versões**: `versions/versions.json` (canais estável/experimental/dev), página inicial com novidades/etapas/histórico, versões 0.1.0–0.6.0 abertas em `/v/<id>/`
  (compilações reais dos commits), e a versão sempre visível no jogo (HUD e **⋯ → Sobre**). Ver `docs/VERSOES.md`.
* **PWA**: instalável, tela cheia, offline; atualização **só com confirmação** do jogador. Ver `docs/PWA.md`.
* Comandos: `npm run build:site` · `npm run serve:site` · `npm run test:site` · `npm run test:pwa-update` · `npm run release:archive -- <id> <commit>` · `npm run icons`.

## Estado atual por etapa

| Etapa | Estado |
|---|---|
| 1 Protótipo evolutivo | ✅ planeta 2D, oceano, unicelulares, genética, reprodução, mutação, energia, seleção, velocidade, interface |
| 2 Ecossistema | 🟡 fotossintéticos, osmótrofos/decompositores e predadores **emergem do genoma**; teia alimentar dinâmica, nutrientes e biomassa. Herbívoros/carnívoros especializados dependem de multicelularidade (Etapa 3) |
| 3 Evolução visual | ✅ morfogênese por fenótipo expresso (segmentos, membros, nadadeiras, olhos, carapaça, camuflagem, escalada, radial), flora procedural e biomas emergentes. Limitações abaixo |
| 4 Planeta complexo | 🟡 continentes, hidrologia, solo, clima, ciclo de nutrientes, geologia e biomas. Atmosfera (O₂/CO₂) e ciclo do carbono: pendentes |
| 5 IA | 🟡 crônicas, perguntas, hipóteses e validação pelo motor. Análise de espécies mais profunda: pendente |
| 6 Expansão | ⬜ 3D, comportamentos complexos, novos metabolismos, inteligência |

### Limitações conhecidas

- Os animais ainda são assexuados e de um único "plano de células": segmentos, membros etc. são fenótipos de um
  organismo, não colônias multicelulares simuladas célula a célula. A especiação é por agrupamento fenético.
- A vida **começa no mar**; plantas colonizam a terra por um gatilho de estado (biomassa fotossintética), e animais só
  chegam à terra se evoluírem (ou forem semeados) membros + integumento. **Medido (Etapa 4):** em 6 sementes, animais
  terrestres surgiram espontaneamente em 4 (sementes 2, 3, 4 e 5; entre ≈19 000 e ≈38 000 ticks) e não surgiram até
  30–60 mil ticks nas outras duas. Nada é introduzido pelo motor (`docs/EXPERIMENTS.md`).
- **Diversificação no modo Etapa 3 depende do tempo.** Em 30 000 ticks as sementes 1 e 4 tinham uma só espécie; em 60 000
  ticks ambas especiaram (≈42 800 e ≈56 100). Não é bug nem falta de mutação (≈1,2 mutações/nascimento, variância
  crescente): a divergência só começa quando nichos por tamanho se abrem. O limiar de especiação (1,5) **não foi alterado**;
  `npm run test:long` não exige mais "mais de uma espécie", só estabilidade e massa conservada, e imprime o número de espécies.
  Detalhes: `docs/EXPERIMENTS.md`; sonda: `npx tsx scripts/diag-speciation.ts <semente> [off]`.
- Plantas: florestas (média de altura > 1,6) surgem só em regiões úmidas e devagar; predominam musgos, ervas e arbustos.
- Camuflagem só protege quando o matiz do corpo casa com o substrato local; o substrato de vegetação usa o matiz médio.
- Os ciclos de O₂/CO₂ e a atmosfera ainda não existem; apenas a matéria (nutriente) circula.
- Em ~10 000 ticks a diversidade trófica é modesta (predadores especializados surgem lentamente); sementes
  diferentes seguem trajetórias diferentes.
- A visualização usa Canvas 2D; WebGL/Three.js fica para a Etapa 6.

Licença: MIT (ajuste conforme a sua preferência).
