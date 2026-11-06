# Auditoria científica e causal — Etapa 5 (ecologia emergente)

> Sem commit, sem push, sem PR; branch inalterada. O protocolo (§4) foi escrito **antes** dos experimentos. Desvios do
> protocolo e experimentos acrescentados depois estão marcados como **[desvio]** ou **[pós-hoc]** e nada foi usado para ajustar
> parâmetros do motor. Constantes só foram alteradas em memória nos knockouts/sensibilidade (§4.6).

## 1. Resumo executivo

**Veredito:** a Etapa 5 é *tecnicamente sólida e cientificamente limitada*. A física (ecologia desligada) está intacta e o
registro é observacional; os dois mecanismos produzem efeitos reais, mensuráveis e causalmente atribuíveis. Mas:

1. **A única relação demonstrada com robustez é a competição por recursos compartilhados** (5/5 sementes, 3 contextos, ambos
   os destinos de matéria, IC95% ≈ ±0,01), e ela é uma propriedade geral deste mundo de matéria fechada, não um achado da Etapa 5.
2. **Mutualismo e comensalismo NÃO têm qualquer suporte**: nenhum par mostrou efeitos positivos recíprocos; o análogo mais
   próximo (exsudador × misotrófico) é uma **exploração assimétrica**: a exsudação *subsidia* o misotrófico (causal: com
   `EXUDE_K = 0` ele cai 3–7× ou se extingue) e o torna o competidor dominante **em prejuízo do exsudador** (biomassa de P
   cai 81% no contexto escasso).
3. **Quatro problemas comprovados** (§9): (a) o método de remoção atribuía a "interação" realocação de matéria e dividia grupos quando a
   especiação trocava rótulos (corrigido, §10); (b) o teste "barreira letal" **não isola** os grupos (nutriente difunde) — a afirmação de
   "falso positivo corrigido" em `docs/ECOLOGIA.md` era uma hipótese não comprovada e foi retificada; (c) estatística do estimador de produção
   com 3–6 réplicas e z=2 é anticonservadora (mitigada na prática pelo critério de duplo destino); (d) o rótulo "mutualismo (efeito líquido)" afirma mais do que
   os 5 critérios de mutualismo exigem.
4. **Resultados negativos preservados:** consumidor estritamente osmótrofo inviável em todos os genomas testados (cenários C/D com ele são vazios);
   retalho terrestre (E2) não avaliado (todos morreram); refúgio funciona por tentativa (−16% a −41% na taxa de captura) mas o efeito
   indireto na cadeia não foi medido.
5. **Invariantes preservados:** com ecologia desligada, estados de RNG (`rng`, `mrng`, `flora.rng`), hash, eventos e tick idênticos ao commit
   anterior em 4 configurações × 2500 ticks; fingerprints de 30 000 ticks idênticos; isolamento e bifurcação exatos.

Nada foi feito para produzir resultados desejados. A recomendação é **não avançar para a Etapa 6 sem aprovar** as decisões listadas em §14.

## 2. Arquitetura auditada

| arquivo | papel | achado |
|---|---|---|
| `src/core/ecomech.ts` | funções puras `exudation`, `refugeFactor` | sem RNG, sem estado; correto |
| `src/core/simulation.ts` | ganchos sob `if (this.ecology)`; `ecoFlow`; `removeWhere` | com `ecology:false` nada executa (provado por RNG/hash idênticos) |
| `src/core/params.ts` | `EXUDE_K 0,004`, `EXUDE_FROM 0,6`, `REFUGE_K 0,6` | escolhidas a priori; ver §3 |
| `src/core/ecology.ts` | análise por remoção, `interpret` | corrigido (§10); limitações em §3.4 |
| `scripts/ecology.ts`, `scripts/audit-*.ts` | CLIs | somente leitura sobre o motor |
| testes `ecology-*.test.ts` | mecanismo/emergência/longa duração | 17 + 9 + 6; ver §9 sobre premissas |

## 3. Mecanismos existentes — respostas às perguntas da auditoria

### 3.1 Exsudação
* **O que determina a quantidade?** `leak = 0,004 · massa · (enchimento − 0,6)/0,4`, `enchimento = energia/(4·massa)`; só o estado energético
  e a massa. Nenhum tipo trófico entra na fórmula.
* **Conservação:** a massa sai do corpo e entra no detrito da MESMA célula, soma exata (deriva ≲ 3·10⁻¹⁴ nos cenários A; < 1e-9 nos mundos longos).
* **Acessível a outros?** Só a quem está **na mesma célula** e tem `OSMO > 0,01` (o detrito não difunde, `world.stepChemistry`), ou a todos
  indiretamente após a decomposição (detrito → nutriente, que difunde). Não há rastreio de proveniência: depois de entrar no detrito, a matéria é anônima.
