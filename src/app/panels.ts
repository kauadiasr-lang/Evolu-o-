import { GENE_INFO, G } from '../core/genome';
import { DEATH_LABEL } from '../core/simulation';
import { TROPHIC_LABEL, type Trophic } from '../core/species';
import type { SimEvent } from '../core/stats';
import { drawCreature, portraitScale } from '../render/morphology';
import { fmt } from '../render/charts';
import { formatAge } from '../ai/digest';
import { BIOME_INFO } from '../core/biomes';
import { PLANT_GENE_INFO } from '../core/flora';
import type { FloraLineageInfo, InspectInfo, PlantInfo, SpeciesInfo, StatsPayload } from '../worker/protocol';
import { drawPlantPortrait } from '../render/plants';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Vantagem / custo de cada adaptação (o jogador vê que nada é grátis). */
export const GENE_NOTES: Partial<Record<keyof typeof G, [string, string]>> = {
  SIZE: ['alcança presas maiores, guarda mais reservas, escapa de predadores pequenos', 'exige mais alimento, reproduz-se devagar e nada mais lentamente'],
  PHOTO: ['transforma luz em energia', 'pigmentos custam manutenção; inútil no escuro e à sombra de vizinhos'],
  OSMO: ['vive de detritos e restos', 'depende de mortes anteriores; compete com a decomposição'],
  PRED: ['obtém massa e energia de outras células', 'maquinário caro, ataques gastam energia, precisa de presas menores'],
  MOTIL: ['migra atrás de luz, comida e temperatura ideal', 'flagelos custam energia constante'],
  SENSE: ['orienta a migração (quimiotaxia)', 'receptores custam manutenção'],
  TTOL: ['tolera faixas amplas de temperatura', 'enzimas versáteis custam manutenção'],
  TOPT: ['desempenho máximo na temperatura ótima', 'cai bruscamente fora da faixa'],
  DEFENSE: ['reduz a chance de ser predada', 'parede pesada: mais lenta e mais cara'],
  AFFIN: ['absorve nutrientes mesmo quando escassos', 'transportadores caros'],
  LONGEV: ['vive mais tempo e deixa mais descendentes', 'reparo celular custa manutenção'],
  SPIKE: ['espinhos dificultam a predação', 'custo de manutenção e peso'],
  SEGM: ['natação ondulatória em corpos alongados; permite corpos maiores', 'cada segmento custa manutenção; exige corpo alongado'],
  LIMBS: ['locomoção em terra, apoio, braços radiais', 'exigem tamanho e motilidade; custo por par e pelo comprimento'],
  FINS: ['velocidade na água', 'exigem motilidade; custo de manutenção alto'],
  EYES: ['caça mais eficaz', 'exigem quimiotaxia; custo de manutenção'],
  CAMO: ['reduz a captura quando o corpo combina com o substrato', 'só funciona sobre o fundo certo; custo de pigmentação'],
  CLIMB: ['alcança folhas altas e foge de predadores de solo', 'exige membros longos; custo de manutenção'],
  TERR: ['sobrevive fora d\'água (sem dessecar)', 'integumento caro, inútil no mar; exige membros'],
  ANTENNA: ['melhora a percepção', 'exigem quimiotaxia'],
  TAIL: ['propulsão em corpos alongados', 'exige motilidade; custo de manutenção'],
  HEAD: ['concentra os órgãos dos sentidos (olhos/antenas mais eficazes)', 'exige olhos ou antenas; custo'],
};

/** Estruturas expressas: o que cada uma custa e o que oferece (anatomia = fenótipo, não genes brutos). */
export const STRUCT_NOTES: Record<string, [string, string]> = {
  segmentos: ['natação ondulatória; corpos maiores', 'manutenção por segmento'],
  membros: ['locomoção em terra / braços radiais', 'manutenção por par'],
  nadadeiras: ['mais velocidade na água', 'manutenção alta'],
  olhos: ['caça mais eficaz', 'manutenção'],
  camuflagem: ['menos captura se casar com o fundo', 'pigmentação cara'],
  escalada: ['alcança folhas altas; evita predadores de solo', 'manutenção'],
  'adaptação terrestre': ['vive fora d\'água', 'integumento caro'],
  antenas: ['percepção', 'manutenção'],
  'cauda propulsora': ['propulsão', 'manutenção'],
  cefalização: ['sentidos mais eficazes', 'manutenção'],
};

