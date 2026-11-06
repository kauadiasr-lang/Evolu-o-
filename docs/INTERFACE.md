# Etapa 6 — Primeira versão visual integrada

> A interface **já existia** (Etapas 1–5: mapa em canvas, motor em Web Worker, painéis, gráficos, toque). A Etapa 6 não criou um segundo
> motor nem uma demonstração: verificou o que havia, corrigiu o que impedia de **enxergar o mundo vivo** e acrescentou o que faltava para
> acompanhá-lo versão após versão. Tudo o que aparece vem do motor real.

## 1. Como a interface se conecta ao motor

```
main thread (src/app/main.ts, src/render/*)            Web Worker (src/worker/sim.worker.ts)
  controles, HUD, painéis, canvas ──ToWorker──▶          new Simulation(cfg)  ← o MESMO src/core usado nos testes
  ◀──FromWorker: frame (Float32Array x,y; sp; vis…)      loop: sim.step() por tempo (orçamento ms), nunca por quadro desenhado
  ◀──FromWorker: stats (contagens, espécies, séries…)
```
* O motor roda **somente** no worker. A velocidade (½×…100×) muda quantos ticks por segundo o worker executa; cada tick é idêntico.
  Renderização, qualidade gráfica, tamanho de tela e pausa em segundo plano não entram na física (provado em §5).
* Um `frame` é uma fotografia (arrays tipados) dos organismos vivos; o mapa só **desenha** esses arrays. Não há cópia do mundo inteiro por quadro
  (só posição/espécie/aparência dos organismos + camada ativa) e o worker limita a taxa de quadros (`ack` evita acúmulo).
* Clique/toque num organismo envia `inspect` e o worker devolve os dados reais daquele indivíduo (id, espécie, massa, energia, idade, geração, genes).
* **Camada de adaptação da interface (isolada e documentada):**
  * `src/render/palette.ts` — cor da espécie = função só do id (vindo do motor). Mesma cor no mapa, na lista, no HUD e nos gráficos.
  * Série de **população por espécie** (`popSeries` em `main.ts`): o motor guarda séries por grupo trófico, não por espécie; a interface amostra
    `stats.species[].count` (contagens reais) a cada ≥ 25 ticks, com decimação (máx. 600 pontos). É só leitura, é descartada ao reiniciar/carregar e **não** vai
    para o arquivo salvo.
  * Parâmetros de URL (só interface): `?seed=7&size=64x40&pop=300&stage3=1&ecology=1&speed=5&paused=1`.

## 2. O que mudou na Etapa 6
| mudança | por quê |
|---|---|
| Organismos com **cor por espécie** (id), contorno escuro e tamanho mínimo legível; anel da espécie nas criaturas detalhadas; botão "Cor: espécie / fenótipo" | no mapa de abertura os organismos eram pontos ciano sobre água ciano: o mundo parecia vazio |
| **HUD sobre o mapa**: semente, tempo (idade e tick), organismos, espécies, biomassa, estado, velocidade e as espécies mais numerosas (clicáveis) | no celular a barra superior mostrava só "960 ka 1.9k", sem rótulos e sem semente; agora tudo é visível em qualquer tela |
| **Reiniciar** (mesma semente/config, tick 0) | só havia "Novo planeta" |
| Gráfico **População por espécie** (linear/log) | só havia séries por grupo trófico |
| Parâmetros de URL e início pausado | sessões reproduzíveis/compartilháveis; o mundo nasce parado no tick 0 sem corrida entre mensagens |
| Correção: erro ao trocar para um mundo de outra grade (`Cannot read properties of undefined`) | o terreno novo era pintado com o quadro antigo (outra grade) |
| Correção: erro 500 no console ao abrir | a interface consultava o proxy de IA na inicialização; agora só quando se abre a aba IA |
| Série/HUD/botões não alteram o motor | a camada é somente leitura |

## 3. Como executar e visualizar
```bash
npm install
npm run dev                         # http://localhost:5173
# celular na mesma rede Wi-Fi:
npm run dev -- --host               # abra http://<IP-do-computador>:5173 no celular
# versão de produção:
npm run build && npx vite preview --host --port 4173
```
Exemplos: `http://localhost:5173/?seed=11&size=64x40&pop=300&speed=5` · `...?seed=5&size=48x30&ecology=1&paused=1`.
Controles: ⏸/▶ (Espaço), ⏭ avança 25 ticks, velocidades ½×…100× (teclas 1–7), **Reiniciar**, **Novo planeta** (semente, tamanho, Etapa 3, ecologia), Salvar/Carregar,
zoom/arrastar/pinça, toque ou clique num organismo (ficha com dados reais), clique numa espécie (HUD, lista ou árvore) para destacá-la.
Abas: Espécies · Flora · Ecossistema · Evolução · Eventos · Planeta · IA; gráficos: Linha do tempo · **População por espécie** · Árvore da vida · Teia alimentar · Genes.

