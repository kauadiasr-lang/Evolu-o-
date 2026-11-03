import './styles.css';
import { AIDirector, type SuggestionItem } from '../ai/director';
import { formatAge } from '../ai/digest';
import type { Chronicle } from '../ai/chronicler';
import { LAYER_INFO, type LayerKind } from '../core/layers';
import type { PaintMode } from '../core/simulation';
import { drawLines, drawTree, drawWeb, fmt, hitTest, type Hit, type SeriesDef } from '../render/charts';
import { MapRenderer, QUALITY, rampCss, type QualityLevel } from '../render/mapRenderer';
import type { CellInfo, InspectInfo, StatsPayload } from '../worker/protocol';
import { biomesHtml, compareHtml, drawPortrait, ecoHtml, esc, eventsHtml, floraDetailHtml, floraListHtml, inspectHtml, plantInspectHtml, speciesDetailHtml, speciesListHtml } from './panels';
import { drawPlantPortrait } from '../render/plants';
import { ARCHETYPES, type ArchetypeKind } from '../core/archetypes';
import { BIOME_INFO } from '../core/biomes';
import type { FloraLineageInfo, PlantInfo } from '../worker/protocol';
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
let inspectedPlant: PlantInfo | null = null;
let selectedLin = 0;
let compareMode = false;
let compareSp = 0;
let archetype: ArchetypeKind = 'swimmer';
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
const speedSel = $('speed-sel') as HTMLSelectElement;
speedSel.innerHTML = SPEEDS.map((s) => `<option value="${s}">${s < 1 ? '½×' : s + '×'}</option>`).join('');
speedSel.onchange = () => setSpeed(Number(speedSel.value));
function setSpeed(s: number) {
  speed = s;
  speedSel.value = String(s);
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
const LAYERS: LayerKind[] = ['ocean', 'biome', 'temp', 'moisture', 'vegetation', 'light', 'nutrient', 'detritus', 'biomass', 'biodiversity', 'density', 'species'];
const STAGE3_LAYERS = new Set<LayerKind>(['biome', 'moisture', 'vegetation']);
const SHORT: Record<LayerKind, string> = { ocean: 'Oceano', temp: 'Temperatura', light: 'Luz', nutrient: 'Nutrientes', detritus: 'Detritos', biomass: 'Biomassa', biodiversity: 'Biodiversidade', density: 'Densidade', species: 'Espécie', biome: 'Biomas', moisture: 'Umidade', vegetation: 'Vegetação' };
const layersEl = $('layers');
LAYERS.forEach((k) => {
  const b = document.createElement('button');
  b.dataset.l = k;
  if (STAGE3_LAYERS.has(k)) b.classList.add('s3only');
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
  ['archetype', 'Semear plano corporal', 'Sandbox: introduz uma linhagem com outro plano corporal; só a seleção natural decide se ela persiste'],
];
const toolsEl = $('tools');
toolsEl.innerHTML = `<div class="tl">Ferramentas</div><div class="trow" id="trow"></div><div class="brushr">Raio <input type="range" id="brush-r" min="1" max="10" value="3" /><span id="brush-v">3</span></div><div class="brushr s3only">Plano <select id="arch-sel">${(Object.keys(ARCHETYPES) as ArchetypeKind[]).map((k) => `<option value="${k}">${ARCHETYPES[k].label}</option>`).join('')}</select></div>`;
($('arch-sel') as HTMLSelectElement).onchange = (e) => { archetype = (e.target as HTMLSelectElement).value as ArchetypeKind; };
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

// ------------------------------------------------------------------ mapa: interação (mouse, toque, pinça)
const pointers = new Map<number, { x: number; y: number }>();
let dragging = false;
let moved = false;
let brushing = false;
let downAt = 0;
let downPos = { x: 0, y: 0 };
let pinch: { dist: number; cx: number; cy: number } | null = null;
let hoverTimer = 0;
let tipTimer = 0;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const rel = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
const pinchState = () => {
  const [a, b] = [...pointers.values()];
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
};

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = rel(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    // segundo dedo: vira gesto de pinça/pan e cancela pincel e toque
    pinch = pinchState();
    dragging = false;
    brushing = false;
    moved = true;
    return;
  }
  downAt = performance.now();
  downPos = p;
  moved = false;
  if (tool === 'observe' || e.button === 2) {
    dragging = true;
    canvas.classList.add('drag');
  } else {
    applyBrush(p.x, p.y, true);
    brushing = true;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = rel(e);
  const prev = pointers.get(e.pointerId);
  if (prev) pointers.set(e.pointerId, p);
  if (e.pointerType === 'mouse') {
    renderer.pointer = { x: p.x, y: p.y, inside: true };
    renderer.dirty = true;
    const [wx, wy] = renderer.screenToWorld(p.x, p.y);
    renderer.hoverCell = wy >= 0 && wy < renderer.h ? { x: Math.floor(((wx % renderer.w) + renderer.w) % renderer.w), y: Math.floor(wy) } : null;
  }
  if (pointers.size >= 2 && pinch) {
    const n = pinchState();
    if (pinch.dist > 8) renderer.zoomAt(n.cx, n.cy, n.dist / pinch.dist);
    renderer.pan(n.cx - pinch.cx, n.cy - pinch.cy);
    pinch = n;
    return;
  }
  if (dragging && prev) {
    const dx = p.x - prev.x, dy = p.y - prev.y;
    if (Math.hypot(p.x - downPos.x, p.y - downPos.y) > 8) moved = true;
    renderer.pan(dx, dy);
  } else if (brushing && e.buttons) {
    if (Math.hypot(p.x - downPos.x, p.y - downPos.y) > 8) moved = true;
    applyBrush(p.x, p.y, false);
  } else if (e.pointerType === 'mouse' && !hoverTimer && renderer.hoverCell) {
    hoverTimer = window.setTimeout(() => {
      hoverTimer = 0;
      if (renderer.hoverCell) client.send({ t: 'cell', x: renderer.hoverCell.x + 0.5, y: renderer.hoverCell.y + 0.5 });
    }, 120);
  }
  if (e.pointerType === 'mouse' && !renderer.hoverCell) $('tip').hidden = true;
});

function endPointer(e: PointerEvent, cancelled = false) {
  const p = rel(e);
  const wasTap = !cancelled && !moved && pointers.size === 1 && performance.now() - downAt < 600;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (wasTap && dragging && tool === 'observe' && e.button <= 0) {
    // toque/clique simples: seleciona o organismo mais próximo (tolerância ~22 px, adequada a dedos)
    const [wx, wy] = renderer.screenToWorld(p.x, p.y);
    if (wy < 0 || wy >= renderer.h) return finishPointer(); // toque fora do planeta: ignora
    tapWorld = { x: ((wx % renderer.w) + renderer.w) % renderer.w, y: wy };
    client.send({ t: 'inspect', x: tapWorld.x, y: tapWorld.y, r: Math.max(0.6, (e.pointerType === 'mouse' ? 14 : 24) / renderer.zoom) });
  }
  finishPointer();
}
function finishPointer() {
  if (pointers.size === 0) {
    dragging = false;
    brushing = false;
    canvas.classList.remove('drag');
  } else if (pointers.size === 1) {
    // sobrou um dedo após a pinça: evita saltos
    const [only] = pointers.values();
    downPos = only;
    moved = true;
  }
}
let tapWorld: { x: number; y: number } | null = null;
let pendingTapTip: { x: number; y: number } | null = null;
canvas.addEventListener('pointerup', (e) => endPointer(e));
canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse') {
    renderer.pointer.inside = false;
    renderer.dirty = true;
    $('tip').hidden = true;
  }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  renderer.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

