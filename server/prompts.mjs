export const SYSTEM = `Você é a "Diretora do Planeta" do jogo EVOLVERE, um simulador de evolução e ecossistemas.
Papéis: historiadora, observadora ecológica, narradora e analista evolutiva.
REGRAS INVIOLÁVEIS:
1. Use APENAS os dados do JSON "digest" fornecido. Nunca invente estatísticas, espécies, números, causas ou eventos que não estejam nele.
2. Cite números exatamente como aparecem no digest. Se um dado não existir, diga que não foi observado.
3. Você NÃO altera o mundo. Sugestões são apenas propostas: o motor da simulação as valida (ou recusa) conforme o estado real do planeta.
4. Escreva em português do Brasil, em tom de documentário científico, de forma concisa.`;

export const MODES = ['chronicle', 'ask', 'hypotheses', 'events', 'describe'];

export function buildPrompt(mode, digest, question) {
  const data = JSON.stringify(digest);
  if (mode === 'chronicle') {
    return `Dados reais do planeta (digest):\n${data}\n\nEscreva a crônica do período recente em 1 parágrafo de 4 a 7 frases. Primeira linha: um título curto e evocativo (sem aspas, sem markdown). Depois uma linha em branco e o texto. Interprete as causas apenas quando os dados (eventos, tendências, teia alimentar, mortalidade) as sustentarem.`;
  }
  if (mode === 'ask') {
    return `Dados reais do planeta (digest):\n${data}\n\nPergunta do jogador: ${String(question).slice(0, 400)}\n\nResponda com base somente no digest, em até 6 frases. Se os dados não permitirem responder, diga o que falta observar.`;
  }
  if (mode === 'hypotheses') {
    return `Dados reais do planeta (digest):\n${data}\n\nFormule 2 a 3 hipóteses evolutivas ou ecológicas plausíveis, cada uma em 1-2 frases, ancoradas nos dados. Em seguida, em um bloco \`\`\`json, liste até 3 sugestões de intervenção/experimento no formato:\n[{"type":"climate_shift","deltaT":-2,"rationale":"..."},{"type":"adaptation","speciesId":<id do digest>,"gene":"DEFENSE","delta":0.06,"individuals":3,"rationale":"..."}]\nTipos permitidos: climate_shift (|deltaT|<=6), eruption (x,y,amount), adaptation (gene entre SIZE,PHOTO,OSMO,PRED,MOTIL,SENSE,META,REPRO,INVEST,TOPT,TTOL,DEFENSE,AFFIN,LONGEV,ELONG,FLAG,SPIKE; |delta|<=0.12). O motor pode recusá-las.`;
  }
  if (mode === 'events') {
    return `Dados reais do planeta (digest):\n${data}\n\nVocê pode propor até 2 ACONTECIMENTOS ECOLÓGICOS como entradas ambientais. Eles NÃO garantem resultado: a simulação decide quem sobrevive. Escolha apenas o que os dados sustentam (ex.: nutrientes escassos, temperatura incompatível com a espécie dominante, pressão que favoreça uma adaptação já presente). Responda SOMENTE com um bloco \`\`\`json contendo uma lista (pode ser vazia) de objetos:\n- {"type":"climate_shift","deltaT":-2,"title":"...","narrative":"1-2 frases","rationale":"..."}  (|deltaT|<=6)\n- {"type":"nutrient_upwelling","x":40,"y":30,"radius":4,"amount":60,"title":"...","narrative":"...","rationale":"..."}  (amount<=150, radius 1-8, coordenadas dentro do mapa; usa sedimento: ${'`massa.sedimento`'} do digest)\n- {"type":"eruption","x":..,"y":..,"amount":..,"title":"...","narrative":"...","rationale":"..."} (só se pressaoGeologica estiver alta)\n- {"type":"adaptation","speciesId":<id>,"gene":"DEFENSE","delta":0.06,"individuals":3,"title":"...","narrative":"...","rationale":"..."}\nO motor valida cada item e pode recusá-lo. Não invente números fora do digest.`;
  }
  if (mode === 'describe') {
    return `Dados reais do planeta (digest):\n${data}\n\nDescreva em 3 a 5 frases, em tom de naturalista, o organismo mais característico da espécie indicada na pergunta: "${String(question).slice(0, 120)}" (ou a mais abundante, se vazia). Use somente os traços numéricos do digest (0 a 1) para inferir forma e hábitos; não invente números.`;
  }
  throw new Error('modo desconhecido');
}
