# Etapa 5 — Ecologia emergente e relações ecológicas naturais

> **Retificações da auditoria (ver `docs/AUDITORIA_ETAPA_5.md`):** (1) a exsudação é disparada só por saturação energética, não por "matéria limitante"; (2) o teste de "barreira letal" NÃO isola os grupos (o nutriente difunde pela barreira): o efeito que ele mostrou com mais réplicas é competição indireta real por um pool comum, não um "falso positivo"; (3) a afirmação de que osmotrofia estrita é "marginal no motor" vale só para os 3 genomas testados; (4) os rótulos de `ecology.ts` descrevem efeito líquido de curto prazo e não verificam os critérios de mutualismo; (5) `removalExperiment` foi corrigido para não perder biomassa por troca de rótulo na especiação.

Princípio: **nenhuma relação ecológica é programada**. O simulador só contém as condições físicas e biológicas
(recursos limitados, custos de cada estrutura, consumo, morte, decomposição). Rótulos como "predação" ou "competição"
existem apenas na camada de ANÁLISE, que lê resultados medidos — nunca decide o comportamento de um organismo.

> Nota: os arquivos `docs/MATRIZ_COBERTURA.md` e `docs/RELATORIO.md` citados no pedido **não existem** neste repositório
> (só `docs/EXPERIMENTS.md` e `docs/experiments/`). Nada foi inventado para substituí-los; o diagnóstico abaixo se baseia no código.

## 1. Diagnóstico (antes de implementar)

### 1.1 Mecanismos que JÁ existiam (e foram reutilizados)
| mecanismo | onde | observação |
|---|---|---|
| Recursos limitados e esgotáveis | nutriente dissolvido, detrito, luz sombreada por vizinhos (`shade`, `understory`), massa de plantas | consumo reduz a disponibilidade; matéria total conservada (50400) |
| Fontes de energia independentes por gene | `PHOTO`, `OSMO`, `PRED` (cada uma com custo próprio em `COST_MULT`) | um organismo pode combinar fontes (mixotrofia); nada rotula "produtor/consumidor" |
| Predação por compatibilidade | `updateOrganism`: alvo aleatório na célula, razão de massa ≤ 0,45, defesa, velocidade, olhos, camuflagem, escalada | custo de ataque pago por tick; assimilação 55%; resto vira detrito |
| Herbivoria | `Flora.graze`, alcance por altura/escalada | planta perde massa; morte vira detrito |
| Morte e reciclagem | `kill` → detrito → decomposição → nutriente; osmotrofia devolve 30% como nutriente | ciclo de matéria fechado |
| Competição implícita | uso compartilhado de nutriente/detrito/luz/espaço (`crowdFactor`) | sem regra explícita |
| Rede alimentar observada | `predFlow` (massa transferida por par de espécies) | já era só observação |
| Experimentos A×B, bifurcação, rastreadores | Etapa 4 (`experiment.ts`, `diagnostics.ts`) | reutilizados pela análise |

### 1.2 Mecanismos AUSENTES
1. **Nenhuma matéria saía de um organismo vivo** (só na morte): nenhum organismo podia beneficiar outro por seus
   subprodutos em vida — impossível a facilitação via ambiente (base de mutualismo/comensalismo).
2. **Estrutura não oferecia abrigo**: a vegetação sombreava, mas não reduzia a captura de presas pequenas.
3. **Nenhuma contabilidade por espécie de QUEM consumiu QUAL recurso** (só energia por fonte e `predFlow`).
4. **Nenhum método causal** para medir o efeito líquido de um grupo sobre outro (só coexistência/correlações).
5. Parasitismo (extração não letal), construção de abrigos e escolha ativa de presa **continuam ausentes** (ver limitações).

### 1.3 Riscos de alterar a física
`physics-lock` (hash do estado aos 1500 ticks) e o fingerprint de 30 000 ticks exigem bit-identidade. Qualquer
termo novo na fisiologia mudaria ambos. Por isso **todo mecanismo novo está atrás de `SimConfig.ecology` (padrão `false`)**,
sem consumir RNG, e os testes comparam `ecology:false` com o padrão.

### 1.4 Implementação mínima (a que foi feita)
Dois mecanismos gerais, um instrumento de observação e um método de análise — nada específico de espécie:

1. **Exsudação por saturação energética** (`ecomech.exudation`; chamada "excesso metabólico" por analogia, sem verificar limitação por nutriente): quando a energia passa de 60% da capacidade, o corpo vaza
   matéria (proporcional ao excesso) para o detrito local. A matéria é conservada; o organismo paga a perda (menos
   massa). Qualquer organismo com excesso de energia exsuda — não há tipo "produtor". Efeito indireto: o detrito é recurso
   de osmótrofos e vira nutriente por decomposição.
