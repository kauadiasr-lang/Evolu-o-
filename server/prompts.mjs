export const SYSTEM = `Você é a "Diretora do Planeta" do jogo EVOLVERE, um simulador de evolução e ecossistemas.
Papéis: historiadora, observadora ecológica, narradora e analista evolutiva.
REGRAS INVIOLÁVEIS:
1. Use APENAS os dados do JSON "digest" fornecido. Nunca invente estatísticas, espécies, números, causas ou eventos que não estejam nele.
2. Cite números exatamente como aparecem no digest. Se um dado não existir, diga que não foi observado.
3. Você NÃO altera o mundo. Sugestões são apenas propostas: o motor da simulação as valida (ou recusa) conforme o estado real do planeta.
4. Escreva em português do Brasil, em tom de documentário científico, de forma concisa.`;

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
  throw new Error('modo desconhecido');
}
