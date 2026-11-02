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
npm test             # 50+ testes automatizados (núcleo, evolução, estabilidade, IA, save/load)
npm run test:long    # simulações de longa duração (3 sementes × 30 000 ticks, ~8 min)
npm run build        # typecheck + build de produção (dist/)
npm run headless -- 3 8000   # roda o motor sem interface (semente 3, 8000 ticks) e imprime a evolução
```

### IA opcional (Diretora do planeta)

O jogo funciona integralmente **sem** internet e sem IA (um cronista local narra os fatos). Para ligar um
modelo de linguagem:

```bash
cp .env.example .env              # e preencha ANTHROPIC_API_KEY (ou exporte a variável)
ANTHROPIC_API_KEY=sk-... npm run ai-proxy     # backend local na porta 8787
npm run dev                                   # o Vite encaminha /api -> 8787
```

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

## Arquitetura

```
src/core/      NÚCLEO (sem DOM, sem IA, roda em Node): rng, genome, traits, world, organisms,
               species, simulation, layers, snapshot, serialize, validate, stats, params
src/worker/    sim.worker.ts + protocolo — simulação fora da thread da UI
src/render/    mapRenderer (camadas, câmera, LOD), morphology (criaturas), charts (séries, árvore, teia)
src/app/       main (orquestração), panels (painéis), simClient, storage (IndexedDB), styles
src/ai/        digest (resumo factual), chronicler (cronista local), director (cache/throttle/proxy)
server/        ai-proxy.mjs — backend local que guarda a chave de API
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

## Estado atual por etapa

| Etapa | Estado |
|---|---|
| 1 Protótipo evolutivo | ✅ planeta 2D, oceano, unicelulares, genética, reprodução, mutação, energia, seleção, velocidade, interface |
| 2 Ecossistema | 🟡 fotossintéticos, osmótrofos/decompositores e predadores **emergem do genoma**; teia alimentar dinâmica, nutrientes e biomassa. Herbívoros/carnívoros especializados dependem de multicelularidade (Etapa 3) |
| 3 Evolução visual | 🟡 morfogênese genética de unicelulares. Multicelulares, plantas, simetria radial/segmentação: pendentes |
| 4 Planeta complexo | 🟡 relevo oceânico, clima, ciclo de nutrientes e geologia. Continentes, solo, atmosfera (O₂/CO₂), biomas: pendentes |
| 5 IA | 🟡 crônicas, perguntas, hipóteses e validação pelo motor. Análise de espécies mais profunda: pendente |
| 6 Expansão | ⬜ 3D, comportamentos complexos, novos metabolismos, inteligência |

### Limitações conhecidas

- Os organismos são unicelulares e assexuados; a especiação é por agrupamento fenético (não há isolamento
  reprodutivo explícito).
- Os ciclos de O₂/CO₂ e a atmosfera ainda não existem; apenas a matéria (nutriente) circula.
- Em ~10 000 ticks a diversidade trófica é modesta (predadores especializados surgem lentamente); sementes
  diferentes seguem trajetórias diferentes.
- A visualização usa Canvas 2D; WebGL/Three.js fica para a Etapa 6.

Licença: MIT (ajuste conforme a sua preferência).
