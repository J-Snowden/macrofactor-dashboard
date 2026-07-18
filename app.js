/* ============================================================
   app.js — state, controls, wiring
   ============================================================ */

const PRESETS = [
  { id: '1M', days: 30 },
  { id: '3M', days: 91 },
  { id: '6M', days: 182 },
  { id: '1Y', days: 365 },
  { id: 'All', days: null },
];

const state = {
  data: null,
  aligned: null,
  active: new Set(),
  mode: 'overlaid',
  view: [0, 1],
  goal: { on: false, value: 170 },
  smooth: { on: true, window: 30 },
  markers: [],
  tintPhases: true,
};

const $ = (s) => document.querySelector(s);
const els = {};

function init() {
  ['stats', 'metricList', 'presets', 'panels', 'overview', 'tooltip',
    'rangeTitle', 'modeSeg', 'fileName',
    'uploadBtn', 'fileInput', 'dropOverlay', 'toast',
    'smoothSwitch', 'smoothWin',
    'markBtn', 'markPop', 'tintSwitch', 'mkDate', 'mkLabel', 'mkSwatches',
    'mkAdd', 'markerList', 'mkListDiv', 'phaseBand', 'phaseTip'].forEach(id => els[id] = document.getElementById(id));

  renderPresets();
  wireControls();
  wireUpload();
  wireMarkers();
  wireHelp();
  renderSupported();
  wireLanding();
  window.addEventListener('resize', debounce(() => { Charts.resize(); Charts.fit(); alignOverview(); }, 120));

  // optional demo: open with #demo to auto-load the bundled sample dataset
  if (location.hash.indexOf('demo') >= 0 || location.search.indexOf('demo') >= 0) {
    if (window.SAMPLE_DATA) loadData(window.SAMPLE_DATA, 'sample data', true);
  }
}

/* ---------------- landing / upload screen ---------------- */
function renderSupported() {
  const wrap = document.getElementById('supportedList');
  if (!wrap) return;
  wrap.innerHTML = METRICS.filter(m => !m.derived).map(m =>
    `<div class="m"><span class="sw" style="background:var(${m.colorVar})"></span>${m.label}<span class="u">${m.unit}</span></div>`
  ).join('');
}
function wireLanding() {
  const drop = document.getElementById('landingDrop');
  if (drop) drop.addEventListener('click', () => els.fileInput.click());
  const demo = document.getElementById('demoLink');
  if (demo) demo.addEventListener('click', () => {
    if (window.SAMPLE_DATA) { loadData(window.SAMPLE_DATA, 'sample data', true); toast('Loaded sample data · explore away'); }
  });
}

/* ---------------- data loading ---------------- */
function loadData(data, fileName, isSample) {
  state.data = data;
  state.aligned = buildAligned(data);
  // leave the landing screen and reveal the dashboard
  const landing = document.getElementById('landing');
  const dash = document.getElementById('dashboard');
  const fp = document.getElementById('filePill');
  if (landing) landing.hidden = true;
  if (dash) dash.hidden = false;
  if (fp) fp.hidden = false;

  // default-on metrics that exist; keep previous selection where still available on re-upload
  if (!state.active.size || isSample) {
    state.active = new Set(METRICS.filter(m => m.def && state.aligned.available.has(m.key)).map(m => m.key));
  } else {
    state.active = new Set([...state.active].filter(k => state.aligned.available.has(k)));
    if (!state.active.size) state.active = new Set(METRICS.filter(m => m.def && state.aligned.available.has(m.key)).map(m => m.key));
  }

  state.view = state.aligned.range.slice();
  els.fileName.textContent = fileName || 'data';

  setupMarkersForLoad(isSample);

  recomputeSmoothing();
  renderMetricList();
  rebuildCharts();
  Brush.init(els.overview, state.aligned, (v) => setView(v, { from: 'brush' }));
  Brush.setView(state.view, true);
  renderStats();
  renderRangeTitle();
  highlightPreset();
  requestAnimationFrame(() => { Charts.fit(); alignOverview(); });
}

/* ---------------- charts ---------------- */
function recomputeSmoothing() {
  if (!state.aligned) return;
  const sm = {};
  if (state.smooth.on) {
    SMOOTHABLE.forEach(k => { if (state.aligned.byKey[k]) sm[k] = rollingMean(state.aligned.byKey[k], state.smooth.window); });
  }
  state.aligned._sm = sm;
}