2. **Abrigo estrutural** (`ecomech.refugeFactor`): em terra, a cobertura vegetal da célula reduz a probabilidade de captura;
   quanto menor o raio da presa, maior o abrigo. Depende apenas da vegetação existente (some se as plantas somem).
3. **Registro de fluxos** (`Simulation.ecoFlow`): massa por espécie × (nutriente, detrito, presa, planta, exsudato).
   Só observa.
4. **Análise por remoção causal** (`src/core/ecology.ts`): descrito abaixo.

Custos/benefícios continuam vindo da física existente (ex.: defesa custa manutenção e velocidade; captura custa
`ATTACK_COST` por tick e manutenção de `PRED`). **Nenhuma penalidade de equilíbrio foi adicionada.**

## 2. Contabilidade de energia e matéria
* **Matéria**: conservada (soma de nutriente + detrito + sedimento + organismos + plantas = constante). Testes: deriva < 1e-9
  com ecologia ligada, predação, exsudação e decomposição.
* **Energia**: *não* é conservada (decisão de projeto desde a Etapa 1: entra pela luz e sai dissipada). O que o motor garante
  e os testes verificam: a energia ganha numa captura **não excede o que a presa continha** (`0,4·energia_da_presa +
  0,35·E_PER_MASS·massa`, sempre menor que o estoque dela), e osmotrofia converte só 55% da energia embutida no detrito.
  Limitação documentada: não há um *ledger* energético fechado; apenas esses limites superiores por evento.

## 3. Como as relações podem surgir
* **Consumo / predação / herbivoria**: já emergem de genes (captura, defesa, tamanho, sentidos). Sem rótulo prévio.
* **Competição**: dois grupos que consomem o mesmo nutriente/detrito/luz reduzem a disponibilidade um do outro, mesmo sem
  se encontrarem (nutriente difunde). Não existe termo de competição.
* **Facilitação (base de comensalismo/mutualismo)**: A exsuda → detrito → B (osmótrofo ou misotrófico) ganha energia; a
  decomposição devolve nutriente a A e a B. O saldo para A pode ser positivo, nulo ou negativo (A perde massa; B também compete
  por nutriente) — depende do contexto, e é isso que a análise mede.
* **Inquilinismo/abrigo**: presas pequenas em terra são menos capturadas sob vegetação densa; a planta não é afetada
  diretamente (comensalismo candidato) ou é prejudicada pela herbivoria (consequência indireta).
* **Amensalismo**: sombreamento/esgotamento por um grupo prejudica outro sem benefício aparente.
* **Parasitismo**: *não há mecanismo de extração não letal*; só predação letal. Registrado como limitação.

## 4. Análise: identificar sem determinar (`ecology.ts`)
`removalExperiment(sim, grupos)`:
1. Bifurca o estado (`forkSimulation`). Réplicas diferem só por um deslocamento determinístico do RNG.
2. **Controle**: roda `horizonte` ticks sem mexer. **Tratamento**: remove o grupo A e roda o mesmo horizonte.
3. Mede a mudança do log da biomassa de B (tratamento − controle). O efeito de A sobre B é o **oposto** do efeito da remoção.
4. **Viés de matéria (importante)**: remover A realoca sua matéria. Se ela vira detrito, a remoção parece benéfica aos
   outros (pulso de nutrientes → falso "competição"); se vai ao sedimento, parece prejudicial (falso "mutualismo"). O
   efeito só é aceito se tiver o **mesmo sinal nos dois destinos**; senão é `~` (ambíguo) e a relação fica **indeterminada**.
   Este controle foi adicionado depois de a primeira versão classificar como "competição" dois grupos separados por uma
   barreira letal. **Retificação:** isso foi interpretado como falso positivo, mas a auditoria mostrou que os grupos compartilham o nutriente que difunde pela barreira (competição indireta real); o duplo destino reduz, não elimina, o viés de matéria.
5. Exige abundância mínima (15), ≥3 réplicas, |efeito| > 0,1 e > 2 erros-padrão; abaixo disso: `0` ou `?`.
6. Rótulo: (+,+) mutualismo, (−,−) competição, (+,0) comensalismo, (0,−) amensalismo, (+,−) exploração — "predação"
   apenas se houve **consumo direto registrado**; sem consumo, "exploração sem consumo direto". É sempre um **efeito líquido
   no horizonte medido**, nunca uma propriedade da espécie.

`observedFoodWeb` (rede alimentar a partir da massa efetivamente transferida), `consumptionBetween` (perfil de recursos de
cada espécie numa janela) e `resourceOverlap` (Pianka) complementam a evidência. Nada disso é lido pelo motor.