* **Cria dependência real?** Sim para o misotrófico testado (§5, H): com exsudação ligada M atinge 495/827/561 de biomassa em 800 ticks
  (contextos 3/7/25) contra 144/119/**0** (extinto em 5/5 sementes no contexto 25) com `EXUDE_K = 0`. **Não** para osmótrofos estritos: nenhum
  dos 3 genomas testados sobreviveu 300 ticks nem com 10 de detrito por célula (B), logo "um organismo sustentado só por exsudato" não é demonstrável.
* **Sustentar outro sem benefício?** Sim, por construção: o exsudador paga a massa perdida e não recebe nada diretamente; só o retorno
  indireto via decomposição (compartilhado com todos). No cenário A o exsudador perde 16–22% de biomassa (471 vs 604; 1082 vs 1367; 3812 vs 4531).
* **Beneficia não consumidores?** Sim, mas ambíguo: no contexto rico, P→P2 (P2 não consome detrito) passa de −1,31 (sem exsudação) para −0,96 (com): menos dano,
  porém isso também decorre de P ter menos biomassa; não é atribuível a reciclagem de nutrientes sem um experimento adicional.
* **Vantagem artificial para uma estratégia?** O gatilho (energia saturada) só é alcançado por quem tem renda energética alta (fotossíntese): o fotossintético *isolado*
  vaza 2,6–4,0·10⁻³ por biomassa·tick (66–100% do máximo `EXUDE_K`), ou seja, **para ele o vazamento é praticamente constitutivo**, não condicional.
  Em mundos naturais (todos "mixo") 59–72% dos organismos estão acima do limiar (N5). Em 4 sementes × 10 000 ticks as frações médias de PHOTO/OSMO/PRED com a ecologia
  ligada × desligada diferem ≤ 0,05 (N4) — sem desvio sistemático detectável, mas com 4 sementes não se exclui.
* **O limiar de 60% tem justificativa biológica?** **Não.** É uma escolha experimental a priori. Comentário no código afirmava "matéria limitante"; o código só testa a
  saturação energética (comentário corrigido). O sobre-vazamento biologicamente típico (excesso de carbono sob limitação de nutriente) não é modelado.
* **Transferência de matéria ≠ relação ecológica:** a ingestão de detrito por M (713–7 596 de massa) prova transferência, não benefício líquido (§5).

### 3.2 Refúgio por vegetação
* Fórmula: `1 − 0,6 · cobertura/(1 + raio²)`, só em terra, só com `ecology`. Depende do **raio da presa** e da cobertura (contínua, linear até saturar em 1);
  **não** depende de mobilidade, defesa (já tratada à parte, multiplicativa), tamanho/percepção do predador, tipo/altura da planta (um musgo abriga como uma floresta).
* **Medido (E1, 200 ensaios por condição, mesmo estado, abrigo ligado × desligado, cobertura saturada = 1,00):** taxa de captura por tick: presa pequena sem defesa
  0,242 vs 0,412 (−41%); pequena com defesa 0,8: 0,109 vs 0,180 (−39%); grande sem defesa 0,317 vs 0,416 (−24%); grande com defesa 0,8: 0,145 vs 0,173 (−16%, diferença de 1,6 erro-padrão: **não distinguível do ruído**).
  O efeito existe e é maior para presas pequenas, como projetado; a proporcionalidade com coberturas intermediárias não foi testada empiricamente (só pela forma linear da função).
* **Efeito indireto na cadeia (E2): não avaliado** — todos os organismos morreram em ambos os braços (até com horizonte reduzido a 40 ticks), então a pergunta
  (sobrevivência de presas, ganho do predador) permanece aberta.
* **Vantagem sistemática:** favorece presas pequenas por construção (uma hipótese biológica razoável, mas uma suposição). Não há "toda vegetação protege toda presa": o fator varia de 1 (sem cobertura) a ~0,6.

### 3.3 Fluxos ecológicos
* **Representam eventos reais?** Sim: cada `addFlow` está no ponto exato do evento (crescimento, ingestão, captura, herbivoria, vazamento) sob `if (ecology)`.
* **Rastrear origem/destino?** Parcial: sabe-se *quem consumiu quanto* de cada tipo, **não de onde veio** o detrito (sem proveniência) nem em quem a presa se transformou. A rede "quem alimentou quem" por detrito é irrecuperável.
* **Dupla contagem?** São fluxos **brutos com reingestão**: um osmótrofo em `MASS_MAX` devolve ao detrito 70% do que ingere e o reingere (ciclo fútil, §6/N3); por isso 'detrito' ≈ 3·10⁶ em 30 000 ticks com 50 400 de massa total. Não é erro de contagem, mas **não é fluxo líquido** e não deve ser lido como tal.
* **Consumo × transferência × decomposição:** 'presa'/'planta' = consumo; 'exsudato' = transferência para o ambiente; 'detrito' = captação; a **decomposição** (detrito→nutriente) **não é registrada**.
* **Contribuição por grupo:** reconstruível por espécie (Σ espécies = total); espécies novas (especiação) não herdam o histórico do pai; `ecoFlow` **não é serializado** (zera em save/load e em bifurcações).
* **Influência acidental?** Não: `ecology:false` ⇒ nenhum registro; com ligado, o registro não é lido pelo motor. RNG idêntico (provado em §11).
* **Limitações do registro:** bruto, sem proveniência, sem decomposição, sem herança por espécie, sem serialização, sem fluxos de energia.

### 3.4 Análise causal (`removalExperiment`)
| item | avaliação |
|---|---|
| Estado inicial idêntico? | Sim: bifurcação por `exportSave/importSave`; original e bifurcado idênticos após 300 ticks, inclusive RNG (padrão e continentes). |
| RNG controlado? | Réplicas = deslocamento de 1…R sorteios de `rng`. Geram trajetórias distintas (hashes diferentes). **`mrng` e `flora.rng` não são deslocados**: em mundos com continentes parte da aleatoriedade é idêntica entre réplicas ⇒ variância subestimada. |
| Atribuição à remoção? | Parcial. A remoção realoca matéria; o duplo destino limita, mas **não elimina** (N2). Efeitos diretos e indiretos (via terceiros) **não** são separados. |
| Replicação | Produção: 3–6 réplicas, limiar |d|>0,1 e >2·EP (z=2 com n pequeno é anticonservador: t₀,₉₇₅(2 gl)=4,3). Auditoria usa 8 réplicas + t de Welch. |
| Falsos positivos por ruído | 0/90 (estimador da auditoria) e 0/30 (regra de produção, N1b) em controle×controle — **mas** é só ruído de RNG, não viés de matéria. |
| Grupos | membros = ids de espécie no instante 0; **especiação durante o horizonte reatribuía organismos** (§9-1). |
| Resposta | biomassa (log da razão); sobrevivência e recrutamento só nesta auditoria. |
| Evidência de consumo | `predFlow` decaído (×0,85/25 ticks) lido em **1** réplica; limiar >0,5 arbitrário. |
| Rótulos | `mutualismo`, `competição`… são *efeitos líquidos de curto prazo*; os critérios 3–5 de mutualismo (atribuição causal, descarte de mudança ambiental geral, persistência) **não** são verificados pela função. |

## 4. Protocolo experimental (pré-registrado)

### 4.1 Regras
* Nenhum parâmetro do motor é alterado. "Knockouts" e "sensibilidade" mudam constantes **apenas dentro do processo de
  auditoria** (objeto `P` em memória, nunca em arquivo) e são rotulados como tal; não são ajustes.
* Os cenários, as sementes, o número de réplicas, as métricas e as regras de decisão abaixo foram fixados antes de rodar.
  Resultados exploratórios da Etapa 5 (que motivaram a escolha de genomas) são declarados como tal: o genoma `O` (osmótrofo
  estrito) já era sabido inviável a longo prazo, por isso o consumidor "viável" é testado também na forma `M` (misotrófico).
* Testes **mecanísticos** (uma causa, um efeito), **de emergência** (o que acontece quando os mecanismos agem juntos),
  **causais** (fatorial de presença/remoção) e **de robustez** (sementes, contextos, nulos, sensibilidade) são reportados separados.
  Um cenário sintético nunca é usado como prova de emergência em mundo natural.

### 4.2 Cenário-base sintético
`emptyWorld` 16×12, `stable`, mutação desligada, `ecology` ligada (salvo knockout), TOPT dos genomas igualado à temperatura
local, aquecimento de 500 ticks, horizonte de 300 ticks. Sementes de mundo **W = {5, 11, 23, 37, 41}**. Réplicas **R = 8**
por condição (deslocamento determinístico do RNG de 1…8 sorteios; os mesmos deslocamentos em todas as condições).
Contextos de nutriente por célula **N ∈ {3, 7, 25}**. Genomas (os mesmos de `tests/ecology-emergence.test.ts`):
`P` fotossintético (PHOTO 0,9), `P2` fotossintético concorrente (PHOTO 0,7, AFFIN 0,8), `O` osmótrofo estrito
(OSMO 0,9, SIZE 0,03, SENSE 0,6, MOTIL 0,3), `M` misotrófico (PHOTO 0,45, OSMO 0,8, SIZE 0,1). Contagens iniciais: P 40, P2 40, O 20, M 20.

### 4.3 Delineamento fatorial e respostas
Para um par (X, Y): condições **ambos presentes**, **−X**, **−Y**, **nenhum** (ambos removidos). A remoção ocorre ao fim
do aquecimento, em bifurcações do MESMO estado; a matéria dos removidos vai (a) ao detrito local ou (b) ao sedimento
(duas análises, nunca misturadas). Respostas do grupo focal (descendentes por `parentId` incluídos, para não perder
indivíduos que mudaram de id de espécie):
1. log da razão de biomassa (fim/início); 2. sobrevivência da coorte inicial (fração dos ids do instante 0 vivos no fim);
3. nascimentos por organismo inicial por tick.
Efeito de X sobre Y = resposta(Y | X presente) − resposta(Y | X removido) (positivo = X beneficia Y), média das R réplicas,
IC de 95% de Welch (quantis t exatos tabelados), por semente de mundo, contexto e destino da matéria.

### 4.4 Regras de decisão (fixas)
* Efeito **detectado** numa célula (semente×contexto×destino): IC95% exclui 0 **e** |efeito de biomassa| ≥ 0,05.
* Efeito **consistente** numa célula: detectado com o mesmo sinal nos DOIS destinos da matéria; se os sinais divergem ou só um destino
  detecta ⇒ **dependente do destino da matéria** (não é atribuído à interação).
* Efeito **robusto** (X→Y): consistente em ≥ 4 das 5 sementes de mundo, no contexto considerado.
* **Mutualismo** só se: X→Y e Y→X robustos e positivos; persistem em ≥ 2 dos 3 contextos; existe evidência de mecanismo
  (fluxo de exsudato de X **e** ingestão de detrito por Y > 0 no registro) e o **knockout do mecanismo** (`EXUDE_K = 0`) reduz ou
  anula o efeito. Caso contrário o resultado é "efeito positivo unilateral/não atribuído", "indeterminado" ou "sem efeito".
* Frequência reportada: nº de sementes (de 5) com efeito detectado, por sinal.

### 4.5 Cenários
* **A — exsudador isolado** (P sozinho; 5 sementes × 3 contextos; ecologia ligada × desligada na mesma semente): fluxo de
  exsudato por biomassa-tick, distribuição da matéria (nutriente/detrito/organismos/sedimento) e biomassa de P.
* **B — consumidor isolado** (O e M sozinhos): sobrevivência/nascimentos com (i) nenhum detrito, (ii) detrito abundante
  (20/célula), (iii) apenas exsudato (sem exsudador ⇒ equivale a i). Pergunta: a estratégia é viável sem fonte acessível?
* **C — exsudador + consumidor**: fatorial P×O e P×M, 3 contextos, 5 sementes, R = 8, mais o **knockout** (`EXUDE_K = 0`).
* **D — mesmo recurso**: fatorial P×P2 (luz/nutriente) e O×O′ (dois osmótrofos, mesmo detrito abundante), 3 contextos, 5 sementes, R = 8.
* **E — refúgio**: (E1) micro-ensaios de captura (200 por condição) no mesmo estado com cobertura vegetal, alternando o termo
  de abrigo ligado/desligado (`ecology` alternada em memória), para presas de raio pequeno e grande, com/sem defesa; resposta =
  taxa de captura por tentativa; (E2) retalho terrestre com predadores e presas, 20 réplicas, abrigo ligado × desligado:
  sobrevivência de presas e predadores, consumo registrado e nascimentos do predador (efeito indireto sobre o consumidor).
* **F — contexto**: os 3 contextos de nutriente em C e D; mais luz −50% para C (`lightFactor`).
* **G — mundos naturais**: `removalExperiment` de produção em mundos padrão (sementes 1–6) e com continentes (1–3), 64×40,
  15 000 ticks, 3 grupos mais abundantes, R = 6; registra eventos de especiação ocorridos DURANTE o horizonte (viés de
  associação de grupo) e a variação entre sementes.

### 4.6 Nulos, placebos e sensibilidade
* **N1 — falso positivo por RNG**: dois conjuntos disjuntos de 8 réplicas de CONTROLE (sem remoção) comparados com a regra de decisão;
  a taxa de "detecção" deve ser ≤ 5%.
* **N2 — viés de matéria**: grupos separados por barreira letal (sem interação possível): magnitude do "efeito" nos dois destinos.
* **N3 — ciclo fútil da osmotrofia**: osmótrofo em `MASS_MAX` num detrito conhecido: energia ganha × detrito irreversivelmente removido.
* **N4 — viés de estratégia**: fração de exsudato por estratégia trófica em mundos naturais; e médias de PHOTO/OSMO/PRED aos 10 000 ticks
  com ecologia ligada × desligada (4 sementes).
* **S — sensibilidade (não é calibração)**: `EXUDE_K` ×0,5 e ×2; `EXUDE_FROM` 0,5 e 0,8, no cenário C (contexto 7, 3 sementes): o
  padrão de sinais muda?

### 4.7 Invariantes
Ecologia desligada: estado de RNG (`rng`, `mrng`, `flora.rng`), hash de estado, eventos e tick idênticos aos do commit anterior
(`68ffeb4`, worktree separado) em 4 configurações; fingerprints de 30 000 ticks; isolamento (serialização completa antes/depois de análises);
bifurcação idêntica ao original com continentes. Ecologia ligada: conservação de massa, ausência de NaN/Infinity/valores negativos
em todas as matrizes, população limitada, suíte completa, longa duração, `tsc`, build e interface.

### 4.8 Desvios e acréscimos ao protocolo (declarados)
| item | tipo | motivo |
|---|---|---|
| detrito inicial vindo do nutriente (≤ 40% por célula) em B/C/D | **desvio** | a versão original tirava do sedimento (≈0) e não entregava o detrito: erro do script, corrigido antes de interpretar |
| genomas `Os` (sessil) e `Ow` (TTOL 0,5) além de `O` | **desvio** | `O` tinha tolerância térmica estreita num mundo-teste de 24–40 °C (confusão) |
| E1: preparar a cobertura antes de inserir organismos | **desvio** | a versão original contava capturas ocorridas nos ticks de preparação (exposição 0) |
| E2: horizonte 40 em vez de 150 ticks | **desvio** | todos os organismos morriam; mesmo assim o resultado foi nulo e é reportado como "não avaliado" |
| N1b (regra de produção em controle×controle), N5 (distribuição do enchimento) | **acréscimo** antes de ver os resultados correspondentes | pergunta da auditoria sobre o limiar e o estimador de produção |
| D com knockout | **acréscimo** | testar se a exsudação beneficia não consumidores |
| H (colonização desde t=0) | **pós-hoc, exploratório** | C mostrou que a remoção só vê o estado atual, que já embute a facilitação |
| reanálise G com correção revisada | **correção** | ver §10 |

## 5. Resultados positivos (com incerteza)

Convenção: efeito de X sobre Y = resposta(Y | X presente) − resposta(Y | X removido); positivo = X beneficia Y. Resposta = log da razão de biomassa em 300 ticks.
5 mundos × R = 8 réplicas por célula; "consistente" = mesmo sinal detectado (IC95% de Welch exclui 0 e |efeito| ≥ 0,05) nos DOIS destinos da matéria.
Dados completos: `docs/experiments/audit5-*.json`.

**D — competição por recurso compartilhado (P × P2, luz e nutriente)** — o único efeito robusto:

| contexto | P→P2 (média±dp entre sementes; IC95% médio) | P2→P | sementes consistentes (negativas) |
|---|---|---|---|
| 3 | −0,650 ± 0,037 (±0,009) | −0,732 ± 0,044 | 5/5 e 5/5 |
| 7 | −0,639 ± 0,038 (±0,007) | −0,751 ± 0,043 | 5/5 e 5/5 |
| 25 | −0,963 ± 0,059 (±0,013) | −0,452 ± 0,039 | 5/5 e 5/5 |

Recrutamento também negativo (5/5); sobrevivência da coorte inalterada (≈ 0). Reciprocidade negativa ⇒ rótulo "competição (efeito líquido)" sustentado. Com `EXUDE_K = 0` os valores são quase os mesmos (−0,70/−0,67; −0,79/−0,60; −1,31/−0,30): a competição **não depende** da exsudação.

**C/H — exsudador P × misotrófico M** (o par que poderia sugerir mutualismo):

| contexto | P→M (detrito; consistência) | M→P | leitura sob o protocolo |
|---|---|---|---|
| 3 | −0,126 ± 0,014; **só num destino** (5/5) | −1,772 ± 0,168; consistente negativo 5/5 | M→P robusto negativo; P→M dependente do destino |
| 7 | −0,280 ± 0,038; só num destino (5/5) | −0,868 ± 0,135; consistente neg. 3/5 (+2 só num destino) | idem (M→P robusto só em 3/5 < 4/5 ⇒ **não robusto**) |
| 25 | −1,409 ± 0,061; consistente neg. 5/5 | −0,005 ± 0,006; ≈ 0 | P prejudica M, M não afeta P ⇒ amensalismo robusto |

**Colonização desde t=0 (H, [pós-hoc], 800 ticks, 5 sementes × 8 réplicas; biomassa final média ± dp entre sementes):**

| contexto | M com P | M sozinho | M com P, **exsudação desligada** | P com M | P sozinho | P com M, exsudação desligada |
|---|---|---|---|---|---|---|
| 3 | 495 ± 14 | 553 ± 10 | 144 ± 16 | 87 ± 12 | 467 ± 3 | 455 ± 18 |
| 7 | 827 ± 59 | 954 ± 52 | 119 ± 18 | 460 ± 50 | 1073 ± 3 | 1245 ± 20 |
| 25 | 561 ± 61 | 2209 ± 146 | **0 (extinto 5/5)** | 3772 ± 53 | 3798 ± 27 | 4638 ± 97 |

Leitura (hipóteses sustentadas pelos números, não fatos): (i) a exsudação **sustenta M** (×3,4 / ×7 / de 0 a 561); (ii) mesmo assim M vai **pior com P do que sozinho** (−10%, −13%, −75%): P é competidor e a exsudação só reduz o dano;
(iii) com exsudação, P colapsa onde M é favorecido (87 vs 467 sozinho, −81%) — M age como **explorador** do subsídio de P e também compete por luz/nutriente; (iv) não há benefício recíproco para P em nenhum contexto.
Isso é uma **assimetria (+ para M, − para P) causalmente atribuída ao mecanismo** (knockout), compatível com "exploração sem consumo direto", **não** com mutualismo. Não foi testado se o resultado muda com M evoluindo.

**Predação/herbivoria:** mecanismos de captura funcionam por tentativa (defesa 0,95: 34/40 vs 40/40 capturas; E1 acima) e o consumo é registrado (ex.: 335 de massa em 250 ticks, semente 2). **Mundos naturais (G, §7)**: 3 de 19 pares mostram "consumo sem benefício líquido detectável".

## 6. Resultados negativos e nulos

* **Mutualismo/comensalismo: nenhum caso** em 5 sementes × 3 contextos × 3 direções de resposta, nem em 19 pares de 9 mundos naturais.
* **Consumidor estritamente osmótrofo inviável** (B): O (TTOL 0,1; MOTIL 0,3; SENSE 0,6), Os (sessil) e Ow (TTOL 0,5) tiveram sobrevivência 0,00 em 300 ticks com 0 e com até 10 de detrito por célula.
  A 1ª versão do script entregava ≈0 detrito (tirava do sedimento, quase vazio) e O/Os tinham tolerância térmica estreita num mundo-teste com 24–40 °C — dois erros de **meu** delineamento, corrigidos antes de interpretar.
  Mesmo corrigidos, nenhum genoma estrito sobreviveu. Conclusão restrita: *nenhum dos 3 genomas testados*; não é prova sobre todo o espaço de genomas. Os cenários C e D com osmótrofos estritos ficam **vazios** (coorte inicial extinta durante o aquecimento).
* **N3 — ciclo fútil herdado da Etapa 1:** um osmótrofo em `MASS_MAX` (2,39) obteve 3,89 de energia em 20 ticks tendo removido de forma líquida só 0,90 de detrito (gêmeo sem organismo como controle): **4,33 de energia por unidade de matéria efetivamente consumida, contra 2,0 de energia embutida por massa**. O motor
  recicla 70% do que ingere (excesso vira detrito e é reingerido). Isto **não é da Etapa 5** (existe com `ecology:false`), mas a exsudação alimenta o ciclo. O invariante "energia ganha ≤ estoque" vale por evento (testado) e **não** por ciclo.
* **N4/N5:** nenhum viés de estratégia mensurável em 4 sementes; em mundos naturais quase todos os organismos são "mixo" ⇒ não dá para separar exsudação por estratégia.
* **S — sensibilidade (não é calibração):** em 15 execuções (5 configurações × 3 sementes, P×M, contexto 7) o efeito no destino *detrito* é negativo em ambas as direções em todas;
  no destino *sedimento* P→M é + (0,07–0,21) exceto `EXUDE_K×2` (≈0) e M→P muda de − para + com `EXUDE_K×2` (+0,14…+0,23). Logo o **rótulo por regra de consistência** muda com os parâmetros (de "robusto negativo" para "dependente do destino"), mas a conclusão qualitativa — *nenhum efeito positivo recíproco robusto* — é estável nas 15.
* **E2 (retalho terrestre) falhou como experimento:** todos os organismos morreram (a 150 ticks do protocolo e a 40 ticks) nos dois braços; efeito indireto do refúgio sobre a cadeia **não avaliado**.

## 7. Mundos naturais (G) e robustez entre sementes

Produção `removalExperiment`, R = 6, horizonte 250, 64×40, 15 000 ticks, 3 espécies mais abundantes. **19 pares** em 9 mundos (6 padrão, 3 com continentes; 4 mundos com < 2 espécies abundantes):
indeterminada **9**, sem efeito detectável **7**, consumo sem benefício líquido detectável **3**, competição 0, mutualismo 0, comensalismo 0. Efeito comum a ≥ 2 sementes: **nenhum**; o único par repetido (predação de #2 sobre #8) aparece numa semente. Um mundo (semente 3) teve 1 espécie nova no horizonte, com **42,5%** da biomassa de um grupo reatribuída (§9-1).
Com a correção final de §10 os **rótulos não mudaram** nos 9 mundos (contagens acima); mudaram só magnitudes (semente 3, A→B: detrito 0,54 → 0,32; sedimento −0,16 → 0,02). A coluna de "viés" das primeiras execuções do script contava filhas que já existiam e foi substituída pela medida correta (fração em espécies criadas durante o horizonte): 0 em 8 mundos e 0,425 num grupo da semente 3.

**Quando uma relação desaparece ou inverte:** com o contexto (nutrientes escassos × abundantes: P×M passa de "competição assimétrica" a "amensalismo"), com o destino da matéria (sinal que muda ⇒ indeterminado), com `EXUDE_K` (S) e com a presença do mecanismo (knockout). Nenhum desses resultados vale para outro tamanho de mundo, outra duração ou evolução ativa (mutação desligada nos sintéticos).

## 8. Limitações estatísticas
* 5 mundos sintéticos por cenário e 8 réplicas por condição; réplicas são deslocamentos do **mesmo** gerador; em mundos com continentes `mrng`/`flora.rng` são idênticos entre réplicas (variância subestimada).
* ICs de Welch com 8 réplicas e variância determinística muito baixa (±0,005–0,05) refletem a variação de **RNG**, não a incerteza sobre o mundo real; entre sementes o desvio-padrão é 3–10× maior (ex.: M→P no contexto 3: ±0,045 vs 0,168).
* Limiares (|efeito| ≥ 0,05; abundância ≥ 15) são arbitrários; não há correção para múltiplas comparações (3 métricas × 2 destinos × 2 direções × 3 contextos).
* Horizontes curtos (300–800 ticks) medem respostas ecológicas, não evolutivas.
* O null real (grupos sem nenhuma interação) **não existe** num mundo de matéria fechada: todos os organismos compartilham o pool de nutrientes (N2). "Sem efeito detectável" só ocorre quando a biomassa removida é pequena em relação ao pool.
* Nenhuma significância estatística formal foi inventada: os IC são descritivos.

## 9. Problemas encontrados

1. **[comprovado, analítico] Troca de rótulo pela especiação.** `removalExperiment` contava a biomassa de um grupo pelos ids de espécie do instante 0; a especiação reatribui organismos a espécies novas. Medido: 1 espécie nova em 250 ticks levou 42,5% da biomassa de um grupo (semente 3); após a correção as magnitudes mudaram no mundo afetado (semente 3) e os rótulos não. **Corrigido (§10).**
2. **[comprovado] O destino da matéria não é eliminado pelo duplo destino.** No par separado por "barreira letal" (N2) o efeito foi negativo e **consistente nos dois destinos em 5/5 sementes** nos contextos 7 e 25 (−0,33 e −0,41). Os grupos compartilham o nutriente que difunde pela barreira ⇒ há competição indireta real por um pool comum (exatamente o que o enunciado da Etapa 5 considera legítimo),
   **não** um "falso positivo". Consequências: (a) a afirmação "falso positivo corrigido" em `docs/ECOLOGIA.md §4` era hipótese e foi retificada lá; (b) o teste `coexistir não é interagir` em `tests/ecology-emergence.test.ts` tem **premissa falsa** (a barreira não isola); ele passa apenas porque o estimador de produção com 3 réplicas é pouco potente (resultado "indeterminada"). **Não foi alterado** (decisão do responsável, §14).
3. **[comprovado] Estatística do estimador de produção.** z = 2 com 3–6 réplicas (t₀,₉₇₅ = 2,8–4,3 gl 4–2); SE degenerado (≈ 0,00) em dinâmica quase determinística; sem placebo de matéria; consumo medido em 1 réplica por `predFlow` decaído. Mitigação: critério de duplo destino. A auditoria usa 8 réplicas e t de Welch.
4. **[comprovado] Rótulo "mutualismo (efeito líquido)"** exige só (+,+); o enunciado exige atribuição causal, descarte de mudança ambiental geral e persistência em condições relevantes. A função não verifica isso. Nenhum mutualismo foi rotulado, mas o rótulo superdeclara.
5. **[comprovado, documentação] Comentário/doc afirmavam "energia saturada e matéria limitante"**; o código testa só saturação (corrigido no comentário e em `ECOLOGIA.md`).
6. **[comprovado, herdado da Etapa 1] Energia levemente negativa**: organismos vivos com energia < 0 ao fim do tick (custo de nadar subtraído após o teste de morte): 458 ocorrências em 3000 ticks com ecologia desligada (mín. −0,014) e 520 ligada (mín. −0,019). Transitório (morrem no tick seguinte); não alterado.
7. **[comprovado, herdado] Ciclo fútil da osmotrofia** (N3).
8. **[limitação] Exsudação quase constitutiva para fotossintéticos** (≈ 3,7·10⁻³ por biomassa·tick; custo de 16–22% de biomassa) — o limiar de 60% é irrelevante para eles; sem justificativa biológica; sem checagem de limitação por nutriente; plantas (`flora`) não exsudam (assimetria).
9. **[erros do meu delineamento, corrigidos antes de interpretar]** detrito inicial entregue ≈ 0 (B/C/D osmotróficos); genomas O/Os com TTOL estreito; bookkeeping de exposição em E1 (capturas em ticks de preparação); E2 sem sobreviventes.
10. **[limitação] Reciprocidade/efeitos diretos × indiretos**: a remoção de A inclui efeitos mediados por terceiros; não há desenho para separá-los.

## 10. Correções realizadas

Apenas uma, de código, no escopo da Etapa 5, na **camada de análise** (o motor não foi tocado):
* `src/core/ecology.ts`: `descendantSet`/`groupBiomass(…, afterId)` — um grupo passa a incluir as espécies descendentes (por `parentId`) **criadas depois do instante 0**; `removalExperiment` usa `groupBiomass` em controle e tratamento. **A 1ª versão desta correção estava errada**: somava também filhas que já existiam no instante 0 (e que a remoção não removia), o que produziu um "comensalismo" espúrio na semente 1 de um mundo natural; foi detectada por inspeção dos resultados, descartada e substituída pela versão com `afterId`. Teste novo em `tests/ecology-emergence.test.ts` (grupo cujos membros trocam para uma espécie filha continua somando a mesma biomassa).
* Comentário em `simulation.ts` (sem mudança de comportamento) e retificações de texto em `docs/ECOLOGIA.md`.
Validação: `tsc` limpo; `ecology-emergence` 9/9 (inclui o teste de grupo cujos membros migram para uma espécie nova e o contraste com uma filha pré-existente); mesmos hashes/RNG com `ecology:false`; reanálise de 9 mundos naturais (G). Nenhuma constante foi alterada; nenhum teste foi removido ou enfraquecido.

## 11. Invariantes preservados

**Ecologia desligada** (comparação com o commit anterior `68ffeb4` em worktree separado, 2500 ticks, 4 configurações — `scratchpad/rngprobe.ts`):

| config | hash:espécies:eventos | `rng` | `mrng` | `flora.rng` |
|---|---|---|---|---|
| padrão s1 | `-11cbfae8:1:3` | 2853694004 | 1540483476 | — |
| padrão s2 40×24 | `-6ed91fbd:1:3` | 3229836014 | 1540483479 | — |
| continentes s3 | `-788883e0:1:11` | 364982043 | 4263182654 | 2686370657 |
| continentes estável s4 | `-1cf9bea8:1:11` | 3915295215 | 3137903398 | 2939011979 |

`diff` entre as saídas do commit anterior e da árvore atual: **idêntico** (nenhum sorteio adicional de RNG).
* Fingerprints de 30 000 ticks (`scripts/fingerprint.ts 30000`, ecologia desligada, rodados na árvore auditada), **idênticos** aos da Etapa 4 e aos de antes da Etapa 5:
  `1: -dbd463e:27:38|pop=11306|species=23/27|max=20755|min=2471|mass=50400.000000`,
  `2: -1f65a2e3:34:54|pop=9429|species=23/34|max=13117|min=4946|mass=50400.000000`,
  `3: -169840b0:38:61|pop=9622|species=19/38|max=34180|min=3895|mass=50400.000000`.
* `physics-lock` (3 sementes) e testes de bifurcação/determinismo: passam (§12).
* **Ecologia ligada** (`scripts/audit-invariants.ts`, 6000 ticks): massa conservada (deriva −4,5·10⁻¹³ padrão; +4,3·10⁻¹³ continentes); população máxima 13 439/40 000 e 9 259/40 000; sem NaN/Inf/negativos em nutriente, detrito, temperatura, luz, reservatório, massas, posições e `ecoFlow`;
  única violação = energia ligeiramente negativa (problema 6, também com ecologia desligada). **Isolamento:** serialização completa (`meta` + todos os arrays) e `rng` idênticos antes/depois de `removalExperiment`. **Bifurcação ≡ original** (hash, `rng`, `mrng`, `flora.rng` idênticos após 300 ticks, nos dois mundos). Réplicas por deslocamento produzem trajetórias distintas.
* Ausência de relações programadas: nenhuma tabela de pares, nenhuma referência a ids de espécies nos mecanismos (`ecomech.ts` recebe só massa, enchimento, cobertura e raio).

## 12. Testes executados (resultados reais)
Todos executados na árvore final (após a correção de §10), sem commit:

| verificação | comando | resultado |
|---|---|---|
| tipos | `npx tsc --noEmit` | limpo |
| build | `npx vite build` | ok (`index-*.js` 104,06 kB) |
| suíte completa | `npx vitest run` | **19 arquivos passam, 195 testes passam**, 12 de longa duração pulados por padrão (sem falhas) |
| longa duração, ecologia desligada | `EVOLVERE_LONG=1 npx vitest run tests/longrun.test.ts` | **6/6 passam** — padrão s1/s2/s3: 23/27, 23/34, 19/38 espécies, massa 50400,000; continentes s1/s2/s3: 1/1, 14/19, 19/22 espécies, massa 50400,000 (idêntico aos números da Etapa 4) |
| longa duração, ecologia ligada | `EVOLVERE_LONG=1 npx vitest run tests/longrun-ecology.test.ts` | **6/6 passam**, números idênticos à execução anterior (determinismo entre execuções): padrão 20/32, 24/32, 1/1; continentes 1/1, 1/1, 19/29; massa 50400,000 |
| fingerprint 30 000 ticks | `npx tsx scripts/fingerprint.ts 30000` | idêntico (§11) |
| `physics-lock` | dentro da suíte | passa (3 sementes) |
| interface | `vite preview --port 4173` + `node scripts/ui-test.mjs` | **129/129** |
| invariantes com ecologia ligada | `npx tsx scripts/audit-invariants.ts` | massa conservada, sem NaN/Inf, isolamento e bifurcação exatos (§11) |
| protocolo da auditoria | `scripts/audit-ecology.ts` A, B, C (O, Os, M, M-knockout), D (phot, osmo, phot-knockout), E, G (padrão e continentes), H, N1–N5, S | resultados em §5–§8; JSON em `docs/experiments/audit5-*.json` |

Observação: o teste `longrun-ecology` imprime a análise de relações ao fim; essa linha usa o `removalExperiment` corrigido. Os testes `tests/ecology-*.test.ts` **não foram removidos nem enfraquecidos**; um deles tem premissa questionada (§9-2) e permanece como está.

## 13. Relações ecológicas — capacidade, evidência e lacunas

| relação | mecanismo existe? | suficiente? | evidência de emergência | demonstrada causalmente? | pode surgir em mundo natural? | falta |
|---|---|---|---|---|---|---|
| Competição | sim (pool comum de nutriente, luz, detrito) | sim | sim: P×P2 5/5 sementes, 3 contextos; indireta mesmo com barreira (N2) | **sim** (remoção, duplo destino, knockout irrelevante) | provável (todos competem pelo pool), mas **não detectada** nos 19 pares naturais com a potência atual | análise com mais réplicas/sementes e horizonte longo |
| Predação | sim (genes de captura/defesa) | parcialmente | consumo registrado (até 391 de massa em 250 ticks); defesa e refúgio alteram a captura | **parcial**: consumo e dano à presa sim; benefício líquido do predador **não** detectado | sim (3/19 pares) | ganho energético mais visível; medição de dinâmica predador–presa |
| Herbivoria | sim (`Flora.graze`) | parcialmente | fluxo 'planta' ≤ 21 em 30 000 ticks (mundos naturais) | não | rara (poucos animais em terra) | mais herbívoros terrestres; não testado nesta auditoria |
| Amensalismo | sim (sombreamento, exaustão de pool) | sim | P→M (contexto 25): 5/5, M não afeta P | **sim** nesse contexto | possível | — |
| Facilitação | **sim** (exsudato → detrito → osmotrofia) | sim para misotróficos | M ×3–∞ com exsudação (knockout) | **sim** (efeito do mecanismo sobre M) | provável onde há misotróficos (todos os naturais são "mixo") | proveniência do detrito |
| Comensalismo | parcial (facilitação sem custo) | **não**: o exsudador sempre paga massa | nenhuma | não | improvável sem custo zero | mecanismo em que o doador não perca |
| Mutualismo | parcial (exsudato + reciclagem) | **não** | nenhuma | não | não observado | retorno ao doador (ex.: nutriente local) maior que o custo; teste de persistência |
| Inquilinismo | parcial (abrigo vegetal) | não: só vegetação em terra, sem estruturas criadas por animais | E1 (−16% a −41% de captura) | efeito direto sim; indireto (E2) **não** | possível em terra | estruturas aquáticas/de animais; E2 válido |
| Parasitismo | **não** (só predação letal) | não | — | — | não | extração não letal com custo ao hospedeiro |
| Relações indiretas | sim (via pool, detrito, decomposição) | sim | N2 (competição através de barreira), H | parcial | sim | separar direto × indireto |
| Dependentes do contexto | sim | sim | P×M: competição→amensalismo com nutrientes; S | sim (sintético) | não testado em natural | — |

## 14. Recomendações e decisões a aprovar antes da Etapa 6

1. **Aprovar/rejeitar:** renomear os rótulos `mutualismo`/`comensalismo`/`competição` para "efeito líquido recíproco positivo/…" e exigir persistência entre contextos antes de rotular; e trocar o teste `coexistir não é interagir` (premissa falsa) por um que use um null válido.
2. **Decisão de arquitetura:** proveniência da matéria (marcar o detrito com a espécie de origem) para rastrear facilitação; e registro de decomposição; serialização de `ecoFlow`.
3. **Decisão de física (exige re-validação completa):** se o ciclo fútil da osmotrofia (N3) deve ser fechado; afeta fingerprints.
4. **Decisão biológica:** exsudação condicionada à limitação de nutriente (a justificativa real do overflow), em vez de só saturação energética; flora exsudar ou não; E2 refeito com população sustentável.
5. **Estatística:** `mrng`/`flora.rng` nas réplicas, t de Student e mais réplicas no estimador de produção, medida de recrutamento/sobrevivência, e placebo de matéria.
6. Antes de qualquer mecanismo novo (parasitismo, abrigo animal), medir o que os atuais já fazem em mundos naturais com mais sementes e horizonte maior.

## 15. Comandos e reprodução
```
npx tsx scripts/audit-ecology.ts A|B|C|D|N1|N1b|N2|N3|N4|N5|E|H|S|G   # ver cabeçalho do script
npx tsx scripts/audit-ecology.ts C --consumer M [--knockout]
npx tsx scripts/audit-ecology.ts D --kind phot [--knockout]
npx tsx scripts/audit-ecology.ts G --seeds 1,2,3,4,5,6 --ticks 15000 [--stage3]
npx tsx scripts/audit-invariants.ts
npx tsx scripts/fingerprint.ts 30000
EVOLVERE_LONG=1 npx vitest run tests/longrun-ecology.test.ts tests/longrun.test.ts --testTimeout=3000000
npx tsc --noEmit && npx vite build && npx vitest run && node scripts/ui-test.mjs   # com `vite preview --port 4173`
```
Saídas: `docs/experiments/audit5-*.json` (inclui `N1`, `N2`, `N3`, `S`, `H`, `G`). Os JSON sintéticos têm todas as células (semente × contexto × métrica × destino).
