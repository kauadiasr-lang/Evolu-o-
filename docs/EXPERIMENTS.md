# Etapa 4 — Experimentos, diagnósticos e resultados

Tudo aqui é **medido** pelo próprio motor (determinístico: mesma semente → mesmos números). Causas apontadas são
*hipóteses compatíveis com os indicadores*, nunca fatos. Nenhum critério de especiação, nenhuma regra de mutação e nenhuma
conservação de massa foi alterada para produzir estes resultados.

## 1. Diagnóstico: por que as sementes 1 e 4 (Etapa 3) terminaram com uma espécie em 30 000 ticks?

Execuções de 30 000 e 60 000 ticks com `scripts/diag-speciation.ts` (indicadores a cada 2 000 ticks).

| semente | espécies @30k | espécies vivas/total @60k | 1ª especiação | var. genética base @30k | mut./nascimento | tfMean (ajuste térmico) | meanSIZE @30k → @60k |
|---|---|---|---|---|---|---|---|
| 1 | **1** | 12/14 | ≈42 800 | 0,205 | 1,26 | 0,94 | 0,42 → 0,60 |
| 2 | 14 | 21/37 | ≈14 400 | 0,216 | 1,23 | 0,96 | 0,50 → 0,72 |
| 3 | 19 | 19/37 | ≈24 000 | 0,224 | 1,18 | 0,94 | 0,40 → 0,59 |
| 4 | **1** | 5/5 | ≈56 100 | 0,325 | 1,32 | 0,95 | 0,42 → 0,68 |
| 5 | 18 | — (só 30k) | ≈17 800 | 0,286 | 1,26 | 0,94 | 0,39 |
| 6 | 19 | — (só 30k) | ≈4 900 | 0,268 | 1,13 | 0,95 | 0,51 |

Com `stage3: false` (física da Etapa 1) as sementes 4, 5 e 6 têm 19, 20 e 15 espécies vivas aos 30 000 ticks (primeira
especiação entre 2 800 e 10 000 ticks).

Leitura (hipóteses sustentadas pelos números):

* **Não é falta de variação nem de mutação**: ≈1,2 mutações por nascimento, variância genética alta e crescente.
* **Não é pressão térmica**: o ajuste térmico médio é ≈0,95 e nenhum organismo está em desajuste (`lowTf` = 0).
* **Não é bug**: com o mesmo código, as duas sementes especiam sozinhas mais tarde (≈42 800 e ≈56 100 ticks) e as
  demais antes. O limiar (razão separação/dispersão ≥ 1,5) *não foi mexido*.
* A divergência só aparece depois que **nichos por tamanho corporal se abrem** (`meanSIZE` ≳ 0,2–0,6 conforme a semente): no
  modo Etapa 3 a luz mais abundante e os recursos distribuídos mantêm uma população grande e homogênea por mais tempo.
  Isto é **estabilidade ecológica legítima**, dependente de tempo e de trajetória — não um defeito.
* Consequência: o teste de longa duração da Etapa 3 deixou de **exigir** mais de uma espécie (a asserção media um
  resultado que a física não garante); continua exigindo população limitada, plantas, colonização vegetal e massa conservada.

## 2. Animais terrestres: foram observados espontaneamente?

Correção de uma afirmação anterior do README ("não ocorreu em 30 000 ticks") que **não havia sido medida**. Dados:

| semente | primeiro "Surgem membros" | "Surgem adaptação terrestre" / "Animais em terra firme" |
|---|---|---|
| 1 | 34 950 | não até 60 000 |
| 2 | 5 150 | 30 425 / 30 525 |
| 3 | 19 675 | 26 675 (animais em terra) |
| 4 | 22 875 | 37 650 (animais em terra; 118 em terra @60k) |
| 5 | 19 375 | ≈19 375 (adaptação terrestre) |
| 6 | 9 375 | não até 30 000 |

Nenhum animal terrestre é introduzido pelo motor. A transição aconteceu espontaneamente em 4 de 6 sementes (2, 3, 4, 5),
em tempos muito diferentes; em algumas a presença em terra regride (ex.: semente 2: 2 em terra @30k, 0 @60k).

### Viabilidade física dos intermediários (`scripts/land-viability.ts`, `tests/land-transition.test.ts`)

* Sem membros expressos ou sem integumento a costa é **barreira** (nada é dado de graça).
* Com membros + algum integumento, o balanço energético em terra é comparável ao do mar (diferença > −0,12) mesmo em
  costa seca (~35% de umidade): os intermediários **não são eliminados pela física**.
* A vida terrestre exige **quatro genes coordenados** (tamanho, motilidade, membros, adaptação terrestre); nenhum subconjunto
  basta. Enquanto isso, os genes de membros/terra são crípticos (neutros).
* Achado: herbivoria pura não sustenta um corpo pequeno (comer vira sobretudo massa; 55% de assimilação). O incentivo
  forte para ir à terra é a luz sem atenuação. Plantas dão vantagem mensurável (vive mais, ganha massa), insuficiente sozinha.

## 3. Experimentos A (estável) × B (alterado)

`runFork`: o mesmo mundo estável (sem estações nem erupções naturais) roda até `changeAt`; o estado é salvo e bifurcado
em A (nada muda) e B (mudança documentada). Mundo 40×24, mudança em t=2500, total 6000, 4 sementes (todas listadas).
`minPop` = menor população ÷ população antes da mudança; `ΔTOPT` = deslocamento da temperatura ótima média (unidade
normalizada 0–1 do gene) de B menos o de A.