## 5. Como habilitar
`new Simulation({ ecology: true })`; na interface, caixa "Ecologia emergente" ao criar um mundo (padrão desligada).
`npx tsx scripts/ecology.ts --seeds 1,2,3,4 --ticks 20000 --size 64x40 [--stage3]`.

## 6. Resultados

### 6.1 Testes de mecanismo e de ausência (`tests/ecology-mechanisms.test.ts`, 17 testes, todos passam)
* Consumo reduz o recurso; o fluxo registrado não excede o detrito existente; massa conservada.
* Energia depende do recurso: osmótrofo com detrito vive mais e ingere ≥ 20× mais que sem detrito; sem detrito morre por fome.
* **Ausência**: recurso removido ⇒ consumo para; sem aparato de captura ⇒ nenhum consumo de presa; sem plantas ⇒ sem cobertura
  (0,00) e sem efeito de abrigo; sem o exsudador ⇒ a ingestão derivada dele não é contabilizada.
* Competição: a ingestão de uma espécie cai ≥ 10% quando outra usa o mesmo detrito; competição indireta (células diferentes,
  nutriente compartilhado) reduz o crescimento do outro grupo.
* Defesa altera a captura: 40/40 capturas sem defesa × 34/40 com defesa 0,95 (mesmo predador e presa; efeito real, mas pequeno —
  o predador tem vários ticks e massa muito maior).
* Abrigo: 57/60 capturas sob cobertura × 60/60 sem plantas; a redução por tentativa é de até ~39% (presa de raio 0,72), mas
  a repetição de tentativas dilui o efeito em 12 ticks.
* Ganho energético numa captura ≤ estoque da presa; parte não assimilada volta como detrito.
* Matéria conservada (deriva < 1e-9) em mundos naturais com a ecologia ligada; determinismo por semente; fork/save-load idêntico;
  `ecology:false` idêntico ao padrão.

### 6.2 Testes de emergência (`tests/ecology-emergence.test.ts`, 8 testes, todos passam)
Cenários sintéticos (instrumentos), números impressos nos testes (formato: efeito de A→B com matéria dos removidos como
detrito | como sedimento):

| cenário | resultado medido |
|---|---|
| dois fotossintéticos (nutriente/luz compartilhados) | (−,−) em ambos os limites (0,76|0,20 e 0,64|0,19) ⇒ **competição** |
| exsudador × misotrófico, nutrientes escassos (3/célula) | ambíguo (matéria) ⇒ indeterminada |
| exsudador × misotrófico, nutrientes abundantes (25/célula) | exsudador prejudica o misotrófico (1,52|0,63), sem efeito inverso ⇒ amensalismo (efeito líquido) |
| dois grupos separados por barreira letal | ambíguo ⇒ indeterminada com 3 réplicas (potência baixa); com 8 réplicas a auditoria detecta competição indireta consistente — a barreira não isola o pool de nutrientes |
| caçador × presa (99 de massa consumida) | consumo registrado, mas efeito líquido não distinguível do ruído / ambíguo |
| grupo com 3 organismos | indeterminada (dados insuficientes) |

**Mutualismo NÃO foi observado em nenhum cenário nem em mundo natural.** O par exsudador × misotrófico foi testado em 5 contextos
(nutrientes 3, 7 e 25 por célula; clima −10 e −16 °C na exploração): o saldo foi competição/ambíguo/amensalismo, nunca (+,+).
Isso não é falha: a facilitação por exsudato existe (ingestão medida), mas é superada pela competição por nutriente e luz nas
condições testadas. Também um **resultado negativo**: osmótrofos puros (nos genomas testados; ver auditoria) não se sustentaram (a
captação máxima por tick mal cobre a manutenção), então o detrito exsudado sustenta mixotrofos melhor que detritívoros estritos.

### 6.3 Mundos naturais com ecologia (`scripts/ecology.ts`, 64×40, 20 000 ticks, 4 sementes)
Mundo padrão (`docs/experiments/ecology-64x40-t20000.json`): das 12 relações analisadas — 6 sem efeito detectável, 5 indeterminadas,
**1** "consumo sem benefício líquido detectável" (semente 2: espécie #2 consumiu 179 de massa da #8, prejudicando-a, sem efeito
inverso mensurável). Zero mutualismo, zero comensalismo, zero competição confirmada.
Com continentes (`...-s3-t20000.json`): 7 relações analisadas — 4 indeterminadas, 3 sem efeito; a semente 3 ficou com 1 espécie
(nada a classificar). Mundos de 6 000/8 000 ticks (`...-t6000.json`, `...-s3-t8000.json`): em geral 1 espécie abundante.
Relações **não surgiram** na maioria das sementes e pares; isso é um resultado válido.

### 6.4 Longa duração com ecologia ligada (30 000 ticks, `tests/longrun-ecology.test.ts`, EVOLVERE_LONG=1, 6/6 passam)
Massa final 50400,000 em todas. Fluxos brutos acumulados incluem reciclagem repetida (um osmótrofo reingere o que vazou).

