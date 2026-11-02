import './styles.css';
import { AIDirector, type SuggestionItem } from '../ai/director';
import { formatAge } from '../ai/digest';
import type { Chronicle } from '../ai/chronicler';
import { LAYER_INFO, type LayerKind } from '../core/layers';
import type { PaintMode } from '../core/simulation';
import { drawLines, drawTree, drawWeb, fmt, hitTest, type Hit, type SeriesDef } from '../render/charts';
import { MapRenderer, rampCss } from '../render/mapRenderer';
import type { CellInfo, InspectInfo, StatsPayload } from '../worker/protocol';
import { drawPortrait, ecoHtml, esc, eventsHtml, inspectHtml, speciesDetailHtml, speciesListHtml } from './panels';
import { SimClient } from './simClient';
import { storage } from './storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------------ estado
const client = new SimClient();
const canvas = $('map') as unknown as HTMLCanvasElement;
const renderer = new MapRenderer(canvas);
const director = new AIDirector();

let stats: StatsPayload | null = null;
let m0 = 0; // massa total inicial (para exibir a conservação)
let selectedSp = 0;
let inspected: InspectInfo | null = null;
let layer: LayerKind = 'ocean';
let layerBeforeSpecies: LayerKind = 'ocean';
type ToolId = 'observe' | PaintMode;
let tool: ToolId = 'observe';
let speed = 1;
let paused = false;
let showExtinct = false;
let evFilter = 'all';
let sideTab = 'sp';
let botTab = 'tl';
let seed = 1;
let lastAutoChron = 0;
let lastAutosave = Date.now();
let treeHits: Hit[] = [];
let webHits: Hit[] = [];
let lastPaint = 0;
let suggestions: SuggestionItem[] = [];
let suggestionResults = new Map<number, { ok: boolean; reason: string }>();
let hypText = '';

// ------------------------------------------------------------------ controles
const SPEEDS = [0.5, 1, 2, 5, 10, 30, 100];
const speedsEl = $('speeds');
SPEEDS.forEach((s) => {
  const b = document.createElement('button');
  b.textContent = s < 1 ? '½×' : `${s}×`;
  b.dataset.s = String(s);
  b.onclick = () => setSpeed(s);
  speedsEl.appendChild(b);
});
function setSpeed(s: number) {
  speed = s;
  if (paused) togglePause(false);
  else client.send({ t: 'speed', speed });
  speedsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.s) === speed));
}
function togglePause(p = !paused) {
  paused = p;
  client.send({ t: 'speed', speed: paused ? 0 : speed });
  $('b-play').textContent = paused ? '▶' : '⏸';
  renderState();
}
$('b-play').onclick = () => togglePause();
$('b-step').onclick = () => {
  if (!paused) togglePause(true);
  client.send({ t: 'step', n: 25 });
};
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).matches('input,textarea,select')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
  const n = Number(e.key);
  if (n >= 1 && n <= SPEEDS.length) setSpeed(SPEEDS[n - 1]);
  if (e.key === 'Escape') { setTool('observe'); selectSpecies(0); }
});

// camadas
const LAYERS: LayerKind[] = ['ocean', 'temp', 'light', 'nutrient', 'detritus', 'biomass', 'biodiversity', 'density', 'species'];
const SHORT: Record<LayerKind, string> = { ocean: 'Oceano', temp: 'Temperatura', light: 'Luz', nutrient: 'Nutrientes', detritus: 'Detritos', biomass: 'Biomassa', biodiversity: 'Biodiversidade', density: 'Densidade', species: 'Espécie' };
const layersEl = $('layers');
LAYERS.forEach((k) => {
  const b = document.createElement('button');
  b.dataset.l = k;
  b.textContent = SHORT[k];
  b.onclick = () => {
    if (k === 'species' && !selectedSp) return;
    setLayer(k);
  };
  layersEl.appendChild(b);
});
function setLayer(k: LayerKind) {
  layer = k;
  client.send({ t: 'layer', layer: k, species: selectedSp });
  layersEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.l === k));
  (layersEl.querySelector('[data-l=species]') as HTMLButtonElement).disabled = !selectedSp;
}
setLayer('ocean');