function rebuildCharts() {
  Charts.build(state, state.aligned, {
    host: els.panels,
    tooltip: els.tooltip,
    card: els.panels.closest('.chart-card'),
    onView: (v) => setView(v, { from: 'chart' }),
  });
  Charts.applyXScale(state.view);
  requestAnimationFrame(alignOverview);
}

// inset the bottom scrubber so its date axis lines up with the chart's plotting
// area (which is inset by the y-axis), instead of spanning the full card width.
function alignOverview() {
  const host = els.overview;
  const ovEl = host && host.querySelector('.overview');
  const over = document.querySelector('.uplot .u-over');
  if (!host || !ovEl || !over) return;
  const hostRect = host.getBoundingClientRect();
  const overRect = over.getBoundingClientRect();
  ovEl.style.marginLeft = Math.max(0, Math.round(overRect.left - hostRect.left)) + 'px';
  ovEl.style.width = Math.round(overRect.width) + 'px';
  try { Brush.resize(); Brush.setView(state.view, true); } catch (e) {}
}

function setView(v, opts) {
  opts = opts || {};
  let [a, b] = v;
  const [dMin, dMax] = state.aligned.range;
  a = Math.max(dMin, Math.min(a, dMax));
  b = Math.max(dMin, Math.min(b, dMax));
  if (b - a < 4 * 86400) b = Math.min(dMax, a + 4 * 86400);
  state.view = [a, b];
  if (opts.from !== 'chart') Charts.applyXScale(state.view);
  else Charts.applyXScale(state.view); // keep all panels in lockstep
  if (opts.from !== 'brush') Brush.setView(state.view, true);
  renderStats();
  renderRangeTitle();
  highlightPreset();
}

/* ---------------- metric toggles ---------------- */
function renderMetricList() {
  const wrap = els.metricList;
  wrap.innerHTML = '';
  SIDE_GROUPS.forEach(grp => {
    const regs = METRICS.filter(m => m.group === grp.id);
    if (!regs.length) return;
    const g = document.createElement('div');
    g.className = 'metric-group';
    const gh = document.createElement('div');
    gh.className = 'gh';
    gh.textContent = grp.label;
    g.appendChild(gh);
    regs.forEach(reg => g.appendChild(makeToggle(reg)));
    wrap.appendChild(g);
  });
}

function makeToggle(reg) {
  const avail = state.aligned.available.has(reg.key);
  const on = state.active.has(reg.key);
  const b = document.createElement('button');
  b.className = 'toggle ' + (reg.type === 'dots' ? 'dots' : 'line') + (on ? ' on' : '') + (avail ? '' : ' disabled');
  b.style.setProperty('--swatch', `var(${reg.colorVar})`);
  b.dataset.key = reg.key;
  b.innerHTML =
    `<span class="sw"></span>` +
    `<span class="lbl">${reg.label}</span>` +
    (avail
      ? `<span class="check"><svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 5.5 4.3 8 9 2.5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`
      : `<span class="tag">no data</span>`);
  if (avail) {
    b.addEventListener('click', () => toggleMetric(reg.key));
  } else {
    b.title = 'This column is empty or missing in your file.';
  }
  return b;
}

function toggleMetric(key) {
  if (state.active.has(key)) state.active.delete(key);
  else state.active.add(key);
  els.metricList.querySelector(`.toggle[data-key="${key}"]`)?.classList.toggle('on', state.active.has(key));
  rebuildCharts();
  renderStats();
  updateToggleValues();
}

/* latest value badges on each available toggle (within current view) */
function updateToggleValues() {
  const { x, byKey } = state.aligned;
  const i1 = upperBound(x, state.view[1]);
  METRICS.forEach(reg => {
    if (!state.aligned.available.has(reg.key)) return;
    const el = els.metricList.querySelector(`.toggle[data-key="${reg.key}"] [data-val]`);
    if (!el) return;
    const v = valueAt(byKey[reg.key], Math.min(i1 - 1, x.length - 1), 8);
    const dp = (reg.unit === 'lb' || reg.unit === '%') ? 1 : 0;
    el.textContent = v == null ? '' : (reg.key === 'balance' ? fmtSigned(v, dp) : fmtNum(v, dp)) + (reg.unit === '%' ? '' : ' ' + reg.unit);
  });
}