| mundo | sem. | pop final (mín–máx) | espécies vivas/total | predações | exsudato | relações |
|---|---|---|---|---|---|---|
| padrão | 1 | 9 842 (2 428–19 906) | 20/32 | 303 132 | 1,80 M | 1 indeterminada, 2 sem efeito |
| padrão | 2 | 11 720 (4 754–16 965) | 24/32 | 400 403 | 1,68 M | 3 sem efeito |
| padrão | 3 | 8 587 (3 901–30 225) | **1/1** | 422 926 | 2,13 M | nada a classificar |
| continentes | 1 | 6 082 (3 759–18 846) | **1/1** | 263 366 | 1,72 M | nada a classificar |
| continentes | 2 | 7 013 (4 199–23 612) | **1/1** | 220 150 | 2,00 M | nada a classificar |
| continentes | 3 | 10 355 (3 216–23 573) | 19/29 | 206 434 | 1,90 M | 2 indeterminadas, 1 sem efeito |

Comparação com a mesma duração sem ecologia (Etapa 4): padrão 23/27, 23/34, 19/38 espécies vivas/total; continentes 1/1, 14/19, 19/22.
Com ecologia, a semente 3 do mundo padrão e a 2 de continentes terminaram com uma espécie — a ecologia **muda trajetórias**
(esperado: exsudação custa massa aos fotossintéticos), não foi usada para aumentar nem reduzir diversidade, e nenhum parâmetro foi
ajustado depois de ver estes números. Herbivoria registrada em terra foi mínima (≤ 21 de massa em 30 000 ticks).

### 6.5 Verificações de física
* `physics-lock` (3 sementes) passa; fingerprint de 30 000 ticks (ecologia desligada) **idêntico** ao HEAD anterior:
  `1: -dbd463e:27:38|pop=11306|species=23/27|max=20755|min=2471`, `2: -1f65a2e3:34:54|pop=9429|species=23/34|max=13117|min=4946`,
  `3: -169840b0:38:61|pop=9622|species=19/38|max=34180|min=3895` (massa 50400,000000 nas três).
* Suíte completa: 19 arquivos / 194 testes passam (+12 de longa duração pulados por padrão, executados à parte);
  `tsc` limpo; build ok; teste de interface 129/129.

## 7. Limitações e resultados negativos
* Mutualismo e comensalismo não foram observados; os mecanismos permitem facilitação, mas não a produziram (§6.2).
* Parasitismo, construção de abrigos (inquilinismo ativo), escolha ativa de presa e comportamento aprendido **não existem**.
  O abrigo é só vegetação em terra; não há estrutura aquática nem estruturas criadas por animais.
* Sem *ledger* energético fechado: só limites superiores por evento. Nenhum genoma de osmótrofo estrito testado (3) se sustentou; não é prova sobre todo o espaço de genomas.
* A análise é um efeito líquido de curto prazo (≈250–300 ticks) em poucas réplicas determinísticas; o método limita (não elimina)
  o viés de matéria e depende de limiares (|efeito| > 0,1, 2 erros-padrão, abundância ≥ 15). Efeitos lentos/evolutivos não são medidos.
* Análise em mundos naturais é cara (≈ 4 × réplicas × 2 destinos × horizonte ticks por grupo) e só considera as 3 espécies mais abundantes.
* O mecanismo de exsudação muda a economia de matéria dos fotossintéticos; isso é consequência, não meta. A taxa (`EXUDE_K`,
  `EXUDE_FROM`) é uma constante escolhida a priori e não foi calibrada contra resultado.
* Interface: apenas a caixa de criação de mundo; nenhum painel dedicado de ecologia (a análise é por script/testes).
* `docs/MATRIZ_COBERTURA.md` e `docs/RELATORIO.md` não existem no repositório.

## 8. Mudanças de arquitetura
`src/core/ecomech.ts` (novo, funções puras), `src/core/ecology.ts` (novo, análise), `SimConfig.ecology`, `Simulation.ecoFlow`,
`Simulation.removeWhere`, constantes `EXUDE_K/EXUDE_FROM/REFUGE_K` em `params.ts`. Ligações com a IA: **nenhuma** (nem leitura).

## 9. Próximos passos recomendados
1. Mecanismo de extração não letal (parasitismo) e custo/benefício de hospedagem.
2. Estrutura aquática (recifes/colônias sésseis) como abrigo.
3. Ledger energético fechado para testar eficiência trófica globalmente.
4. Janelas de análise mais longas com mais réplicas (e execução em worker) para medir efeitos evolutivos.
5. Painel de ecologia na interface, mostrando fluxos observados e relações como hipóteses com intervalo de confiança.