// ferramentas
const TOOLS: [ToolId, string, string][] = [
  ['observe', 'Observar', 'Arrastar move o mapa; clique seleciona um organismo'],
  ['warm', 'Aquecer', 'Eleva a temperatura local'],
  ['cool', 'Resfriar', 'Reduz a temperatura local'],
  ['deepen', 'Aprofundar', 'Aumenta a profundidade: menos luz'],
  ['shallow', 'Elevar leito', 'Reduz a profundidade: mais luz'],
  ['nutrients', 'Nutrientes', 'Traz minerais do sedimento (conserva massa)'],
  ['seed', 'Semear vida', 'Introduz protocélulas usando o nutriente local'],
  ['erupt', 'Erupção', 'Abre uma fenda: libera minerais e aquece (mata no epicentro)'],
  ['impact', 'Impacto', 'Asteroide: devasta a região'],
];
const toolsEl = $('tools');
toolsEl.innerHTML = `<div class="tl">Ferramentas</div><div class="trow" id="trow"></div><div class="brushr">Raio <input type="range" id="brush-r" min="1" max="10" value="3" /><span id="brush-v">3</span></div>`;
TOOLS.forEach(([k, label, title]) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.dataset.t = k;
  b.onclick = () => setTool(k);
  $('trow').appendChild(b);
});
function setTool(t: ToolId) {
  tool = t;
  renderer.brush.active = t !== 'observe';
  canvas.classList.toggle('brush', t !== 'observe');
  $('trow').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === t));
}
setTool('observe');
$('brush-r').oninput = (e) => {
  renderer.brush.r = Number((e.target as HTMLInputElement).value);
  $('brush-v').textContent = String(renderer.brush.r);
};
renderer.brush.r = 3;

$('z-in').onclick = () => renderer.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.4);
$('z-out').onclick = () => renderer.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.4);
$('z-fit').onclick = () => renderer.fit();