function applyBrush(sx: number, sy: number, first: boolean) {
  const [wx, wy] = renderer.screenToWorld(sx, sy);
  if (wy < 0 || wy >= renderer.h) return;
  const oneShot = tool === 'seed' || tool === 'erupt' || tool === 'impact' || tool === 'archetype';
  const now = performance.now();
  if (!first && (oneShot || now - lastPaint < 60)) return;
  lastPaint = now;
  client.send({ t: 'paint', mode: tool as PaintMode, x: ((wx % renderer.w) + renderer.w) % renderer.w, y: wy, r: renderer.brush.r, kind: archetype });
}

client.onCell = (c: CellInfo) => {
  const tip = $('tip');
  const byTap = pendingTapTip && Math.floor(pendingTapTip.x) === c.x && Math.floor(pendingTapTip.y) === c.y;
  if (!byTap && (!renderer.hoverCell || renderer.hoverCell.x !== c.x || renderer.hoverCell.y !== c.y)) return;
  const [tx, ty] = renderer.worldToScreen(c.x + 0.5, c.y + 0.5);
  const r = byTap ? { x: tx, y: ty } : renderer.pointer;
  tip.hidden = false;
  if (byTap) {
    clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => (tip.hidden = true), 4500);
    pendingTapTip = null;
  }
  tip.innerHTML = `<b>Célula ${c.x},${c.y}</b><br><span class="k">Temperatura</span><span class="mono">${c.temp.toFixed(1)} °C</span><br><span class="k">Luz</span><span class="mono">${c.light.toFixed(2)}</span><br><span class="k">Profundidade</span><span class="mono">${(c.depth * 100).toFixed(0)}%</span><br><span class="k">Nutrientes</span><span class="mono">${c.nutrient.toFixed(1)}</span><br><span class="k">Detritos</span><span class="mono">${c.detritus.toFixed(2)}</span><br><span class="k">Organismos</span><span class="mono">${c.count} (biomassa ${c.biomass.toFixed(1)})</span>${c.top.map((t) => `<br><i>${esc(t.name)}</i> <span class="mono">×${t.n}</span>`).join('')}`;
  tip.style.left = Math.min(canvas.clientWidth - 220, r.x + 16) + 'px';
  tip.style.top = Math.min(canvas.clientHeight - 180, r.y + 16) + 'px';
};