## 4. O que é realmente observável
Organismos (posição, espécie, fenótipo), terreno/biomas/vegetação, camadas (temperatura, luz, nutrientes, detritos, biomassa…), contagem de organismos e de espécies, biomassa,
tempo (ticks e idade), população por espécie ao longo do tempo (desta sessão), eventos registrados pelo motor (especiação, extinção, erupção…), árvore da vida,
teia alimentar medida (massa transferida por predação), diagnósticos evolutivos (Etapa 4) e a ficha de cada organismo.

## 5. Verificação (nenhuma depende só de o build passar)
* `node scripts/ui-truth.mjs` — compara o navegador com **o mesmo motor rodando em Node**: população, espécies, biomassa, contagem por espécie e **posição e espécie de cada organismo desenhado**
  (hash), nos ticks 0/250/500; ficha de um organismo clicado; passo (+25 exatos), pausa, continuar, velocidade (½×/1×/5×), reiniciar (estado idêntico ao inicial), novo planeta;
  mundo com continentes + ecologia; e parada em tick arbitrário a 30× no celular emulado (estado idêntico ao motor isolado).
* `node scripts/ui-soak.mjs 150` — execução prolongada com CPU 2× (desktop) e 4× (celular) mais lenta, alternando abas e camadas: sem travamentos, memória estável e, ao final, estado = motor isolado.
* `node scripts/ui-test.mjs` — responsividade, toque, pinça e desempenho (Etapas 2–5).
* `tests/physics-lock.test.ts`, `tests/stability.test.ts`, `tests/stage3.test.ts`, … — física, determinismo e conservação de massa (inalterados).
Resultados: ver o relatório da etapa (`§ Resultados` abaixo).

### Resultados (execuções reais desta etapa)
| verificação | resultado |
|---|---|
| `npx tsc --noEmit` / `npx vite build` | limpo / ok (`index-*.js` ≈ 107 kB) |
| `npx vitest run` | 20 arquivos, **198 testes passam** (+12 de longa duração pulados por padrão); inclui `physics-lock`, estabilidade, conservação de massa, determinismo e o novo `ui-palette` |
| `node scripts/ui-truth.mjs` | **30/30**: nos ticks 0/250/500 (mundo padrão) e 300 (continentes + ecologia) população, espécies, biomassa, contagens por espécie e **cada organismo desenhado** = motor em Node; passo = +25 exatos; pausa; ½×/1×/5× = 10/22,4/96,4 ticks/s; reiniciar recria o mesmo mundo; ficha do organismo #1162 = dados do motor; parada a 30× no celular emulado (tick 1216) = motor |
| `node scripts/ui-soak.mjs 150` | **14/14**: desktop (CPU 2× mais lenta) e Pixel 7 emulado (CPU 4× mais lenta), 150 s a 5× (≈ 15 000 ticks, até 16 000 organismos): ticks sempre crescentes, nenhum quadro > 350 ms, memória do JS oscilando 2–22 MB (coleta de lixo, sem tendência), sem erros; ao parar, estado e posição/espécie de cada organismo = motor isolado e massa total conservada (22 400,000 → 22 400,000) |
| `node scripts/ui-test.mjs` | **129/129** (Etapas 2–5 inalteradas) |

**Desempenho observado (honesto):** sob CPU emulada 2×/4× mais lenta e 16 000 organismos a qualidade automática desce para "baixa" e o desenho fica em ≈ 14 fps
(intervalo p95 150–200 ms; ≈ 1 000 tarefas > 50 ms em 150 s, a pior 236–345 ms). A simulação não é afetada (≈ 100 ticks/s a 5×). Em CPU normal o mapa roda a ~60 fps em mundos pequenos.
Não foi medido em aparelho físico.


## 6. Limitações
* A série por espécie existe só na sessão do navegador (não é salva nem reconstruída ao carregar um arquivo).
* A cor por espécie é identidade visual; com 1 espécie dominante o mapa fica monocromático (é o estado real do mundo).
* Em mundos grandes (≳ 15 000 organismos) e CPU lenta a qualidade desce sozinha para "baixa" (menos criaturas detalhadas, ~14 fps); a simulação mantém a velocidade pedida.
* Sem sprites/animações definitivos, sem áudio, sem tutorial, sem metas de jogo; as ferramentas do jogador (aquecer, impacto…) existem desde a Etapa 1 e **alteram** o mundo por ação explícita.
* Interface em português; sem internacionalização.
* Validação em dispositivo físico: feita em emulação (Chromium/Playwright); testes de toque e desempenho em aparelhos reais continuam pendentes.