// ------------------------------------------------------------------ mapa: interação
let dragging = false;
let moved = false;
let last = { x: 0, y: 0 };
let hoverTimer = 0;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const r = canvas.getBoundingClientRect();
  last = { x: e.clientX, y: e.clientY };
  moved = false;
  if (tool === 'observe' || e.button === 2) {
    dragging = true;
    canvas.classList.add('drag');
  } else {
    applyBrush(e.clientX - r.left, e.clientY - r.top, true);
    dragging = false;
    brushing = true;
  }
});
let brushing = false;
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  renderer.pointer = { x: sx, y: sy, inside: true };
  const [wx, wy] = renderer.screenToWorld(sx, sy);
  renderer.hoverCell = wy >= 0 && wy < renderer.h ? { x: Math.floor(((wx % renderer.w) + renderer.w) % renderer.w), y: Math.floor(wy) } : null;
  if (dragging) {
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    renderer.pan(dx, dy);
    last = { x: e.clientX, y: e.clientY };
  } else if (brushing && e.buttons) {
    applyBrush(sx, sy, false);
  } else if (!hoverTimer && renderer.hoverCell) {
    hoverTimer = window.setTimeout(() => {
      hoverTimer = 0;
      if (renderer.hoverCell) client.send({ t: 'cell', x: renderer.hoverCell.x + 0.5, y: renderer.hoverCell.y + 0.5 });
    }, 120);
  }
  if (!renderer.hoverCell) $('tip').hidden = true;
});
canvas.addEventListener('pointerup', (e) => {
  const r = canvas.getBoundingClientRect();
  if (dragging && !moved && tool === 'observe' && e.button === 0) {
    const [wx, wy] = renderer.screenToWorld(e.clientX - r.left, e.clientY - r.top);
    client.send({ t: 'inspect', x: ((wx % renderer.w) + renderer.w) % renderer.w, y: wy });
  }
  dragging = false;
  brushing = false;
  canvas.classList.remove('drag');
});
canvas.addEventListener('pointerleave', () => {
  renderer.pointer.inside = false;
  $('tip').hidden = true;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  renderer.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

function applyBrush(sx: number, sy: number, first: boolean) {
  const [wx, wy] = renderer.screenToWorld(sx, sy);
  if (wy < 0 || wy >= renderer.h) return;
  const oneShot = tool === 'seed' || tool === 'erupt' || tool === 'impact';
  const now = performance.now();
  if (!first && (oneShot || now - lastPaint < 60)) return;
  lastPaint = now;
  client.send({ t: 'paint', mode: tool as PaintMode, x: ((wx % renderer.w) + renderer.w) % renderer.w, y: wy, r: renderer.brush.r });
}

client.onCell = (c: CellInfo) => {
  const tip = $('tip');
  if (!renderer.hoverCell || renderer.hoverCell.x !== c.x || renderer.hoverCell.y !== c.y) return;
  const r = renderer.pointer;
  tip.hidden = false;
  tip.innerHTML = `<b>Célula ${c.x},${c.y}</b><br><span class="k">Temperatura</span><span class="mono">${c.temp.toFixed(1)} °C</span><br><span class="k">Luz</span><span class="mono">${c.light.toFixed(2)}</span><br><span class="k">Profundidade</span><span class="mono">${(c.depth * 100).toFixed(0)}%</span><br><span class="k">Nutrientes</span><span class="mono">${c.nutrient.toFixed(1)}</span><br><span class="k">Detritos</span><span class="mono">${c.detritus.toFixed(2)}</span><br><span class="k">Organismos</span><span class="mono">${c.count} (biomassa ${c.biomass.toFixed(1)})</span>${c.top.map((t) => `<br><i>${esc(t.name)}</i> <span class="mono">×${t.n}</span>`).join('')}`;
  tip.style.left = Math.min(canvas.clientWidth - 220, r.x + 16) + 'px';
  tip.style.top = Math.min(canvas.clientHeight - 180, r.y + 16) + 'px';
};

client.onInspect = (i) => {
  inspected = i;
  renderer.selectedOrganism = i ? { x: i.x, y: i.y } : null;
  if (i) {
    selectSpecies(i.speciesId, false);
    setSideTab('sp');
  }
  renderSide();
};

// ------------------------------------------------------------------ seleção de espécie
function selectSpecies(id: number, toggle = true) {
  if (toggle && id === selectedSp) id = 0;
  if (id && !selectedSp) layerBeforeSpecies = layer;
  selectedSp = id;
  renderer.species = id;
  if (id) setLayer('species');
  else if (layer === 'species') setLayer(layerBeforeSpecies === 'species' ? 'ocean' : layerBeforeSpecies);
  else setLayer(layer);
  renderSide();
  renderBottom();
}

// ------------------------------------------------------------------ abas
function tabs(navId: string, cb: (t: string) => void) {
  const nav = $(navId);
  nav.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      nav.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      cb((b as HTMLElement).dataset.tab!);
    });
  });
}
function setSideTab(t: string) {
  sideTab = t;
  $('side-tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.tab === t));
  document.querySelectorAll('#side .pane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + t));
  renderSide();
}
tabs('side-tabs', (t) => setSideTab(t));
tabs('bot-tabs', (t) => {
  botTab = t;
  document.querySelectorAll('.bpane').forEach((p) => p.classList.toggle('on', p.id === 'bp-' + t));
  $('bot-hint').textContent = t === 'tree' ? 'Clique numa linhagem para selecioná-la · ✕ = extinção' : t === 'web' ? 'Setas amarelas: luz · marrons: detritos · vermelhas: predação (espessura = intensidade)' : '';
  requestAnimationFrame(renderBottom);
});

// ------------------------------------------------------------------ painéis laterais
const paneSp = $('pane-sp');
paneSp.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.id === 'tg-ext') { showExtinct = !showExtinct; renderSide(); return; }
  const row = t.closest('[data-sp]') as HTMLElement | null;
  if (row) selectSpecies(Number(row.dataset.sp));
});
$('pane-ev').addEventListener('click', (e) => {
  const row = (e.target as HTMLElement).closest('[data-sp]') as HTMLElement | null;
  if (row) { selectSpecies(Number(row.dataset.sp), false); setSideTab('sp'); }
  const f = (e.target as HTMLElement).closest('[data-f]') as HTMLElement | null;
  if (f) { evFilter = f.dataset.f!; renderSide(); }
});