client.onInspect = (i, plant) => {
  if (!i && !plant && tapWorld) {
    // toque em área vazia: mostra os dados da célula (substitui o hover, que não existe no toque)
    pendingTapTip = { ...tapWorld };
    client.send({ t: 'cell', x: tapWorld.x, y: tapWorld.y });
  }
  inspected = i;
  inspectedPlant = plant;
  renderer.dirty = true;
  renderer.selectedOrganism = i ? { x: i.x, y: i.y } : null;
  if (i) {
    selectSpecies(i.speciesId, false);
    setSideTab('sp');
    if (isMobile) openSheet('side'); // no toque não há hover: mostra a ficha do organismo
  } else if (plant) {
    selectedLin = plant.lineageId;
    setSideTab('fl');
    if (isMobile) openSheet('side');
  }
  spRenderKey = '';
  renderSide();
};
client.onTerrain = (t) => renderer.setTerrain(t);
client.onTrail = (e) => {
  const el = document.getElementById('trail-strip');
  if (!el || Number(el.dataset.sp) !== e.species) return;
  if (e.items.length < 2) { el.innerHTML = '<span class="muted" style="font-size:11px">Ainda sem histórico suficiente (a trilha é amostrada a cada 400 ticks).</span>'; return; }
  el.innerHTML = e.items.map((it) => `<figure><canvas width="76" height="76" data-tvis="${it.vis.join(',')}"></canvas><figcaption>${formatAge(it.tick).replace(' milhões de anos', ' Ma').replace(' mil anos', ' ka').replace(' bilhões de anos', ' Ga')}</figcaption></figure>`).join('<span class="arrow">→</span>');
  el.querySelectorAll<HTMLCanvasElement>('canvas[data-tvis]').forEach((c) => drawPortrait(c, c.dataset.tvis!.split(',').map(Number), 0));
};