/* ---------------- stat cards ---------------- */
function renderStats() {
  const s = computeStats(state.aligned, state.view[0], state.view[1]);
  const av = state.aligned.available;
  const cards = [];

  // weight change
  if (av.has('trend') || av.has('weight')) {
    const c = s.weightChange;
    const dir = c == null ? 'flat' : (c < 0 ? 'down' : (c > 0 ? 'up' : 'flat'));
    cards.push({
      k: 'Weight change', v: c == null ? '–' : fmtSigned(c, 1), u: 'lb',
      d: (s.weightStart != null && s.weightEnd != null) ? `${fmtNum(s.weightStart, 1)} → ${fmtNum(s.weightEnd, 1)}` : '', dir,
    });
    cards.push({
      k: 'Rate', v: s.weeklyRate == null ? '–' : fmtSigned(s.weeklyRate, 2), u: 'lb/wk',
      d: 'trend over range', dir: s.weeklyRate == null ? 'flat' : (s.weeklyRate < 0 ? 'down' : 'up'),
    });
  }
  if (av.has('calories')) cards.push({ k: 'Avg intake', v: s.avgCalories == null ? '–' : fmtNum(s.avgCalories), u: 'kcal', d: 'per day', dir: 'flat' });
  if (av.has('expenditure')) cards.push({ k: 'Avg expenditure', v: s.avgExpenditure == null ? '–' : fmtNum(s.avgExpenditure), u: 'kcal', d: 'per day', dir: 'flat' });
  if (av.has('balance')) {
    const b = s.avgBalance;
    cards.push({ k: 'Avg balance', v: b == null ? '–' : fmtSigned(b), u: 'kcal', d: b == null ? '' : (b < 0 ? 'deficit / day' : 'surplus / day'), dir: b == null ? 'flat' : (b < 0 ? 'down' : 'up') });
  }
  if (cards.length < 5 && av.has('protein')) cards.push({ k: 'Avg protein', v: s.avgProtein == null ? '–' : fmtNum(s.avgProtein), u: 'g', d: 'per day', dir: 'flat' });

  els.stats.innerHTML = cards.slice(0, 5).map(c =>
    `<div class="stat"><div class="k">${c.k}</div>` +
    `<div class="v">${c.v}<span class="u">${c.v === '–' ? '' : c.u}</span></div>` +
    `<div class="d ${c.dir}">${c.d || ''}</div></div>`
  ).join('');

  updateToggleValues();
}

/* ---------------- presets & range title ---------------- */
function renderPresets() {
  els.presets.innerHTML = PRESETS.map(p => `<button class="preset" data-id="${p.id}">${p.id}</button>`).join('');
  els.presets.querySelectorAll('.preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = PRESETS.find(x => x.id === btn.dataset.id);
      const [dMin, dMax] = state.aligned.range;
      const a = p.days == null ? dMin : Math.max(dMin, dMax - p.days * 86400);
      setView([a, dMax]);
    });
  });
}
function highlightPreset() {
  const [dMin, dMax] = state.aligned.range;
  const span = state.view[1] - state.view[0];
  const atEnd = Math.abs(state.view[1] - dMax) < 2 * 86400;
  let match = null;
  if (atEnd) {
    for (const p of PRESETS) {
      const want = p.days == null ? (dMax - dMin) : p.days * 86400;
      if (Math.abs(span - want) < 4 * 86400 || (p.days == null && Math.abs(state.view[0] - dMin) < 2 * 86400)) { match = p.id; break; }
    }
  }
  els.presets.querySelectorAll('.preset').forEach(b => b.classList.toggle('on', b.dataset.id === match));
}
function renderRangeTitle() {
  const [a, b] = state.view;
  els.rangeTitle.textContent = `${fmtDate(a, true)} – ${fmtDate(b, true)}`;
}

/* ---------------- controls ---------------- */
function wireControls() {
  els.modeSeg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === state.mode) return;
      els.modeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
      state.mode = btn.dataset.mode;
      rebuildCharts();
    });
  });

  els.smoothSwitch.addEventListener('click', () => {
    state.smooth.on = !state.smooth.on;
    els.smoothSwitch.classList.toggle('on', state.smooth.on);
    els.smoothWin.classList.toggle('disabled', !state.smooth.on);
    recomputeSmoothing();
    rebuildCharts();
  });
  els.smoothWin.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      els.smoothWin.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
      state.smooth.window = parseInt(btn.dataset.w, 10);
      if (state.smooth.on) { recomputeSmoothing(); rebuildCharts(); }
    });
  });

  // display-settings popover
  const dispBtn = document.getElementById('dispBtn');
  const dispPop = document.getElementById('dispPop');
  if (dispBtn && dispPop) {
    const close = () => { dispPop.hidden = true; dispBtn.classList.remove('on'); dispBtn.setAttribute('aria-expanded', 'false'); };
    const open = () => { const mp = document.getElementById('markPop'); if (mp && !mp.hidden) { mp.hidden = true; document.getElementById('markBtn').classList.remove('on'); } dispPop.hidden = false; dispBtn.classList.add('on'); dispBtn.setAttribute('aria-expanded', 'true'); };
    dispBtn.addEventListener('click', (e) => { e.stopPropagation(); dispPop.hidden ? open() : close(); });
    dispPop.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { if (!dispPop.hidden) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dispPop.hidden) close(); });
  }
}
function redrawCharts() {
  // cheap redraw without rebuilding instances
  rebuildCharts();
}