let spRenderKey = '';
function renderSide() {
  if (!stats) return;
  const st = stats;
  if (sideTab === 'sp') {
    const sel = selectedSp ? st.species[selectedSp - 1] : null;
    const key = st.species.length + ':' + selectedSp + ':' + st.species.reduce((a, s) => a + s.count, 0) + ':' + showExtinct + ':' + (inspected?.id ?? 0) + ':' + (inspected ? inspected.age : 0);
    if (key === spRenderKey) return;
    spRenderKey = key;
    const scroll = paneSp.scrollTop;
    paneSp.innerHTML =
      (inspected ? '<h4>Organismo selecionado</h4>' + inspectHtml(inspected) : '') +
      (sel ? '<h4>Espécie selecionada</h4>' + speciesDetailHtml(st, sel) : '<div class="muted" style="margin-bottom:8px">Clique numa espécie (ou num organismo no mapa) para ver sua distribuição, genoma e custos evolutivos.</div>') +
      speciesListHtml(st, selectedSp, showExtinct);
    paneSp.scrollTop = scroll;
    paneSp.querySelectorAll<HTMLCanvasElement>('canvas[data-vis]').forEach((c) => drawPortrait(c, c.dataset.vis!.split(',').map(Number), 0, 22));
  } else if (sideTab === 'eco') {
    $('pane-eco').innerHTML = ecoHtml(st, m0);
  } else if (sideTab === 'ev') {
    const chips = [['all', 'Todos'], ['speciation', 'Especiações'], ['ext', 'Extinções'], ['eruption', 'Geologia'], ['bloom', 'Biomassa']];
    $('pane-ev').innerHTML = `<div class="row" style="flex-wrap:wrap">${chips.map(([k, l]) => `<button data-f="${k}" class="${evFilter === k ? 'on-btn' : ''}" style="padding:2px 9px">${l}</button>`).join('')}</div>` + eventsHtml(st.events, evFilter);
  } else if (sideTab === 'pl') {
    updatePlanetPane();
  }
}

// painel do planeta (estrutura fixa)
$('pane-pl').innerHTML = `
  <h4>Clima global</h4>
  <div class="card">
    <div class="row sp-between"><span>Ajuste de temperatura</span><b id="cl-val" class="mono">0 °C</b></div>
    <input type="range" id="cl-in" min="-10" max="10" step="1" value="0" style="width:100%" />
    <div class="row"><button id="cl-apply" class="primary">Aplicar gradualmente</button><button id="cl-reset">Restaurar</button></div>
    <div class="muted" style="font-size:11px">O clima relaxa lentamente para o alvo. Espécies se adaptam, migram ou se extinguem.</div>
  </div>
  <h4>Estado do planeta</h4>
  <div class="card"><div class="kv" id="pl-kv"></div></div>
  <h4>Geologia</h4>
  <div class="card">
    <div class="row sp-between"><span>Pressão geológica</span><span class="mono" id="geo-v"></span></div>
    <div class="bar" style="height:8px"><i id="geo-bar" style="background:var(--amber)"></i></div>
    <div class="muted" style="font-size:11px;margin-top:6px">Sedimentos de organismos mortos se acumulam no fundo e pressionam as fontes hidrotermais. Ao atingir o limite ocorre uma erupção natural, devolvendo minerais ao oceano.</div>
  </div>
  <h4>Intervenções</h4>
  <div class="card">
    <div class="row"><button id="pl-seed">Semear 200 protocélulas</button></div>
    <div class="row"><button id="pl-mass" class="danger">Extinção em massa (50%)</button></div>
    <div class="muted" style="font-size:11px">Também há pincéis no mapa: aquecer, resfriar, aprofundar, nutrientes, erupção e impacto.</div>
  </div>`;
$('cl-in').oninput = (e) => ($('cl-val').textContent = `${(e.target as HTMLInputElement).value} °C`);
$('cl-apply').onclick = () => client.send({ t: 'climate', dT: Number(($('cl-in') as HTMLInputElement).value) });
$('cl-reset').onclick = () => { ($('cl-in') as HTMLInputElement).value = '0'; $('cl-val').textContent = '0 °C'; client.send({ t: 'climate', dT: 0 }); };
$('pl-seed').onclick = () => client.send({ t: 'seed' });
$('pl-mass').onclick = () => { if (confirm('Eliminar metade de toda a vida do planeta?')) client.send({ t: 'massExt', f: 0.5 }); };
function updatePlanetPane() {
  if (!stats) return;
  const p = stats.planet;
  $('pl-kv').innerHTML = `<span>Temperatura média</span><span>${p.meanTemp.toFixed(1)} °C</span><span>Ajuste climático</span><span>${p.climateOffset.toFixed(1)} → ${p.climateTarget.toFixed(0)} °C</span><span>Estação</span><span>${p.season > 0.3 ? 'verão boreal' : p.season < -0.3 ? 'inverno boreal' : 'transição'}</span><span>Sedimento enterrado</span><span>${fmt(stats.mass.reservoir)}</span>`;
  $('geo-v').textContent = `${p.pressure.toFixed(0)} / 260`;
  ($('geo-bar') as HTMLElement).style.width = Math.min(100, (p.pressure / 260) * 100) + '%';
}