export function drawPortrait(canvas: HTMLCanvasElement, vis: ArrayLike<number>, t: number, R?: number): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const radius = R ?? Math.min(portraitScale(vis, 0, Math.min(w, h)), Math.min(w, h) * (0.16 + 0.12 * (vis[0] / 255)) * 1.4);
  drawCreature(ctx, vis, 0, w / 2, h / 2, radius, 0.3 * Math.sin(t * 0.6), t);
}

const tagClass = (t: string) => t;
const pct = (v: number, tot: number) => (tot > 0 ? (v / tot) * 100 : 0);

export function speciesListHtml(st: StatsPayload, selected: number, showExtinct: boolean): string {
  const alive = st.species.filter((s) => s.extinctTick < 0 && s.count > 0).sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...alive.map((s) => s.count));
  const row = (s: SpeciesInfo, dead: boolean) => `
    <div class="sp${s.id === selected ? ' sel' : ''}" data-sp="${s.id}">
      <canvas width="92" height="92" data-vis="${s.vis.join(',')}"></canvas>
      <div>
        <div class="nm" style="${dead ? 'opacity:.55' : ''}">${esc(s.name)}</div>
        <div class="meta"><span class="tag ${tagClass(s.trophic)}">${TROPHIC_LABEL[s.trophic as Trophic]}</span><span class="mono">${dead ? '† ' + formatAge(s.extinctTick) : fmt(s.count)}</span></div>
        ${dead ? '' : `<div class="bar"><i style="width:${(s.count / max) * 100}%"></i></div>`}
      </div>
    </div>`;
  let html = `<h4>Espécies vivas (${alive.length})</h4>` + alive.slice(0, 40).map((s) => row(s, false)).join('');
  if (alive.length > 40) html += `<div class="muted" style="padding:4px 6px">… e mais ${alive.length - 40} espécies menores</div>`;
  const dead = st.species.filter((s) => s.extinctTick >= 0).sort((a, b) => b.extinctTick - a.extinctTick);
  if (dead.length) {
    html += `<h4>Extintas (${dead.length}) <button id="tg-ext" style="padding:1px 7px;font-size:11px">${showExtinct ? 'ocultar' : 'mostrar'}</button></h4>`;
    if (showExtinct) html += dead.slice(0, 25).map((s) => row(s, true)).join('');
  }
  return html;
}