/* ---------------- upload ---------------- */
function wireUpload() {
  els.uploadBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
    els.fileInput.value = '';
  });
  let depth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; els.dropOverlay.classList.add('show'); });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('dragleave', (e) => { e.preventDefault(); depth--; if (depth <= 0) { depth = 0; els.dropOverlay.classList.remove('show'); } });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; els.dropOverlay.classList.remove('show');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
}

async function handleFile(file) {
  if (!/\.xlsx$/i.test(file.name)) { toast('Please upload a .xlsx file', true); return; }
  try {
    toast('Reading ' + file.name + '…');
    const parsed = await window.parseXlsxFile(file);
    const found = Object.values(parsed.metrics).reduce((s, a) => s + a.length, 0);
    loadData(parsed, file.name, false);
    toast('Loaded ' + file.name + ' · ' + found.toLocaleString() + ' points');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Could not read that file', true);
  }
}

let toastTimer;
function toast(msg, err) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('err', !!err);
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// bridge for the Tweaks island: re-read CSS-var colors into the canvases
window.refreshVisuals = function () {
  if (!state.aligned) return;
  rebuildCharts();
  try { if (window.Markers) Markers.refreshColors(); } catch (e) {}
  try { Brush.refresh(state.aligned); Brush.setView(state.view, true); } catch (e) {}
};

/* ---------------- phase markers ---------------- */
const MARKERS_KEY = 'mf_markers_v1';
let mkColor = 'auto';