// ------------------------------------------------------------------ IA
$('pane-ai').innerHTML = `
  <h4>Diretora do planeta</h4>
  <div class="card">
    <div class="row sp-between"><label><input type="checkbox" id="ai-on" /> IA conectada</label><span id="ai-status" class="muted"><span class="dot"></span>desligada</span></div>
    <div class="muted" style="font-size:11px" id="ai-help">A simulação funciona integralmente sem IA. Sem conexão, o cronista local narra os fatos. Para usar um modelo de linguagem, defina <code>ANTHROPIC_API_KEY</code> e execute <code>npm run ai-proxy</code>: a chave fica no backend local, nunca no navegador.</div>
    <div class="row"><label><input type="checkbox" id="ai-auto" checked /> Crônica automática (a cada ~600 ticks, se houver novidades)</label></div>
    <div class="row"><button id="ai-chron" class="primary">Escrever crônica agora</button><button id="ai-hyp">Gerar hipóteses</button></div>
  </div>
  <h4>Perguntar ao planeta</h4>
  <div class="card"><div class="row"><input id="ai-q" class="wide" placeholder="Por que a espécie dominante cresceu?" /><button id="ai-ask">Perguntar</button></div></div>
  <div id="ai-hyp-out"></div>
  <h4>Crônicas do planeta</h4>
  <div id="ai-feed"><div class="muted">As crônicas aparecem aqui conforme a história se desenrola.</div></div>`;
function renderAIStatus() {
  const on = ($('ai-on') as HTMLInputElement).checked;
  const s = director.status;
  const el = $('ai-status');
  if (!on) el.innerHTML = '<span class="dot"></span>desligada (modo local)';
  else if (!s.reachable) el.innerHTML = '<span class="dot warn"></span>proxy offline — modo local';
  else if (!s.configured) el.innerHTML = '<span class="dot warn"></span>sem chave — modo local';
  else el.innerHTML = `<span class="dot on"></span>${esc(s.model ?? 'conectada')}`;
}
($('ai-on') as HTMLInputElement).onchange = async (e) => {
  director.enabled = (e.target as HTMLInputElement).checked;
  if (director.enabled) await director.checkStatus();
  renderAIStatus();
};
function addChronicle(c: Chronicle) {
  const feed = $('ai-feed');
  if (feed.firstElementChild?.classList.contains('muted')) feed.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'chron';
  div.innerHTML = `<div class="src">${c.source === 'ai' ? 'IA' : 'Cronista local'} · ${formatAge(c.tick)}</div><h5>${esc(c.title)}</h5><p>${esc(c.text)}</p>${c.warnings?.length ? `<div class="warn">⚠ Números não encontrados nos dados do planeta: ${esc(c.warnings.join(', '))}</div>` : ''}`;
  feed.prepend(div);
  while (feed.children.length > 30) feed.lastElementChild!.remove();
}
director.onChronicle = addChronicle;
$('ai-chron').onclick = () => stats && director.chronicle(stats);
$('ai-ask').onclick = async () => {
  const q = ($('ai-q') as HTMLInputElement).value.trim();
  if (!q || !stats) return;
  const c = await director.ask(stats, q);
  addChronicle(c);
};
$('ai-hyp').onclick = async () => {
  if (!stats) return;
  if (!director.enabled) { $('ai-hyp-out').innerHTML = '<div class="card muted">Ative a IA para gerar hipóteses. O cronista local não formula hipóteses.</div>'; return; }
  $('ai-hyp-out').innerHTML = '<div class="card muted">Consultando…</div>';
  const r = await director.hypotheses(stats);
  suggestions = r.items;
  hypText = r.text.replace(/```json[\s\S]*?```/g, '').trim();
  suggestionResults.clear();
  renderSuggestions();
};
function renderSuggestions() {
  const out = $('ai-hyp-out');
  if (!hypText && !suggestions.length) { out.innerHTML = '<div class="card muted">A IA não respondeu (verifique o proxy e a chave).</div>'; return; }
  const label = (s: SuggestionItem['suggestion']) =>
    s.type === 'climate_shift' ? `Variação climática de ${s.deltaT > 0 ? '+' : ''}${s.deltaT} °C` : s.type === 'eruption' ? `Erupção em (${s.x.toFixed(0)}, ${s.y.toFixed(0)}) liberando ${s.amount.toFixed(0)}` : `Variante de ${s.gene} (${s.delta > 0 ? '+' : ''}${s.delta}) na espécie #${s.speciesId}`;
  out.innerHTML = `<h4>Hipóteses da IA</h4><div class="card" style="white-space:pre-wrap">${esc(hypText)}</div>` + suggestions.map((it, i) => {
    const r = suggestionResults.get(i);
    return `<div class="sug"><b>${esc(label(it.suggestion))}</b><div class="muted">${esc(it.rationale)}</div><div class="row"><button data-sg="${i}" ${r ? 'disabled' : ''}>Submeter ao motor</button></div>${r ? `<div class="res ${r.ok ? 'ok' : 'no'}">${r.ok ? '✓ Aceita pelo motor: ' : '✕ Recusada pelo motor: '}${esc(r.reason)}</div>` : '<div class="muted" style="font-size:11px">O motor verifica se é permitido e coerente com o estado real do planeta.</div>'}</div>`;
  }).join('');
  out.querySelectorAll<HTMLButtonElement>('[data-sg]').forEach((b) => {
    b.onclick = async () => {
      const i = Number(b.dataset.sg);
      suggestionResults.set(i, await client.suggest(suggestions[i].suggestion));
      renderSuggestions();
    };
  });
}

