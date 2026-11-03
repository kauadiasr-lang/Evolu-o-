import type { Digest } from './digest';

export interface Chronicle {
  title: string;
  text: string;
  source: 'local' | 'ai';
  tick: number;
  warnings?: string[];
}

const TIPO: Record<string, string> = {
  photo: 'fotossintética', mixo: 'mixotrófica', osmo: 'decompositora', pred: 'predadora', none: 'oligotrófica',
};
const pct = (v: number | null) => (v === null ? null : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`);

/**
 * Cronista local: narra o planeta sem rede, usando apenas os fatos do digest.
 * É determinística e serve de fallback quando a IA está desligada ou indisponível.
 */
export function localChronicle(d: Digest): Chronicle {
  const parts: string[] = [];
  let title = 'Crônica do planeta';
  const top = d.especiesPrincipais[0];
  const ext = d.extincoesRecentes;
  const born = d.nascimentosRecentes;
  const big = d.eventos.filter((e) => ['mass_extinction', 'impact', 'eruption', 'crash', 'bloom', 'climate', 'total_extinction'].includes(e.tipo));

  if (d.populacao === 0) {
    return { title: 'O silêncio', text: `Após ${d.idade}, nenhum organismo restou. Os ${d.massa.detritos.toFixed(0)} de matéria orgânica e os nutrientes aguardam, sem ninguém para usá-los.`, source: 'local', tick: d.tick };
  }
  parts.push(`Após ${d.idade}, o oceano abriga ${d.populacao} organismos distribuídos em ${d.especiesVivas} ${d.especiesVivas === 1 ? 'espécie' : 'espécies'}.`);
  if (top) {
    const share = ((top.individuos / Math.max(1, d.populacao)) * 100).toFixed(0);
    parts.push(`${top.nome}, ${TIPO[top.tipo] ?? top.tipo}, é a mais abundante (${top.individuos} indivíduos, ${share}% do total).`);
  }
  const tp = pct(d.tendencias.populacaoVar), tb = pct(d.tendencias.biomassaVar);
  if (tp && tb) {
    const dir = (d.tendencias.biomassaVar ?? 0) > 0.1 ? 'em expansão' : (d.tendencias.biomassaVar ?? 0) < -0.1 ? 'em retração' : 'estável';
    parts.push(`A população variou ${tp} e a biomassa ${tb} no período recente: o ecossistema está ${dir}.`);
  }
  if (big.length) {
    const e = big[big.length - 1];
    title = e.titulo;
    parts.push(e.texto);
  } else if (ext.length) {
    title = `Extinção de ${ext[ext.length - 1].nome}`;
  } else if (born.length) {
    title = `Surge ${born[born.length - 1].nome}`;
  }
  if (born.length) {
    const b = born[born.length - 1];
    parts.push(`Uma nova linhagem, ${b.nome}, divergiu de ${b.origem} no tick ${b.tick}.`);
  }
  if (ext.length) {
    const e = ext[ext.length - 1];
    parts.push(`${e.nome} desapareceu no tick ${e.tick}${e.causa ? ` (causa principal: ${e.causa.toLowerCase()})` : ''}, depois de atingir ${e.pico} indivíduos.`);
  }
  if (d.predacao.length) {
    const p = d.predacao[0];
    parts.push(`Na teia alimentar, ${p.predador} se alimenta principalmente de ${p.presa}.`);
  }
  if (d.biomas && d.biomas.length) {
    const land = d.biomas.filter((b) => !['Abismo', 'Oceano aberto', 'Plataforma costeira', 'Recife / águas rasas ricas'].includes(b.nome)).slice(0, 3);
    if (land.length) parts.push(`Em terra, predominam ${land.map((b) => `${b.nome.toLowerCase()} (${b.percentualSuperficie}% da superfície)`).join(', ')}.`);
  }
  if (d.flora) parts.push(`A flora soma ${d.flora.plantas} plantas em ${d.flora.linhagensVivas} linhagens vivas${d.flora.principais[0] ? `; a mais abundante é ${d.flora.principais[0].nome} (${d.flora.principais[0].forma})` : ''}.`);
  const anat = top?.anatomia?.estruturas?.length ? top.anatomia.estruturas : null;
  if (top && anat) parts.push(`${top.nome} expressa ${anat.join(', ')} (plano corporal ${top.anatomia!.planoCorporal}).`);
  const m = d.mortalidade;
  const total = Object.values(m).reduce((a, b) => a + b, 0) || 1;
  const topCause = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
  if (topCause) {
    const label: Record<string, string> = { starve: 'fome', age: 'envelhecimento', predation: 'predação', thermal: 'estresse térmico', impact: 'catástrofes' };
    parts.push(`A principal causa de morte acumulada é ${label[topCause[0]] ?? topCause[0]} (${((topCause[1] / total) * 100).toFixed(0)}% dos óbitos).`);
  }
  return { title, text: parts.join(' '), source: 'local', tick: d.tick };
}