function uid() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function dayFloor(sec) { return Math.floor(sec / 86400) * 86400; }
function isoDate(sec) { return new Date(sec * 1000).toISOString().slice(0, 10); }
function escAttr(s) { return ('' + s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
const X_SVG = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2.5 2.5 8.5 8.5M8.5 2.5 2.5 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const DROP_SVG = '<svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor"><path d="M6.5 1.5S10 5.2 10 7.6a3.5 3.5 0 0 1-7 0C3 5.2 6.5 1.5 6.5 1.5Z"/></svg>';

function saveMarkers() {
  try { localStorage.setItem(MARKERS_KEY, JSON.stringify({ markers: state.markers, tint: state.tintPhases })); } catch (e) {}
}
function loadMarkersStore() {
  try {
    const j = JSON.parse(localStorage.getItem(MARKERS_KEY) || 'null');
    if (j && typeof j.tint === 'boolean') state.tintPhases = j.tint;
    if (j && Array.isArray(j.markers) && j.markers.length) {
      state.markers = j.markers;
      return true;
    }
  } catch (e) {}
  return false;
}
function demoMarkers(range) {
  const day = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 1000 / 86400) * 86400;
  return [
    { id: uid(), t: day(2022, 12, 15), label: 'Diet', color: 'oklch(0.72 0.12 80)' },
    { id: uid(), t: day(2025, 1, 1), label: 'Recomp', color: 'oklch(0.58 0.13 300)' },
    { id: uid(), t: day(2026, 2, 1), label: 'Cut', color: 'oklch(0.64 0.11 195)' },
  ];
}

function setupMarkersForLoad(isSample) {
  const hadStore = loadMarkersStore();
  // Real uploads always start with NO phases. Demo (#demo) seeds examples in-memory only.
  if (!hadStore) state.markers = isSample ? demoMarkers(state.aligned.range) : [];
  Markers.configure({
    card: els.panels.closest('.chart-card'),
    band: els.phaseBand,
    tip: els.phaseTip,
    aligned: state.aligned,
    range: state.aligned.range,
    onZoom: (p) => togglePhaseZoom(p),
  });
  Markers.setMarkers(state.markers, state.tintPhases);
  const [lo, hi] = state.aligned.range;
  if (els.mkDate) {
    els.mkDate.min = isoDate(lo);
    els.mkDate.max = isoDate(hi);
    els.mkDate.value = isoDate(dayFloor((lo + hi) / 2));
  }
  if (els.tintSwitch) els.tintSwitch.classList.toggle('on', state.tintPhases);
  renderSwatches();
  renderMarkerList();
}

function applyMarkers() {
  Markers.setMarkers(state.markers, state.tintPhases);
  Markers.setRange(state.aligned.range);
  Markers.redraw();
  renderMarkerList();
}

function addMarker() {
  if (!state.aligned) return;
  const val = els.mkDate.value;
  if (!val) { toast('Pick a date', true); return; }
  const t = dayFloor(isoToSec(val));
  const [lo, hi] = state.aligned.range;
  if (t < lo || t > hi) { toast('That date is outside your data range', true); return; }
  if (state.markers.some(m => m.t === t)) { toast('A marker already exists on that date', true); return; }
  const label = (els.mkLabel.value || '').trim() || 'New phase';
  state.markers.push({ id: uid(), t, label, color: mkColor, tint: true });
  state.markers.sort((a, b) => a.t - b.t);
  els.mkLabel.value = '';
  mkColor = 'auto'; renderSwatches();
  saveMarkers(); applyMarkers();
  toast('Marker added · ' + label);
}
function removeMarker(id) {
  state.markers = state.markers.filter(m => m.id !== id);
  saveMarkers(); applyMarkers();
}
function renameMarker(id, label) {
  const m = state.markers.find(x => x.id === id); if (!m) return;
  m.label = label || 'Phase';
  saveMarkers();
  Markers.setMarkers(state.markers, state.tintPhases);
  Markers.redraw();
}
function recolorMarker(id, color) {
  const m = state.markers.find(x => x.id === id); if (!m) return;
  m.color = color;
  saveMarkers();
  Markers.setMarkers(state.markers, state.tintPhases);
  Markers.redraw();
  renderMarkerList();
}
function toggleMarkerTint(id) {
  const m = state.markers.find(x => x.id === id); if (!m) return;
  m.tint = (m.tint === false);
  saveMarkers();
  Markers.setMarkers(state.markers, state.tintPhases);
  Markers.redraw();
  renderMarkerList();
}
function changeMarkerDate(id, iso) {
  if (!iso) { renderMarkerList(); return; }
  const t = dayFloor(isoToSec(iso));
  const [lo, hi] = state.aligned.range;
  if (t < lo || t > hi) { toast('That date is outside your data range', true); renderMarkerList(); return; }
  if (state.markers.some(x => x.id !== id && x.t === t)) { toast('Another marker is already on that date', true); renderMarkerList(); return; }
  const m = state.markers.find(x => x.id === id); if (!m) return;
  m.t = t; state.markers.sort((a, b) => a.t - b.t);
  saveMarkers(); applyMarkers();
}
// click a phase to zoom to it; click the same (already-zoomed) phase to zoom back out
function togglePhaseZoom(p) {
  const [a, b] = state.view;
  const atPhase = Math.abs(a - p.t0) < 86400 && Math.abs(b - p.t1) < 86400;
  setView(atPhase ? state.aligned.range.slice() : [p.t0, p.t1]);
}

function renderSwatches() {
  const wrap = els.mkSwatches; if (!wrap) return;
  const opts = ['auto', ...Markers.PALETTE];
  wrap.innerHTML = '';
  opts.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mk-sw' + (c === 'auto' ? ' auto' : '') + (c === mkColor ? ' sel' : '');
    if (c !== 'auto') b.style.setProperty('--pc', c);
    if (c === 'auto') b.textContent = 'A';
    b.title = c === 'auto' ? 'Auto-assign' : 'Custom color';
    b.addEventListener('click', () => { mkColor = c; renderSwatches(); });
    wrap.appendChild(b);
  });
}