export function speciesDetailHtml(st: StatsPayload, sp: SpeciesInfo): string {
  const byId = new Map(st.species.map((s) => [s.id, s]));
  const chain: string[] = [];
  for (let p = sp.parentId; p; p = byId.get(p)?.parentId ?? 0) chain.push(esc(byId.get(p)!.name));
  const [l, d, p] = sp.src;
  const tot = l + d + p;
  const genes = GENE_INFO.map((g, i) => ({ ...g, i, v: sp.centroid[i] }));
  const fn = genes.filter((g) => g.i <= G.LONGEV && g.key !== 'MUT' && g.key !== 'INVEST' && g.key !== 'REPRO' && g.key !== 'META');
  const notable = genes.filter((g) => GENE_NOTES[g.key] && g.i <= G.LONGEV && g.key !== 'MUT').sort((a, b) => b.v - a.v).slice(0, 4);
  return `
  <div class="card">
    <div class="detail">
      <canvas id="detail-portrait" width="240" height="240"></canvas>
      <div>
        <h3>${esc(sp.name)}</h3>
        <span class="tag ${sp.trophic}">${TROPHIC_LABEL[sp.trophic as Trophic]}</span>
        <div class="kv" style="margin-top:6px">
          <span>Indivíduos</span><span>${sp.extinctTick >= 0 ? '† extinta' : fmt(sp.count)}</span>
          <span>Pico</span><span>${fmt(sp.peak)}</span>
          <span>Surgiu há</span><span>${formatAge(st.tick - sp.bornTick)}</span>
          ${sp.extinctTick >= 0 ? `<span>Causa</span><span>${esc(sp.cause)}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="row"><button id="btn-compare" style="padding:2px 9px;font-size:11px">Comparar com…</button></div>
    ${chain.length ? `<div class="muted" style="margin-top:6px;font-size:11px">Ancestrais: ${chain.map((c) => `<i>${c}</i>`).join(' ← ')}</div>` : '<div class="muted" style="margin-top:6px;font-size:11px">Linhagem fundadora do planeta.</div>'}
    <h4>Anatomia expressa · plano corporal: ${esc(sp.plan)}</h4>
    ${sp.structures.length ? sp.structures.map((st) => { const k = st.replace(/ \(\d+\)$/, ''); const n = STRUCT_NOTES[k]; return `<div class="trade"><strong style="color:#cfe0f5">${esc(st)}:</strong> <b>+ ${n ? n[0] : ''}</b>; <u>− ${n ? n[1] : ''}</u></div>`; }).join('') : '<div class="muted" style="font-size:11px">Sem estruturas especializadas expressas (corpo unicelular simples).</div>'}
    <h4>Mudanças entre gerações</h4>
    <div class="trail" id="trail-strip" data-sp="${sp.id}"><span class="muted" style="font-size:11px">carregando linhagem…</span></div>
    <h4>Estratégia alimentar realizada</h4>
    ${tot > 0 ? `<div class="stack"><i style="width:${pct(l, tot)}%;background:#ffd36b" title="Luz"></i><i style="width:${pct(d, tot)}%;background:#b08a5a" title="Detritos"></i><i style="width:${pct(p, tot)}%;background:#ef6a6a" title="Presas"></i></div><div class="legendrow"><span><em style="background:#ffd36b"></em>luz ${pct(l, tot).toFixed(0)}%</span><span><em style="background:#b08a5a"></em>detritos ${pct(d, tot).toFixed(0)}%</span><span><em style="background:#ef6a6a"></em>presas ${pct(p, tot).toFixed(0)}%</span></div>` : '<div class="muted">Sem dados recentes.</div>'}
    <h4>Genoma médio</h4>
    ${genes.filter((g) => g.i <= G.LONGEV || (sp.structures.length > 0 && g.i > G.SYMM)).map((g) => `<div class="gene"><span>${g.label}</span><div class="gb"><i style="width:${g.v * 100}%"></i></div><span>${g.v.toFixed(2)}</span></div>`).join('')}
    <h4>Custos e benefícios</h4>
    ${notable.map((g) => `<div class="trade"><strong style="color:#cfe0f5">${g.label} ${g.v.toFixed(2)}:</strong> <b>+ ${GENE_NOTES[g.key]![0]}</b>; <u>− ${GENE_NOTES[g.key]![1]}</u></div>`).join('')}
  </div>`;
}

export function inspectHtml(i: InspectInfo): string {
  return `
  <div class="card">
    <div class="detail">
      <canvas id="inspect-portrait" width="240" height="240"></canvas>
      <div>
        <h3 style="font-size:13px">Organismo #${i.id}</h3>
        <div class="muted" style="font-style:italic">${esc(i.speciesName)}</div>
        <div class="kv" style="margin-top:6px">
          <span>Geração</span><span>${i.gen}</span>
          <span>Idade</span><span>${i.age} / ${i.lifespan.toFixed(0)}</span>
          <span>Massa</span><span>${i.mass.toFixed(2)}</span>
          <span>Energia</span><span>${i.energy.toFixed(2)}</span>
          <span>Temp. local</span><span>${i.tempHere.toFixed(1)}°C</span>
          <span>Temp. ótima</span><span>${i.tempOpt.toFixed(1)}°C</span>
          <span>Ajuste térmico</span><span>${(i.tf * 100).toFixed(0)}%</span>
          <span>Plano corporal</span><span>${esc(i.plan)}</span>
        </div>
      </div>
    </div>
    ${i.structures.length ? `<div class="legendrow" style="margin-top:6px">${i.structures.map((s) => `<span class="tag">${esc(s)}</span>`).join(' ')}</div>` : ''}
    ${i.deviations.length ? `<h4>Variação individual (vs. média da espécie)</h4>${i.deviations.map((d) => `<div class="gene" style="grid-template-columns:130px 1fr 44px"><span>${esc(d.label)}</span><div class="gb"><i style="width:${Math.min(100, Math.abs(d.delta) * 250)}%;background:${d.delta > 0 ? '#6fd68a' : '#ef6a6a'}"></i></div><span>${d.delta > 0 ? '+' : ''}${d.delta.toFixed(2)}</span></div>`).join('')}` : '<div class="muted" style="font-size:11px;margin-top:6px">Genoma praticamente igual à média da espécie.</div>'}
  </div>`;
}

export function ecoHtml(st: StatsPayload, m0: number): string {
  const m = st.mass;
  const plants = m.plants ?? 0;
  const tot = m.organisms + m.nutrient + m.detritus + m.reservoir + plants;
  const dev = m0 > 0 ? ((tot - m0) / m0) * 100 : 0;
  const deaths = Object.entries(st.deaths) as [keyof typeof DEATH_LABEL, number][];
  const dTot = deaths.reduce((a, [, v]) => a + v, 0) || 1;
  const h = st.history.series;
  const last = (k: string) => (h[k]?.length ? h[k][h[k].length - 1] : 0);
  const tr = [last('nPhoto'), last('nMixo'), last('nOsmo'), last('nPred')];
  const trTot = tr.reduce((a, b) => a + b, 0) || 1;
  const colors = ['#6fd68a', '#b5e08a', '#e8c58a', '#ef6a6a'];
  const names = ['Fotossintéticos', 'Mixotróficos', 'Decompositores', 'Predadores'];
  const causeColor: Record<string, string> = { starve: '#e8b64a', age: '#9ad0ff', predation: '#ef6a6a', thermal: '#ff8a4d', impact: '#a07cf0' };
  return `
  <h4>Ciclo da matéria (conservada)</h4>
  <div class="card">
    <div class="stack">
      <i style="width:${pct(m.organisms, tot)}%;background:#6fd68a" title="Organismos"></i>
      <i style="width:${pct(plants, tot)}%;background:#2f9e4f" title="Plantas"></i>
      <i style="width:${pct(m.nutrient, tot)}%;background:#4dd6c4" title="Nutrientes"></i>
      <i style="width:${pct(m.detritus, tot)}%;background:#b08a5a" title="Detritos"></i>
      <i style="width:${pct(m.reservoir, tot)}%;background:#6a7a96" title="Sedimento"></i>
    </div>
    <div class="legendrow">
      <span><em style="background:#6fd68a"></em>animais/protistas ${fmt(m.organisms)}</span>${plants > 0 ? `<span><em style="background:#2f9e4f"></em>plantas ${fmt(plants)}</span>` : ''}<span><em style="background:#4dd6c4"></em>nutrientes ${fmt(m.nutrient)}</span>
      <span><em style="background:#b08a5a"></em>detritos ${fmt(m.detritus)}</span><span><em style="background:#6a7a96"></em>sedimento ${fmt(m.reservoir)}</span>
    </div>
    <div class="kv" style="margin-top:8px"><span>Massa total</span><span>${fmt(tot)}</span><span>Desvio desde o início</span><span>${dev.toFixed(6)}%</span></div>
    <div class="muted" style="font-size:11px;margin-top:4px">Organismos não criam nem destroem matéria: apenas a reciclam (nutriente → vida → detrito → nutriente → sedimento).</div>
  </div>
  <h4>Composição trófica (indivíduos)</h4>
  <div class="card">
    <div class="stack">${tr.map((v, i) => `<i style="width:${pct(v, trTot)}%;background:${colors[i]}" title="${names[i]}"></i>`).join('')}</div>
    <div class="legendrow">${tr.map((v, i) => `<span><em style="background:${colors[i]}"></em>${names[i]} ${fmt(v)}</span>`).join('')}</div>
  </div>
  <h4>Causas de morte (acumulado)</h4>
  <div class="card">
    ${deaths.map(([k, v]) => `<div class="gene" style="grid-template-columns:110px 1fr 56px"><span>${DEATH_LABEL[k]}</span><div class="gb"><i style="width:${pct(v, dTot)}%;background:${causeColor[k]}"></i></div><span>${fmt(v)}</span></div>`).join('')}
  </div>
  <h4>Evolução</h4>
  <div class="card"><div class="kv">
    <span>Nascimentos</span><span>${fmt(st.births)}</span><span>Mutações ocorridas</span><span>${fmt(st.mutations)}</span>
    <span>Espécies já existentes</span><span>${st.speciesTotal}</span><span>Extintas</span><span>${st.speciesTotal - st.speciesAlive}</span>
    <span>Geração máxima</span><span>${st.maxGen}</span>
  </div></div>`;
}

const EV_ICON: Record<string, string> = { adaptation: '🦎', biome: '🌍', flora: '🌿', ai_event: '✦', ai_impact: '📊', speciation: '🧬', extinction: '☠', mass_extinction: '☄', bloom: '🌱', crash: '📉', eruption: '🌋', impact: '☄', climate: '🌡', user: '✋', dominance: '👑', milestone: '★', total_extinction: '⚠', anagenesis: '↻' };

export function eventsHtml(events: SimEvent[], filter: string): string {
  const list = events.filter((e) => filter === 'all' || e.type === filter || (filter === 'ext' && /extinction/.test(e.type))).slice(-120).reverse();
  if (!list.length) return '<div class="muted">Nenhum evento registrado ainda. A história do planeta começa agora.</div>';
  return list
    .map(
      (e) => `<div class="ev ${e.type}${e.speciesId ? ' has' : ''}" ${e.speciesId ? `data-sp="${e.speciesId}"` : ''}>
      <span class="t">${EV_ICON[e.type] ?? '•'} ${formatAge(e.tick)} · tick ${e.tick}</span><b>${esc(e.title)}</b><p>${esc(e.text)}</p></div>`,
    )
    .join('');
}

export { drawCreature };


// ---------------------------------------------------------------- Etapa 3: comparação, flora e biomas
const keyGenes = (st: SpeciesInfo[]) => st;
void keyGenes;

export function compareHtml(a: SpeciesInfo, b: SpeciesInfo): string {
  const diffs = GENE_INFO.map((g, i) => ({ g, i, d: b.centroid[i] - a.centroid[i] }))
    .filter((x) => Math.abs(x.d) > 0.04)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
    .slice(0, 9);
  const sa = new Set(a.structures.map((s) => s.replace(/ \(\d+\)$/, ''))), sb = new Set(b.structures.map((s) => s.replace(/ \(\d+\)$/, '')));
  const onlyA = [...sa].filter((x) => !sb.has(x)), onlyB = [...sb].filter((x) => !sa.has(x));
  return `
  <h4>Comparação</h4>
  <div class="card">
    <div class="cmp">
      <div><canvas id="cmp-a" width="200" height="200"></canvas><div class="nm">${esc(a.name)}</div><div class="muted">${TROPHIC_LABEL[a.trophic as Trophic]} · ${esc(a.plan)}</div></div>
      <div><canvas id="cmp-b" width="200" height="200"></canvas><div class="nm">${esc(b.name)}</div><div class="muted">${TROPHIC_LABEL[b.trophic as Trophic]} · ${esc(b.plan)}</div></div>
    </div>
    <h4>Genes que mais divergem (B − A)</h4>
    ${diffs.length ? diffs.map((x) => `<div class="gene" style="grid-template-columns:130px 1fr 44px"><span>${esc(x.g.label)}</span><div class="gb"><i style="width:${Math.min(100, Math.abs(x.d) * 200)}%;background:${x.d > 0 ? '#6aa8ff' : '#e8b64a'}"></i></div><span>${x.d > 0 ? '+' : ''}${x.d.toFixed(2)}</span></div>`).join('') : '<div class="muted">Genomas muito parecidos.</div>'}
    <div class="legendrow" style="margin-top:6px">
      ${onlyA.length ? `<span>só A: ${onlyA.map(esc).join(', ')}</span>` : ''}${onlyB.length ? `<span>só B: ${onlyB.map(esc).join(', ')}</span>` : ''}
      ${!onlyA.length && !onlyB.length ? '<span>mesmas estruturas expressas</span>' : ''}
    </div>
    <div class="row"><button id="btn-compare-off" style="padding:2px 9px;font-size:11px">Fechar comparação</button></div>
  </div>`;
}

export function floraListHtml(st: StatsPayload, selected: number): string {
  const f = st.flora;
  if (!f) return '<div class="muted">Este planeta não tem flora (Etapa 3 desativada).</div>';
  if (!f.colonized) return '<div class="card muted">A terra ainda é estéril. As primeiras plantas surgem quando o mar acumular biomassa fotossintética suficiente.</div>';
  const alive = f.lineages.filter((l) => l.extinctTick < 0 && l.count > 0).sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...alive.map((l) => l.count));
  const forms = Object.entries(f.forms).sort((a, b) => b[1] - a[1]);
  return `
  <div class="card"><div class="kv">
    <span>Plantas</span><span>${fmt(f.plants)}</span><span>Biomassa vegetal</span><span>${fmt(f.mass)}</span>
    <span>Cobertura da terra</span><span>${(f.cover * 100).toFixed(0)}%</span><span>Índice de área foliar</span><span>${f.canopy.toFixed(2)}</span>
    <span>Linhagens vivas</span><span>${f.lineagesAlive}</span>
  </div>
  <div class="legendrow" style="margin-top:6px">${forms.map(([k, n]) => `<span>${esc(k)} ${fmt(n)}</span>`).join('')}</div></div>
  <h4>Mortes de plantas (acumulado)</h4>
  <div class="card">${Object.entries(f.deaths).map(([k, v]) => `<div class="gene" style="grid-template-columns:110px 1fr 56px"><span>${({ drought: 'Seca', starve: 'Fome/luz', age: 'Idade', grazed: 'Herbivoria', thermal: 'Temperatura' } as Record<string, string>)[k]}</span><div class="gb"><i style="width:${pct(v, Object.values(f.deaths).reduce((a, b) => a + b, 0) || 1)}%;background:#6fd68a"></i></div><span>${fmt(v)}</span></div>`).join('')}</div>
  <h4>Linhagens (${alive.length})</h4>
  ${alive.slice(0, 30).map((l) => `<div class="sp${l.id === selected ? ' sel' : ''}" data-pl="${l.id}"><canvas width="92" height="92" data-pvis="${l.vis.join(',')}"></canvas><div><div class="nm">${esc(l.name)}</div><div class="meta"><span class="tag photo">${esc(l.form)}</span><span class="mono">${fmt(l.count)}</span></div><div class="bar"><i style="width:${(l.count / max) * 100}%;background:#6fd68a"></i></div></div></div>`).join('')}`;
}

export function floraDetailHtml(l: FloraLineageInfo, st: StatsPayload): string {
  const byId = new Map((st.flora?.lineages ?? []).map((x) => [x.id, x]));
  const parent = l.parentId ? byId.get(l.parentId) : null;
  const notes: Record<string, [string, string]> = {
    HEIGHT: ['capta mais luz e sombreia as vizinhas', 'tronco e transporte de água custam manutenção; reprodução mais lenta'],
    LEAF: ['folhas largas interceptam mais luz', 'transpiram mais água'],
    DENSITY: ['mais folhagem por planta', 'mais água e manutenção'],
    ROOT: ['alcança mais água e nutrientes', 'raízes custam manutenção'],
    SHADE: ['cresce sob o dossel de outras plantas', 'fotossíntese máxima menor ao sol pleno'],
    DROUGHT: ['sobrevive com pouca água', 'crescimento mais lento'],
  };
  const top = PLANT_GENE_INFO.map((g, i) => ({ ...g, v: l.genes[i] })).filter((g) => notes[g.key]).sort((a, b) => b.v - a.v).slice(0, 3);
  return `<div class="card">
    <div class="detail"><canvas id="plant-portrait" width="240" height="240"></canvas><div>
      <h3>${esc(l.name)}</h3><span class="tag photo">${esc(l.form)}</span>
      <div class="kv" style="margin-top:6px"><span>Indivíduos</span><span>${l.extinctTick >= 0 ? '† extinta' : fmt(l.count)}</span><span>Pico</span><span>${fmt(l.peak)}</span><span>Surgiu há</span><span>${formatAge(st.tick - l.bornTick)}</span></div>
    </div></div>
    ${parent ? `<div class="muted" style="margin-top:6px;font-size:11px">Descende de <i>${esc(parent.name)}</i></div>` : ''}
    <h4>Genoma médio</h4>
    ${PLANT_GENE_INFO.map((g, i) => `<div class="gene"><span>${esc(g.label)}</span><div class="gb"><i style="width:${l.genes[i] * 100}%;background:#6fd68a"></i></div><span>${l.genes[i].toFixed(2)}</span></div>`).join('')}
    <h4>Custos e benefícios</h4>
    ${top.map((g) => `<div class="trade"><strong style="color:#cfe0f5">${esc(g.label)} ${g.v.toFixed(2)}:</strong> <b>+ ${notes[g.key][0]}</b>; <u>− ${notes[g.key][1]}</u></div>`).join('')}
  </div>`;
}

export function plantInspectHtml(p: PlantInfo): string {
  return `<div class="card"><div class="detail"><canvas id="plant-inspect" width="240" height="240"></canvas><div>
    <h3 style="font-size:13px">Planta #${p.id}</h3><div class="muted" style="font-style:italic">${esc(p.lineageName)}</div>
    <div class="kv" style="margin-top:6px"><span>Forma</span><span>${esc(p.form)}</span><span>Geração</span><span>${p.gen}</span><span>Idade</span><span>${p.age}</span>
    <span>Altura</span><span>${p.height.toFixed(2)} / ${p.maxHeight.toFixed(2)}</span><span>Massa</span><span>${p.mass.toFixed(2)}</span>
    <span>Sombra recebida</span><span>${(p.shade * 100).toFixed(0)}%</span><span>Água do solo</span><span>${(p.soilWater * 100).toFixed(0)}%</span><span>Temp. local</span><span>${p.temp.toFixed(1)}°C</span></div></div></div></div>`;
}

export function biomesHtml(st: StatsPayload): string {
  if (!st.stage3 || !st.biomes.length) return '';
  const rows = BIOME_INFO.map((b) => ({ ...b, a: st.biomes[b.id] ?? 0 })).filter((b) => b.a > 0.0005).sort((x, y) => y.a - x.a);
  return `<h4>Biomas (fração da superfície)</h4><div class="card">${rows.map((b) => `<div class="gene" style="grid-template-columns:140px 1fr 44px"><span><em style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:rgb(${b.color.join(',')})"></em>${esc(b.label)}</span><div class="gb"><i style="width:${Math.min(100, b.a * 220)}%;background:rgb(${b.color.join(',')})"></i></div><span>${(b.a * 100).toFixed(1)}%</span></div>`).join('')}<div class="muted" style="font-size:11px;margin-top:4px">Classificados continuamente a partir de temperatura, umidade do solo, relevo e da vegetação que realmente existe — mudam com o clima.</div></div>`;
}

export function drawPlantCanvas(c: HTMLCanvasElement, vis: ArrayLike<number>, t: number): void {
  drawPlantPortrait(c, vis, t);
}


// ---------------------------------------------------------------- Etapa 4: diagnóstico evolutivo
const DEATH_PT: Record<string, string> = { starve: 'fome', age: 'envelhecimento', predation: 'predação', thermal: 'estresse térmico', impact: 'catástrofe' };

export function evoHtml(st: StatsPayload): string {
  const d = st.diag;
  if (!d) return '<div class="muted">Calculando diagnóstico…</div>';
  const g = d.genetic;
  const struct = Object.entries(d.traits.structures).filter(([, v]) => v > 0.0005).sort((a, b) => b[1] - a[1]);
  const spec = d.speciation.slice(0, 5);
  return `
  <div class="muted" style="font-size:11px;margin-bottom:6px">Indicadores medidos pelo motor. O painel descreve o que aconteceu; ele não afirma que uma pressão <i>causou</i> uma mudança.</div>
  <h4>Pressões atuantes</h4>
  <div class="card">
    ${d.pressure.items.map((p) => `<div class="gene" style="grid-template-columns:150px 1fr 34px" title="${esc(p.detail)}"><span>${esc(p.label)}</span><div class="gb"><i style="width:${Math.min(100, p.level * 100)}%;background:${p.key === d.pressure.dominant ? '#e8b64a' : '#6aa8ff'}"></i></div><span>${(p.level * 100).toFixed(0)}</span></div><div class="muted" style="font-size:10.5px;margin:-1px 0 3px 0">${esc(p.detail)}</div>`).join('')}
    ${d.pressure.environment.length ? `<div class="legendrow" style="margin-top:6px">${d.pressure.environment.map((e) => `<span class="tag">${esc(e)}</span>`).join(' ')}</div>` : '<div class="muted" style="font-size:11px">Nenhuma alteração ambiental em curso.</div>'}
  </div>
  <h4>Diversidade genética</h4>
  <div class="card">
    <div class="kv">
      <span>Variância dos genes de nicho</span><span>${g.nicheVariance.toFixed(3)}</span>
      <span>Variância dos genes morfológicos</span><span>${g.morphVariance.toFixed(3)}</span>
      <span>Dispersão da espécie dominante</span><span>${g.dominantSpread.toFixed(3)}</span>
      <span>Fração da espécie dominante</span><span>${(g.dominantShare * 100).toFixed(0)}%</span>
      <span>Mutações por nascimento</span><span>${g.mutationsPerBirth.toFixed(2)}</span>
    </div>
    <canvas id="evo-spark" style="width:100%;height:90px;margin-top:6px"></canvas>
  </div>
  <h4>Frequência de características (% da população)</h4>
  <div class="card">
    ${struct.length ? struct.map(([k, v]) => `<div class="gene" style="grid-template-columns:130px 1fr 40px"><span>${esc(k)}</span><div class="gb"><i style="width:${Math.min(100, v * 100)}%;background:#6fd68a"></i></div><span>${(v * 100).toFixed(1)}</span></div>`).join('') : '<div class="muted">Nenhuma estrutura especializada expressa.</div>'}
    <div class="legendrow" style="margin-top:6px">${Object.entries(d.traits.means).map(([k, v]) => `<span>${esc(k)} ${v.toFixed(2)}</span>`).join('')}</div>
  </div>
  <h4>Especiação: por que dividiu — ou não</h4>
  <div class="card">
    ${spec.length ? spec.map((s) => `<div style="margin-bottom:6px"><i>${esc(s.name)}</i> <span class="muted">(${fmt(s.n)} ind.)</span><div class="muted" style="font-size:11px">${esc(s.explanation)}</div></div>`).join('') : '<div class="muted">Sem espécies vivas.</div>'}
    <div class="muted" style="font-size:10.5px">Uma espécie só se divide se houver dois agrupamentos distintos (lacuna) E isolados (geográfica ou ecologicamente). Variação contínua não especia; e permanecer igual por muito tempo é um resultado válido.</div>
  </div>
  <h4>Extinções recentes (causa provável)</h4>
  <div class="card">
    ${d.extinctions.length ? d.extinctions.slice(0, 5).map((e) => `<div style="margin-bottom:6px"><i>${esc(e.name)}</i> <span class="muted">† ${formatAge(e.extinctTick)} · pico ${fmt(e.peak)} · viveu ${fmt(e.lifespan)} ticks</span><div class="muted" style="font-size:11px">mortes recentes: ${Object.entries(e.shares).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${DEATH_PT[k] ?? k} ${(v * 100).toFixed(0)}%`).join(', ') || 'sem registro'}</div></div>`).join('') : '<div class="muted">Nenhuma extinção registrada.</div>'}
  </div>
  <h4>Habitats</h4>
  <div class="card"><div class="kv">
    <span>Fração de terra</span><span>${(d.habitat.landFraction * 100).toFixed(0)}%</span>
    <span>Animais em terra</span><span>${d.habitat.animalsOnLand} (${d.habitat.landCellsWithAnimals} células)</span>
    <span>Aptos à vida terrestre</span><span>${(d.habitat.landCapable * 100).toFixed(2)}%</span>
    <span>Plantas</span><span>${fmt(d.habitat.plants)} · cobertura ${(d.habitat.plantCoverage * 100).toFixed(0)}%</span>
  </div></div>`;
}
