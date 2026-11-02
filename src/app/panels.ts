import { GENE_INFO, G } from '../core/genome';
import { DEATH_LABEL } from '../core/simulation';
import { TROPHIC_LABEL, type Trophic } from '../core/species';
import type { SimEvent } from '../core/stats';
import { drawCreature } from '../render/morphology';
import { fmt } from '../render/charts';
import { formatAge } from '../ai/digest';
import type { InspectInfo, SpeciesInfo, StatsPayload } from '../worker/protocol';

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
};

export function drawPortrait(canvas: HTMLCanvasElement, vis: ArrayLike<number>, t: number, R?: number): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const radius = R ?? Math.min(w, h) * (0.16 + 0.12 * (vis[0] / 255));
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
  const notable = fn.filter((g) => GENE_NOTES[g.key]).sort((a, b) => b.v - a.v).slice(0, 4);
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
    ${chain.length ? `<div class="muted" style="margin-top:6px;font-size:11px">Ancestrais: ${chain.map((c) => `<i>${c}</i>`).join(' ← ')}</div>` : '<div class="muted" style="margin-top:6px;font-size:11px">Linhagem fundadora do planeta.</div>'}
    <h4>Estratégia alimentar realizada</h4>
    ${tot > 0 ? `<div class="stack"><i style="width:${pct(l, tot)}%;background:#ffd36b" title="Luz"></i><i style="width:${pct(d, tot)}%;background:#b08a5a" title="Detritos"></i><i style="width:${pct(p, tot)}%;background:#ef6a6a" title="Presas"></i></div><div class="legendrow"><span><em style="background:#ffd36b"></em>luz ${pct(l, tot).toFixed(0)}%</span><span><em style="background:#b08a5a"></em>detritos ${pct(d, tot).toFixed(0)}%</span><span><em style="background:#ef6a6a"></em>presas ${pct(p, tot).toFixed(0)}%</span></div>` : '<div class="muted">Sem dados recentes.</div>'}
    <h4>Genoma médio</h4>
    ${genes.filter((g) => g.i <= G.LONGEV).map((g) => `<div class="gene"><span>${g.label}</span><div class="gb"><i style="width:${g.v * 100}%"></i></div><span>${g.v.toFixed(2)}</span></div>`).join('')}
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
        </div>
      </div>
    </div>
  </div>`;
}

export function ecoHtml(st: StatsPayload, m0: number): string {
  const m = st.mass;
  const tot = m.organisms + m.nutrient + m.detritus + m.reservoir;
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
      <i style="width:${pct(m.nutrient, tot)}%;background:#4dd6c4" title="Nutrientes"></i>
      <i style="width:${pct(m.detritus, tot)}%;background:#b08a5a" title="Detritos"></i>
      <i style="width:${pct(m.reservoir, tot)}%;background:#6a7a96" title="Sedimento"></i>
    </div>
    <div class="legendrow">
      <span><em style="background:#6fd68a"></em>vida ${fmt(m.organisms)}</span><span><em style="background:#4dd6c4"></em>nutrientes ${fmt(m.nutrient)}</span>
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

const EV_ICON: Record<string, string> = { speciation: '🧬', extinction: '☠', mass_extinction: '☄', bloom: '🌱', crash: '📉', eruption: '🌋', impact: '☄', climate: '🌡', user: '✋', dominance: '👑', milestone: '★', total_extinction: '⚠', anagenesis: '↻' };

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