### Aquecimento abrupto de +8 °C
| semente | minPop A | minPop B | pop final B | ΔTOPT (B−A) | resposta (ticks) | espécies A/B |
|---|---|---|---|---|---|---|
| 1 | 1,12 | 0,11 | 1,71 | +0,125 | 750 | 4/2 |
| 2 | 1,07 | 0,36 | 1,15 | +0,141 | 1 500 | 2/1 |
| 3 | 1,16 | 0,19 | 2,66 | +0,104 | 1 250 | 6/6 |
| 4 | 1,09 | 0,37 | 1,30 | +0,145 | 750 | 3/4 |

Gargalo claro em todas (população cai 63–89%), recuperação parcial e deslocamento seletivo da temperatura ótima na direção
da mudança — sem nenhuma edição de genes. A linha estável A permanece ≥ 1,07 da população inicial.

### Aquecimento gradual de +8 °C
Gargalos bem menores (minPop B 0,64 / 0,83 / 1,13 / 0,93); ΔTOPT +0,146 / +0,125 / +0,109 / +0,154; resposta 1 500 / 2 250 /
**sem resposta detectada (semente 3)** / 2 000 ticks. Resposta não é garantida em todas as sementes e não é exigida.

### Aquecimento abrupto de +25 °C
**Extinção total em 4/4 sementes** (linha A continua normal). Registro de causa provável pelas mortes recentes (hipótese).

### Luz −50% (abrupta)
minPop B 0,09 / 0,15 / 0,18 / 0,19; população final B 0,62 / 0,57 / 1,22 / 0,70 (relativa ao início); espécies A→B: 4→1,
2→5, 6→1, 3→3; |ΔTOPT| < 0,08 — queda de energia sem adaptação térmica (nada inventado).

### Esgotamento de 60% dos nutrientes dissolvidos (sequestrados no sedimento; massa conservada; `docs/experiments/nutrients-*.json`)
Efeito heterogêneo: pop final B/A = 0,86 / 0,79 / 0,46 / 0,93 por semente; espécies A→B 4→4, 2→1, 6→5, 3→2.

### Aridez: fator de chuva 0,35 (modo Etapa 3, 48×30, gradual, mudança em t=3000, total 7000; `docs/experiments/aridity-*.json`)
Nessa janela (4 000 ticks pós-mudança) **sem efeito mensurável sobre a população** (minPop B ≥ 1,0 em 4/4) e sem extinção;
o efeito de aridez aparece sobretudo em solo/vegetação/biomas (ver `tests/biomes.test.ts`). Resultado registrado como está.

Em todos os cenários a deriva de massa fica em ≈2,4·10⁻¹³ (arredondamento de ponto flutuante).

## 4. Isolamento geográfico (`runIsolation`, `tests/isolation.test.ts`)

Duas bacias separadas por barreiras térmicas letais; controle = mesmo clima nas duas; tratamento = ±6 °C. Mundo 64×30, 5 000 ticks.

| semente | controle: D / razão / espécies | divergente: D / razão / espécies | bacias ocupadas (O/L) |
|---|---|---|---|
| 1 | 0,072 / 1,09 / 1 | 0,105 / 1,18 / 1 | ambas |
| 2 | — (só oeste) / 4 | — (só oeste) / 1 | apenas uma |
| 3 | — (só oeste) / 2 | — (só oeste) / 1 | apenas uma |
| 4 | 0,081 / 1,07 / 1 | **0,119 / 1,56 / 4** | ambas |

Onde as duas bacias foram povoadas (sementes 1 e 4), a seleção divergente **aumentou a distância genética** entre elas;
somente na semente 4 a razão passou de 1,5 e houve especiação (3 eventos). Na semente 1 a divergência cresceu mas não bastou
(razão 1,18). Nas sementes 2 e 3 a vida colonizou uma só bacia, então não há isolamento a medir (as espécies do controle
nesses casos nascem por nichos dentro da mesma bacia).

## 5. Reprodução

```
npx tsx scripts/experiment.ts temperature --seeds 1,2,3,4 --value 8 --abrupt --size 40x24 --at 2500 --total 6000
npx tsx scripts/experiment.ts isolation   --seeds 1,2,3,4 --value 6 --size 64x30 --total 5000
npx tsx scripts/land-viability.ts
npx tsx scripts/diag-speciation.ts <semente> [off]
```
Os JSON completos (séries temporais por amostra) estão em `docs/experiments/`.

## 6. Limitações

* Poucas sementes (4–6); os resultados descrevem tendências, não probabilidades.
* O deslocamento de TOPT e o `tfMean` sofrem viés de sobrevivência (só os sobreviventes são contados).
* Mundos de 40×24 são pequenos: a recuperação depende de refúgios; mundos grandes não foram varridos exaustivamente.
* A causa provável de extinção usa a composição das mortes recentes — é indício, não prova.
* O experimento de aridez no modo Etapa 3 foi curto; efeitos de longo prazo sobre biomas/espécies não foram medidos.
* Os rastreadores de aptidão por traço (`FitnessTracker`) são opcionais e só observam; não alteram a simulação.