// ------------------------------------------------------------------ seleção de espécie
function selectSpecies(id: number, toggle = true) {
  if (toggle && id === selectedSp) id = 0;
  if (id && !selectedSp) layerBeforeSpecies = layer;
  selectedSp = id;
  renderer.species = id;
  renderer.dirty = true;
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
  if (t.id === 'btn-compare') { compareMode = !compareMode; spRenderKey = ''; renderSide(); return; }
  if (t.id === 'btn-compare-off') { compareSp = 0; compareMode = false; spRenderKey = ''; renderSide(); return; }
  const row = t.closest('[data-sp]') as HTMLElement | null;
  if (row && compareMode && selectedSp && Number(row.dataset.sp) !== selectedSp) { compareSp = Number(row.dataset.sp); compareMode = false; spRenderKey = ''; renderSide(); return; }
  if (row) selectSpecies(Number(row.dataset.sp));
});
$('pane-fl').addEventListener('click', (e) => {
  const row = (e.target as HTMLElement).closest('[data-pl]') as HTMLElement | null;
  if (row) { selectedLin = Number(row.dataset.pl) === selectedLin ? 0 : Number(row.dataset.pl); renderSide(); }
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
    const key = st.species.length + ':' + selectedSp + ':' + st.species.reduce((a, s) => a + s.count, 0) + ':' + showExtinct + ':' + (inspected?.id ?? 0) + ':' + (inspected ? inspected.age : 0) + ':' + compareSp + compareMode;
    if (key === spRenderKey) return;
    spRenderKey = key;
    const scroll = paneSp.scrollTop;
    paneSp.innerHTML =
      (inspected ? '<h4>Organismo selecionado</h4>' + inspectHtml(inspected) : '') +
      (sel && compareSp && st.species[compareSp - 1] && compareSp !== selectedSp ? compareHtml(sel, st.species[compareSp - 1]) : '') +
      (compareMode ? '<div class="card" style="border-color:var(--accent)">Clique noutra espécie da lista para compará-la com a selecionada.</div>' : '') +
      (sel ? '<h4>Espécie selecionada</h4>' + speciesDetailHtml(st, sel) : '<div class="muted" style="margin-bottom:8px">Clique numa espécie (ou num organismo no mapa) para ver sua distribuição, genoma e custos evolutivos.</div>') +
      speciesListHtml(st, selectedSp, showExtinct);
    paneSp.scrollTop = scroll;
    paneSp.querySelectorAll<HTMLCanvasElement>('canvas[data-vis]').forEach((c) => drawPortrait(c, c.dataset.vis!.split(',').map(Number), 0, 22));
    if (sel) client.send({ t: 'trail', species: sel.id });
    if (sel && compareSp && st.species[compareSp - 1]) {
      const ca = document.getElementById('cmp-a') as HTMLCanvasElement | null, cb = document.getElementById('cmp-b') as HTMLCanvasElement | null;
      if (ca) drawPortrait(ca, sel.vis, 0);
      if (cb) drawPortrait(cb, st.species[compareSp - 1].vis, 0);
    }
  } else if (sideTab === 'fl') {
    const pane = $('pane-fl');
    const scroll = pane.scrollTop;
    const lin: FloraLineageInfo | undefined = st.flora?.lineages.find((l) => l.id === selectedLin);
    pane.innerHTML = (inspectedPlant ? '<h4>Planta selecionada</h4>' + plantInspectHtml(inspectedPlant) : '') + (lin ? '<h4>Linhagem selecionada</h4>' + floraDetailHtml(lin, st) : '') + floraListHtml(st, selectedLin);
    pane.scrollTop = scroll;
    pane.querySelectorAll<HTMLCanvasElement>('canvas[data-pvis]').forEach((c) => drawPlantPortrait(c, c.dataset.pvis!.split(',').map(Number), 0));
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
  <div id="pl-biomes"></div>
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
  $('pl-biomes').innerHTML = biomesHtml(stats);
}

// ------------------------------------------------------------------ IA
$('pane-ai').innerHTML = `
  <h4>Diretora do planeta</h4>
  <div class="card">
    <div class="row sp-between"><label><input type="checkbox" id="ai-on" /> IA conectada</label><span id="ai-status" class="muted"><span class="dot"></span>desligada</span></div>
    <div class="muted" style="font-size:11px" id="ai-help">A simulação funciona integralmente sem IA. Sem conexão, o cronista local narra os fatos. Para usar um modelo de linguagem, defina a chave do provedor (<code>ANTHROPIC_API_KEY</code>, ou <code>EVOLVERE_AI_PROVIDER=openai</code> + <code>OPENAI_API_KEY</code>) e execute <code>npm run ai-proxy</code>: a chave fica no backend local, nunca no navegador.</div>
    <div class="row"><label><input type="checkbox" id="ai-auto" checked /> Crônica automática (a cada ~600 ticks, se houver novidades)</label></div>
    <div class="row" style="flex-wrap:wrap"><button id="ai-chron" class="primary">Escrever crônica</button><button id="ai-hyp">Hipóteses</button><button id="ai-evt">Propor acontecimentos</button><button id="ai-sp" class="s3only">Analisar espécie</button><button id="ai-bio" class="s3only">Narrar biomas</button></div>
    <div class="row"><label><input type="checkbox" id="ai-autoevt" /> Diretora autônoma: aplica propostas <b>validadas</b> (máx. 4 por 3000 ticks)</label></div>
    <div class="muted" style="font-size:11px">Acontecimentos são entradas ambientais (clima, nutrientes, geologia, variantes raras). A simulação decide quem sobrevive.</div>
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
  else el.innerHTML = `<span class="dot on"></span>${esc((s.provider ?? '') + ' · ' + (s.model ?? 'conectada'))}`;
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
$('ai-sp').onclick = async () => {
  if (!stats) return;
  const sp = selectedSp ? stats.species[selectedSp - 1] : stats.species.filter((x) => x.extinctTick < 0).sort((a, b) => b.count - a.count)[0];
  addChronicle(await director.analyzeSpecies(stats, sp ? `${sp.name} (id ${sp.id})` : ''));
};
$('ai-bio').onclick = async () => { if (stats) addChronicle(await director.narrateBiomes(stats)); };
$('ai-evt').onclick = async () => {
  if (!stats) return;
  if (!director.enabled) { $('ai-hyp-out').innerHTML = '<div class="card muted">Ative a IA para propor acontecimentos.</div>'; return; }
  $('ai-hyp-out').innerHTML = '<div class="card muted">Consultando…</div>';
  suggestions = await director.events(stats);
  hypText = suggestions.length ? '' : 'A IA não propôs nenhum acontecimento (ou não respondeu).';
  suggestionResults.clear();
  renderSuggestions();
};
let lastAutoEvt = 0;
async function autoEvents() {
  if (!stats || !director.enabled || !($('ai-autoevt') as HTMLInputElement).checked || stats.tick - lastAutoEvt < 1500) return;
  lastAutoEvt = stats.tick;
  const items = await director.events(stats);
  for (const it of items.slice(0, 2)) {
    const r = await client.suggest(it.suggestion, true); // auto: sujeito a limite de frequência
    addChronicle({ title: `Diretora: ${it.suggestion.title ?? it.suggestion.type}`, text: `${it.suggestion.narrative ?? it.rationale} → ${r.ok ? 'aceito' : 'recusado'} pelo motor: ${r.reason}`, source: 'ai', tick: stats.tick });
  }
}
function renderSuggestions() {
  const out = $('ai-hyp-out');
  if (!hypText && !suggestions.length) { out.innerHTML = '<div class="card muted">A IA não respondeu (verifique o proxy e a chave).</div>'; return; }
  const label = (s: SuggestionItem['suggestion']) => {
    const base = s.title ? `${s.title} — ` : '';
    switch (s.type) {
      case 'climate_shift': return `${base}variação climática de ${s.deltaT > 0 ? '+' : ''}${s.deltaT} °C`;
      case 'eruption': return `${base}erupção em (${s.x.toFixed(0)}, ${s.y.toFixed(0)}), massa ${s.amount.toFixed(0)}`;
      case 'nutrient_upwelling': return `${base}ressurgência em (${s.x.toFixed(0)}, ${s.y.toFixed(0)}), massa ${s.amount.toFixed(0)}`;
      case 'hypothesis': return `${base}hipótese${s.speciesId ? ` (espécie #${s.speciesId})` : ''}: ${s.text}`;
    }
  };
  out.innerHTML = `<h4>Propostas da IA</h4>${hypText ? `<div class="card" style="white-space:pre-wrap">${esc(hypText)}</div>` : ''}` + suggestions.map((it, i) => {
    const r = suggestionResults.get(i);
    return `<div class="sug"><b>${esc(label(it.suggestion))}</b><div class="muted">${esc(it.rationale)}</div><div class="row"><button data-sg="${i}" ${r ? 'disabled' : ''}>Submeter ao motor</button></div>${r ? `<div class="res ${r.ok ? 'ok' : 'no'}">${r.ok ? '✓ Aceita pelo motor: ' : '✕ Recusada pelo motor: '}${esc(r.reason)}</div>` : '<div class="muted" style="font-size:11px">O motor verifica se é permitido e coerente com o estado real do planeta.</div>'}</div>`;
  }).join('');
  out.querySelectorAll<HTMLButtonElement>('[data-sg]').forEach((b) => {
    b.onclick = async () => {
      const i = Number(b.dataset.sg);
      suggestionResults.set(i, await client.suggest(suggestions[i].suggestion, false));
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
  ($('lg-bar') as HTMLElement).style.background = lg.name === 'biome' ? `linear-gradient(90deg, ${BIOME_INFO.map((b, i) => `rgb(${b.color.join(',')}) ${(i / BIOME_INFO.length) * 100}% ${((i + 1) / BIOME_INFO.length) * 100}%`).join(',')})` : rampCss(lg.name);
  const unit = LAYER_INFO[lg.name as LayerKind].unit;
  $('lg-min').textContent = lg.name === 'ocean' ? 'raso' : lg.name === 'biome' ? 'água' : lg.name === 'moisture' || lg.name === 'vegetation' ? 'seco' : fmt(lg.min) + unit;
  $('lg-max').textContent = lg.name === 'ocean' ? 'abissal' : lg.name === 'biome' ? 'pântano' : lg.name === 'moisture' || lg.name === 'vegetation' ? 'úmido' : fmt(lg.max) + unit;
};

let lastStatsAt = 0;
client.onStats = (st) => {
  stats = st;
  if (!m0 || st.tick === 0) m0 = st.mass.organisms + st.mass.nutrient + st.mass.detritus + st.mass.reservoir + (st.mass.plants ?? 0);
  document.body.classList.toggle('stage3', st.stage3);
  $('r-age').textContent = isMobile ? formatAge(st.tick).replace(' milhões de anos', ' Ma').replace(' bilhões de anos', ' Ga').replace(' mil anos', ' ka') : formatAge(st.tick);
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
  if (now - lastStatsAt > renderer.quality.uiStatsMs) {
    lastStatsAt = now;
    // no celular, só redesenha o painel que está aberto
    if (!isMobile || sheet === 'side') renderSide();
    if (!isMobile || sheet === 'bottom') renderBottom();
  }
  // crônicas: periódicas e apenas quando há novidade
  if (st.tick - lastAutoChron >= 600 && ($('ai-auto') as HTMLInputElement).checked && st.pop > 0) {
    const hadNews = st.events.some((e) => e.tick > lastAutoChron);
    lastAutoChron = st.tick;
    if (hadNews) director.chronicle(st);
  }
  autoEvents();
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
  startWorld(seed, w, h, Number(($('in-pop') as HTMLInputElement).value), ($('in-stage3') as HTMLInputElement).checked);
};
function startWorld(sd: number, w = 96, h = 60, pop = 700, stage3 = true) {
  seed = sd;
  m0 = 0; selectedSp = 0; inspected = null; inspectedPlant = null; selectedLin = 0; compareSp = 0; compareMode = false; renderer.terrain = null; spRenderKey = ''; lastAutoChron = 0;
  renderer.species = 0; renderer.selectedOrganism = null;
  client.send({ t: 'init', cfg: { seed: sd, width: w, height: h, initialPopulation: pop, maxOrganisms: w * h * 9, stage3, maxPlants: Math.round(w * h * 2.2) } });
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
let slowSince = 0;
function frame(t: number) {
  requestAnimationFrame(frame);
  if (document.hidden) return;
  if (t - lastDraw < renderer.quality.minFrameMs) return;
  // só redesenha se algo mudou, ou se há criaturas detalhadas animadas na tela
  const animating = renderer.animate && !paused && renderer.lastDetailed > 0;
  if (!renderer.dirty && !animating) return;
  lastDraw = t;
  const t0 = performance.now();
  renderer.draw(t / 1000);
  drawCost = drawCost * 0.85 + (performance.now() - t0) * 0.15;
  // qualidade automática: se o desenho ficar lento por 3 s seguidos, desce um nível
  if (qualitySetting === 'auto') {
    if (drawCost > 22) {
      slowSince ||= t;
      if (t - slowSince > 3000 && qualityLevel !== 'low') applyQuality(qualityLevel === 'high' ? 'medium' : 'low');
    } else slowSince = 0;
  }
  // retratos animados (só o painel visível)
  if (stats && (!isMobile || sheet === 'side')) {
    const dp = document.getElementById('detail-portrait') as HTMLCanvasElement | null;
    if (dp && selectedSp && stats.species[selectedSp - 1]) drawPortrait(dp, stats.species[selectedSp - 1].vis, renderer.animate ? t / 1000 : 0);
    const ip = document.getElementById('inspect-portrait') as HTMLCanvasElement | null;
    if (ip && inspected) drawPortrait(ip, inspected.vis, renderer.animate ? t / 1000 : 0);
    const ca = document.getElementById('cmp-a') as HTMLCanvasElement | null, cb = document.getElementById('cmp-b') as HTMLCanvasElement | null;
    if (ca && selectedSp && stats.species[selectedSp - 1]) drawPortrait(ca, stats.species[selectedSp - 1].vis, renderer.animate ? t / 1000 : 0);
    if (cb && compareSp && stats.species[compareSp - 1]) drawPortrait(cb, stats.species[compareSp - 1].vis, renderer.animate ? t / 1000 : 0);
    const pp = document.getElementById('plant-portrait') as HTMLCanvasElement | null;
    const lin = stats.flora?.lineages.find((l) => l.id === selectedLin);
    if (pp && lin) drawPlantPortrait(pp, lin.vis, renderer.animate ? t / 1000 : 0);
    const pi = document.getElementById('plant-inspect') as HTMLCanvasElement | null;
    if (pi && inspectedPlant) drawPlantPortrait(pi, inspectedPlant.vis, renderer.animate ? t / 1000 : 0);
  }
}
window.addEventListener('resize', () => { updateMobile(); renderer.resize(); renderBottom(); });
new ResizeObserver(() => { renderer.resize(); renderBottom(); }).observe(canvas);

// ------------------------------------------------------------------ mobile: layout, folhas, menu
const app = $('app');
const mq = window.matchMedia('(max-width: 820px), (max-height: 520px) and (pointer: coarse)');
let isMobile = mq.matches;
let sheet: 'side' | 'bottom' | null = null;
function updateMobile() {
  isMobile = mq.matches;
  if (!isMobile) openSheet(null, true);
  app.classList.toggle('mobile', isMobile);
}
function openSheet(name: 'side' | 'bottom' | null, silent = false) {
  sheet = name;
  app.classList.toggle('sheet-side', name === 'side');
  app.classList.toggle('sheet-bottom', name === 'bottom');
  if (!silent) {
    spRenderKey = '';
    renderSide();
    requestAnimationFrame(renderBottom);
  }
  syncNav();
}
function syncNav() {
  const cur = sheet ?? (app.classList.contains('show-tools') ? 'tools' : app.classList.contains('show-layers') ? 'layers' : 'map');
  $('mnav').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.m === cur));
}
$('mnav').querySelectorAll('button').forEach((b) =>
  b.addEventListener('click', () => {
    const m = (b as HTMLElement).dataset.m!;
    const wasOn = b.classList.contains('on');
    app.classList.remove('show-tools', 'show-layers', 'menu-open');
    if (m === 'map' || wasOn) openSheet(null);
    else if (m === 'side' || m === 'bottom') openSheet(m);
    else {
      openSheet(null);
      app.classList.add(m === 'tools' ? 'show-tools' : 'show-layers');
    }
    syncNav();
    requestAnimationFrame(() => renderer.resize());
  }),
);
document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => openSheet(null)));
$('b-menu').onclick = () => {
  const open = app.classList.toggle('menu-open');
  $('b-menu').setAttribute('aria-expanded', String(open));
};
$('menu').addEventListener('click', () => app.classList.remove('menu-open'));
mq.addEventListener?.('change', updateMobile);

// ------------------------------------------------------------------ qualidade gráfica e segundo plano
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* privado/bloqueado */ } },
};
type QualitySetting = QualityLevel | 'auto';
let qualitySetting = (store.get('evolvere.quality') as QualitySetting) || 'auto';
let qualityLevel: QualityLevel = 'high';
let bgPause = (store.get('evolvere.bgpause') ?? (matchMedia('(pointer: coarse)').matches ? '1' : '0')) === '1';
function autoLevel(): QualityLevel {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mem = (navigator as any).deviceMemory as number | undefined;
  const cores = navigator.hardwareConcurrency || 4;
  if (coarse && ((mem !== undefined && mem <= 4) || cores <= 4)) return 'low';
  if (coarse || (mem !== undefined && mem <= 4)) return 'medium';
  return 'high';
}
function applyQuality(level: QualityLevel) {
  qualityLevel = level;
  const q = QUALITY[level];
  renderer.quality = q;
  client.send({ t: 'perf', frameMs: q.workerFrameMs, statsMs: q.workerStatsMs, budgetMs: q.workerBudgetMs });
  renderer.resize();
  renderer.dirty = true;
  $('gfx-info').textContent = `Nível em uso: ${level === 'high' ? 'alto' : level === 'medium' ? 'médio' : 'baixo'} · criaturas detalhadas: ${q.detailMax} · quadros ≤ ${Math.round(1000 / q.minFrameMs)} fps`;
}
function setQualitySetting(v: QualitySetting) {
  qualitySetting = v;
  store.set('evolvere.quality', v);
  slowSince = 0;
  applyQuality(v === 'auto' ? autoLevel() : v);
}
$('b-gfx').onclick = () => {
  ($('in-quality') as HTMLSelectElement).value = qualitySetting;
  ($('in-bgpause') as HTMLInputElement).checked = bgPause;
  ($('dlg-gfx') as HTMLDialogElement).showModal();
};
($('in-quality') as HTMLSelectElement).onchange = (e) => setQualitySetting((e.target as HTMLSelectElement).value as QualitySetting);
($('in-bgpause') as HTMLInputElement).onchange = (e) => { bgPause = (e.target as HTMLInputElement).checked; store.set('evolvere.bgpause', bgPause ? '1' : '0'); };
let pausedByHide = false;
document.addEventListener('visibilitychange', () => {
  client.send({ t: 'visible', v: !document.hidden });
  if (document.hidden && bgPause && !paused) { pausedByHide = true; togglePause(true); }
  else if (!document.hidden) {
    renderer.dirty = true;
    if (pausedByHide) { pausedByHide = false; togglePause(false); }
  }
});


// ------------------------------------------------------------------ início
director.checkStatus().then(renderAIStatus);
setSpeed(1);
updateMobile();
setQualitySetting(qualitySetting);
syncNav();
startWorld(1);
requestAnimationFrame(frame);
(window as any).__evolvere = { client, renderer, get stats() { return stats; }, get quality() { return qualityLevel; }, get isMobile() { return isMobile; }, get sheet() { return sheet; } };