// ------------------------------------------------------------------ gráficos inferiores
const trophicDefs: SeriesDef[] = [
  { key: 'nPhoto', label: 'Fotossintéticos', color: '#6fd68a' },
  { key: 'nMixo', label: 'Mixotróficos', color: '#b5e08a' },
  { key: 'nOsmo', label: 'Decompositores', color: '#d8a85a' },
  { key: 'nPred', label: 'Predadores', color: '#ef6a6a' },
];
const resDefs: SeriesDef[] = [
  { key: 'biomass', label: 'Biomassa', color: '#6fd68a' },
  { key: 'nutrient', label: 'Nutrientes', color: '#4dd6c4', scale: 1 },
  { key: 'detritus', label: 'Detritos', color: '#b08a5a', scale: 1 },
];
const geneDefs: SeriesDef[] = [
  { key: 'mSize', label: 'Tamanho', color: '#9ad0ff' }, { key: 'mPhoto', label: 'Fotossíntese', color: '#6fd68a' },
  { key: 'mOsmo', label: 'Detritos', color: '#d8a85a' }, { key: 'mPred', label: 'Predação', color: '#ef6a6a' },
  { key: 'mMotil', label: 'Motilidade', color: '#c79cff' }, { key: 'mDef', label: 'Defesa', color: '#f0e06a' },
];
const geneDefs2: SeriesDef[] = [
  { key: 'mTopt', label: 'T ótima', color: '#ff9a5a' }, { key: 'mTtol', label: 'Tolerância T', color: '#5ad0ff' },
  { key: 'mMeta', label: 'Metabolismo', color: '#e8b64a' }, { key: 'species', label: 'Espécies (norm.)', color: '#ffffff', scale: 0.02 },
];
const evColors: Record<string, string> = { speciation: '#4dd6c4', extinction: '#ef6a6a', mass_extinction: '#ef6a6a', eruption: '#e8b64a', impact: '#e8b64a' };