function renderMarkerList() {
  const wrap = els.markerList; if (!wrap) return;
  const ms = [...state.markers].sort((a, b) => a.t - b.t);
  if (els.mkListDiv) els.mkListDiv.style.display = ms.length ? '' : 'none';
  if (!ms.length) { wrap.innerHTML = ''; return; }
  const [lo, hi] = state.aligned.range;
  wrap.innerHTML = '';
  ms.forEach((m, i) => {
    const color = Markers.colorOf(m, i);
    const row = document.createElement('div');
    row.className = 'mk-row';

    const dot = document.createElement('button');
    dot.className = 'mk-dot'; dot.style.setProperty('--pc', color); dot.title = 'Change color';

    const label = document.createElement('input');
    label.className = 'mk-row-label'; label.value = m.label; label.maxLength = 28;
    label.addEventListener('change', () => renameMarker(m.id, label.value.trim()));
    label.addEventListener('keydown', (e) => { if (e.key === 'Enter') label.blur(); });

    const dateBtn = document.createElement('button');
    dateBtn.className = 'mk-date-btn'; dateBtn.textContent = fmtDate(m.t, true); dateBtn.title = 'Change date';
    dateBtn.addEventListener('click', () => {
      const di = document.createElement('input');
      di.type = 'date'; di.className = 'mk-date-input';
      di.value = isoDate(m.t); di.min = isoDate(lo); di.max = isoDate(hi);
      di.addEventListener('change', () => changeMarkerDate(m.id, di.value));
      di.addEventListener('blur', () => { if (!di.value || di.value === isoDate(m.t)) renderMarkerList(); });
      row.replaceChild(di, dateBtn);
      di.focus();
      if (di.showPicker) { try { di.showPicker(); } catch (e) {} }
    });

    const tint = document.createElement('button');
    tint.className = 'mk-tint ' + (m.tint === false ? '' : 'on');
    tint.style.setProperty('--pc', color);
    tint.title = m.tint === false ? 'Tint off — click to show' : 'Tint on — click to hide';
    tint.innerHTML = DROP_SVG;
    tint.addEventListener('click', () => toggleMarkerTint(m.id));

    const del = document.createElement('button');
    del.className = 'mk-del'; del.title = 'Delete marker'; del.innerHTML = X_SVG;
    del.addEventListener('click', () => removeMarker(m.id));

    row.append(dot, label, dateBtn, tint, del);
    wrap.appendChild(row);

    // inline color picker, toggled by the dot
    const editor = document.createElement('div');
    editor.className = 'mk-color-edit'; editor.hidden = true;
    ['auto', ...Markers.PALETTE].forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mk-sw' + (c === 'auto' ? ' auto' : '') + (((m.color || 'auto') === c) ? ' sel' : '');
      if (c !== 'auto') b.style.setProperty('--pc', c);
      if (c === 'auto') b.textContent = 'A';
      b.title = c === 'auto' ? 'Auto-assign' : 'Custom color';
      b.addEventListener('click', () => recolorMarker(m.id, c));
      editor.appendChild(b);
    });
    wrap.appendChild(editor);
    dot.addEventListener('click', () => {
      const open = editor.hidden;
      wrap.querySelectorAll('.mk-color-edit').forEach(e => { e.hidden = true; });
      editor.hidden = !open;
    });
  });
}

function wireMarkers() {
  const btn = els.markBtn, pop = els.markPop;
  if (btn && pop) {
    const close = () => { pop.hidden = true; btn.classList.remove('on'); btn.setAttribute('aria-expanded', 'false'); };
    const open = () => {
      const dp = document.getElementById('dispPop');
      if (dp && !dp.hidden) { dp.hidden = true; document.getElementById('dispBtn').classList.remove('on'); }
      pop.hidden = false; btn.classList.add('on'); btn.setAttribute('aria-expanded', 'true');
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden ? open() : close(); });
    pop.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { if (!pop.hidden) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) close(); });
  }
  if (els.mkAdd) els.mkAdd.addEventListener('click', addMarker);
  if (els.mkLabel) els.mkLabel.addEventListener('keydown', (e) => { if (e.key === 'Enter') addMarker(); });
  if (els.tintSwitch) els.tintSwitch.addEventListener('click', () => {
    state.tintPhases = !state.tintPhases;
    els.tintSwitch.classList.toggle('on', state.tintPhases);
    saveMarkers();
    Markers.setMarkers(state.markers, state.tintPhases);
    Markers.redraw();
  });
}

function wireHelp() {
  const btn = document.getElementById('helpBtn');
  const ov = document.getElementById('helpOverlay');
  const close = document.getElementById('helpClose');
  if (!btn || !ov) return;
  const show = () => ov.classList.add('show');
  const hide = () => ov.classList.remove('show');
  btn.addEventListener('click', show);
  if (close) close.addEventListener('click', hide);
  ov.addEventListener('click', (e) => { if (e.target === ov) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov.classList.contains('show')) hide(); });
}

document.addEventListener('DOMContentLoaded', init);