function renderBottom() {
  if (!stats) return;
  const st = stats;
  const h = st.history;
  const marks = st.events.filter((e) => evColors[e.type] && e.type !== 'speciation').map((e) => ({ tick: e.tick, color: evColors[e.type] }));
  if (botTab === 'tl') {
    drawLines($('c-pop') as unknown as HTMLCanvasElement, h.ticks, h.series, trophicDefs, { stacked: true, events: marks });
    drawLines($('c-res') as unknown as HTMLCanvasElement, h.ticks, h.series, resDefs, { events: marks });
  } else if (botTab === 'tree') treeHits = drawTree($('c-tree') as unknown as HTMLCanvasElement, st, selectedSp);
  else if (botTab === 'web') webHits = drawWeb($('c-web') as unknown as HTMLCanvasElement, st, selectedSp);
  else if (botTab === 'gen') {
    drawLines($('c-gen') as unknown as HTMLCanvasElement, h.ticks, h.series, geneDefs, { normalize: true });
    drawLines($('c-gen2') as unknown as HTMLCanvasElement, h.ticks, h.series, geneDefs2, { normalize: true });
  }
}
$('c-tree').addEventListener('click', (e) => {
  const r = (e.target as HTMLElement).getBoundingClientRect();
  const id = hitTest(treeHits, e.clientX - r.left, e.clientY - r.top);
  if (id) { selectSpecies(id, false); setSideTab('sp'); }
});
$('c-web').addEventListener('click', (e) => {
  const r = (e.target as HTMLElement).getBoundingClientRect();
  const id = hitTest(webHits, e.clientX - r.left, e.clientY - r.top);
  if (id) { selectSpecies(id, false); setSideTab('sp'); }
});

// ------------------------------------------------------------------ topo
function renderState() {
  const el = $('r-state');
  if (stats?.extinct) { el.textContent = 'EXTINTO'; el.className = 'state dead'; }
  else if (paused) { el.textContent = 'PAUSADO'; el.className = 'state pause'; }
  else { el.textContent = 'EM CURSO'; el.className = 'state run'; }
}

client.onFrame = (f) => {
  renderer.setFrame(f);
  $('r-tps').textContent = `${f.tps.toFixed(0)} t/s`;
  const lg = renderer.legend();
  $('lg-title').textContent = LAYER_INFO[lg.name as LayerKind].label + (lg.name === 'species' && selectedSp && stats ? `: ${stats.species[selectedSp - 1]?.name ?? ''}` : '');
  ($('lg-bar') as HTMLElement).style.background = rampCss(lg.name);
  const unit = LAYER_INFO[lg.name as LayerKind].unit;
  $('lg-min').textContent = lg.name === 'ocean' ? 'raso' : fmt(lg.min) + unit;
  $('lg-max').textContent = lg.name === 'ocean' ? 'abissal' : fmt(lg.max) + unit;
};

let lastStatsAt = 0;
client.onStats = (st) => {
  stats = st;
  if (!m0 || st.tick === 0) m0 = st.mass.organisms + st.mass.nutrient + st.mass.detritus + st.mass.reservoir;
  $('r-age').textContent = formatAge(st.tick);
  $('r-gen').textContent = String(st.maxGen);
  $('r-pop').textContent = fmt(st.pop);
  $('r-sp').textContent = `${st.speciesAlive} / ${st.speciesTotal}`;
  $('r-bio').textContent = fmt(st.mass.organisms);
  renderState();
  const banner = $('banner');
  banner.hidden = !st.extinct;
  if (st.extinct) banner.innerHTML = '<b>Extinção total.</b> A vida desapareceu deste planeta. <button id="bn-seed">Recomeçar a vida</button>';
  if (st.extinct) $('bn-seed')?.addEventListener('click', () => client.send({ t: 'seed' }));
  const now = performance.now();
  if (now - lastStatsAt > 700) {
    lastStatsAt = now;
    renderSide();
    renderBottom();
  }
  // crônicas: periódicas e apenas quando há novidade
  if (st.tick - lastAutoChron >= 600 && ($('ai-auto') as HTMLInputElement).checked && st.pop > 0) {
    const hadNews = st.events.some((e) => e.tick > lastAutoChron);
    lastAutoChron = st.tick;
    if (hadNews) director.chronicle(st);
  }
  if (Date.now() - lastAutosave > 90000 && !paused) {
    lastAutosave = Date.now();
    saveNow('autosave').catch(() => {});
  }
};

// ------------------------------------------------------------------ salvar / carregar / novo
async function saveNow(name?: string) {
  const data = await client.requestSave();
  const n = name ?? `Planeta ${seed} · ${stats ? formatAge(stats.tick) : ''} · ${new Date().toLocaleString('pt-BR')}`;
  await storage.put({ name: n, createdAt: Date.now(), tick: stats?.tick ?? 0, pop: stats?.pop ?? 0, species: stats?.speciesAlive ?? 0, data });
  return n;
}
$('b-save').onclick = async () => {
  const b = $('b-save') as HTMLButtonElement;
  b.disabled = true;
  try { await saveNow(); b.textContent = 'Salvo ✓'; } catch { b.textContent = 'Erro ao salvar'; }
  setTimeout(() => { b.textContent = 'Salvar'; b.disabled = false; }, 1500);
};
$('b-load').onclick = async () => {
  const list = (await storage.list().catch(() => [])).sort((a, b) => b.createdAt - a.createdAt);
  const el = $('save-list');
  el.innerHTML = list.length ? '' : '<div class="muted">Nenhum planeta salvo ainda.</div>';
  for (const r of list) {
    const d = document.createElement('div');
    d.className = 'save-item';
    d.innerHTML = `<div><b>${esc(r.name)}</b><small>${formatAge(r.tick)} · ${r.pop} organismos · ${r.species} espécies</small></div><div><button data-l>Carregar</button> <button data-d class="danger">×</button></div>`;
    d.querySelector('[data-l]')!.addEventListener('click', () => {
      client.send({ t: 'load', save: r.data });
      m0 = 0; selectedSp = 0; inspected = null; lastAutoChron = r.tick; spRenderKey = '';
      ($('dlg-load') as HTMLDialogElement).close();
    });
    d.querySelector('[data-d]')!.addEventListener('click', async () => { await storage.remove(r.name); d.remove(); });
    el.appendChild(d);
  }
  ($('dlg-load') as HTMLDialogElement).showModal();
};
$('b-new').onclick = () => ($('dlg-new') as HTMLDialogElement).showModal();
$('new-ok').onclick = () => {
  seed = Math.max(1, Number(($('in-seed') as HTMLInputElement).value) | 0);
  const [w, h] = ($('in-size') as HTMLSelectElement).value.split('x').map(Number);
  startWorld(seed, w, h, Number(($('in-pop') as HTMLInputElement).value));
};
function startWorld(sd: number, w = 96, h = 60, pop = 700) {
  seed = sd;
  m0 = 0; selectedSp = 0; inspected = null; spRenderKey = ''; lastAutoChron = 0;
  renderer.species = 0; renderer.selectedOrganism = null;
  client.send({ t: 'init', cfg: { seed: sd, width: w, height: h, initialPopulation: pop, maxOrganisms: w * h * 9 } });
  client.send({ t: 'speed', speed: paused ? 0 : speed });
  setLayer(layer === 'species' ? 'ocean' : layer);
}
client.onReady = (w, h) => {
  renderer.setWorld(w, h);
  renderer.resize();
  renderer.fit();
};

// ------------------------------------------------------------------ laço de desenho
let lastDraw = 0;
let drawCost = 8;
function frame(t: number) {
  requestAnimationFrame(frame);
  if (t - lastDraw < Math.max(16, drawCost * 1.2)) return;
  lastDraw = t;
  const t0 = performance.now();
  renderer.draw(t / 1000);
  drawCost = drawCost * 0.8 + (performance.now() - t0) * 0.2;
  // retratos animados
  if (stats) {
    const dp = document.getElementById('detail-portrait') as HTMLCanvasElement | null;
    if (dp && selectedSp && stats.species[selectedSp - 1]) drawPortrait(dp, stats.species[selectedSp - 1].vis, t / 1000);
    const ip = document.getElementById('inspect-portrait') as HTMLCanvasElement | null;
    if (ip && inspected) drawPortrait(ip, inspected.vis, t / 1000);
  }
}
window.addEventListener('resize', () => { renderer.resize(); renderBottom(); });
new ResizeObserver(() => { renderer.resize(); renderBottom(); }).observe(canvas);

// ------------------------------------------------------------------ início
director.checkStatus().then(renderAIStatus);
setSpeed(1);
startWorld(1);
requestAnimationFrame(frame);
(window as any).__evolvere = { client, renderer, get stats() { return stats; } };
