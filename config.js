/* ============================================================
   config.js — metric registry, alignment, stats helpers
   (plain globals, shared across scripts)
   ============================================================ */

const DAY = 86400; // seconds

// read a CSS custom property color so theme tweaks reflow into charts
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Metric registry. `group` -> stacked panel.  `derived` metrics are computed.
const METRICS = [
  { key: 'weight',      label: 'Scale weight',   short: 'Weight',     unit: 'lb',   group: 'body',    colorVar: '--c-weight',      type: 'dots', def: false  },
  { key: 'trend',       label: 'Weight trend',   short: 'Trend',      unit: 'lb',   group: 'body',    colorVar: '--c-trend',       type: 'spline', def: true },
  { key: 'bodyfat',     label: 'Body fat',       short: 'Body fat',   unit: '%',    group: 'bodyfat', colorVar: '--c-bodyfat',     type: 'spline', def: false },
  { key: 'expenditure', label: 'Expenditure',    short: 'Expend.',    unit: 'kcal', group: 'energy',  colorVar: '--c-expenditure', type: 'line', def: true  },
  { key: 'calories',    label: 'Calories eaten', short: 'Calories',   unit: 'kcal', group: 'energy',  colorVar: '--c-calories',    type: 'line', def: true  },
  { key: 'balance',     label: 'Energy balance', short: 'Balance',    unit: 'kcal', group: 'balance', colorVar: '--c-balance',     type: 'area', def: false, derived: true },
  { key: 'protein',     label: 'Protein',        short: 'Protein',    unit: 'g',    group: 'macros',  colorVar: '--c-protein',     type: 'line', def: false },
  { key: 'carbs',       label: 'Carbs',          short: 'Carbs',      unit: 'g',    group: 'macros',  colorVar: '--c-carbs',       type: 'line', def: false },
  { key: 'fat',         label: 'Fat',            short: 'Fat',        unit: 'g',    group: 'macros',  colorVar: '--c-fat',         type: 'line', def: false },
];
const METRIC_BY_KEY = Object.fromEntries(METRICS.map(m => [m.key, m]));

// stacked-panel groups, in display order
const GROUPS = [
  { id: 'body',    label: 'Body weight',    unit: 'lb',   h: 218 },
  { id: 'energy',  label: 'Energy',         unit: 'kcal', h: 188 },
  { id: 'balance', label: 'Energy balance', unit: 'kcal', h: 134 },
  { id: 'bodyfat', label: 'Body fat',       unit: '%',    h: 150 },
  { id: 'macros',  label: 'Macros',         unit: 'g',    h: 186 },
];

// sidebar grouping for the toggle list
const SIDE_GROUPS = [
  { id: 'body',    label: 'Body' },
  { id: 'energy',  label: 'Energy' },
  { id: 'balance', label: 'Balance' },
  { id: 'macros',  label: 'Macros' },
  { id: 'bodyfat', label: 'Composition' },
];

function isoToSec(iso) {
  return Math.floor(Date.parse(iso + 'T00:00:00Z') / 1000);
}

/* Build a unified daily timeline (seconds) spanning all metric data, and align
   every metric onto it with nulls in the gaps. Derives `balance` = calories - expenditure.
   Returns { x:[], byKey:{}, available:Set, range:[min,max] } */
function buildAligned(data) {
  const m = data.metrics || {};
  // collect min/max date across all raw metrics
  let lo = Infinity, hi = -Infinity;
  const maps = {};
  for (const key of Object.keys(m)) {
    const arr = m[key] || [];
    const map = new Map();
    for (const [iso, v] of arr) {
      const t = isoToSec(iso);
      map.set(t, v);
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    maps[key] = map;
  }
  if (!isFinite(lo)) { lo = hi = Math.floor(Date.now() / 1000); }

  // daily timeline
  const x = [];
  for (let t = lo; t <= hi; t += DAY) x.push(t);

  const byKey = {};
  const available = new Set();

  // raw metrics
  for (const reg of METRICS) {
    if (reg.derived) continue;
    const map = maps[reg.key];
    const out = new Array(x.length).fill(null);
    let n = 0;
    if (map) {
      for (let i = 0; i < x.length; i++) {
        const v = map.get(x[i]);
        if (v != null) { out[i] = v; n++; }
      }
    }
    byKey[reg.key] = out;
    if (n > 0) available.add(reg.key);
  }

  // derived: energy balance = calories - expenditure (only where both exist)
  const cal = byKey.calories, exp = byKey.expenditure;
  const bal = new Array(x.length).fill(null);
  let nb = 0;
  for (let i = 0; i < x.length; i++) {
    if (cal && exp && cal[i] != null && exp[i] != null) { bal[i] = cal[i] - exp[i]; nb++; }
  }
  byKey.balance = bal;
  if (nb > 0) available.add('balance');

  return { x, byKey, available, range: [lo, hi] };
}

// nearest non-null value at-or-before index (for sparse series readouts)
function valueAt(arr, idx, maxBack = 6) {
  if (!arr) return null;
  if (arr[idx] != null) return arr[idx];
  for (let b = 1; b <= maxBack; b++) {
    if (idx - b >= 0 && arr[idx - b] != null) return arr[idx - b];
  }
  return null;
}

function fmtNum(v, dp = 0) {
  if (v == null || isNaN(v)) return '–';
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtSigned(v, dp = 0) {
  if (v == null || isNaN(v)) return '–';
  const s = v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return v > 0 ? '+' + s : s;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(sec, withYear) {
  const d = new Date(sec * 1000);
  const s = MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
  return withYear ? s + ', ' + d.getUTCFullYear() : s;
}
function fmtDateLong(sec) {
  const d = new Date(sec * 1000);
  const wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()];
  return wd + ' · ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}

/* range-aware summary statistics for the current view window [t0,t1] (seconds) */
function computeStats(aligned, t0, t1) {
  const { x, byKey } = aligned;
  const i0 = lowerBound(x, t0), i1 = upperBound(x, t1);
  const slice = (arr) => arr ? arr.slice(i0, i1) : [];
  const firstLast = (arr) => {
    let f = null, l = null, fi = -1, li = -1;
    for (let i = i0; i < i1; i++) { if (arr[i] != null) { if (f == null) { f = arr[i]; fi = i; } l = arr[i]; li = i; } }
    return { f, l, fi, li };
  };
  const avg = (arr) => {
    let s = 0, n = 0;
    for (let i = i0; i < i1; i++) if (arr && arr[i] != null) { s += arr[i]; n++; }
    return n ? s / n : null;
  };
  const out = { i0, i1 };
  // weight change uses trend if available else scale weight
  const wsrc = (byKey.trend && firstLast(byKey.trend).f != null) ? byKey.trend : byKey.weight;
  const w = wsrc ? firstLast(wsrc) : { f: null, l: null, fi: -1, li: -1 };
  out.weightStart = w.f; out.weightEnd = w.l;
  out.weightChange = (w.f != null && w.l != null) ? w.l - w.f : null;
  // weekly rate
  if (w.fi >= 0 && w.li > w.fi && out.weightChange != null) {
    const weeks = (x[w.li] - x[w.fi]) / (7 * DAY);
    out.weeklyRate = weeks > 0 ? out.weightChange / weeks : null;
  } else out.weeklyRate = null;
  out.avgCalories = avg(byKey.calories);
  out.avgExpenditure = avg(byKey.expenditure);
  out.avgBalance = avg(byKey.balance);
  out.avgProtein = avg(byKey.protein);
  return out;
}

function lowerBound(arr, t) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; } return lo; }
function upperBound(arr, t) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) lo = m + 1; else hi = m; } return lo; }

// series that benefit from smoothing (raw daily logs are noisy)
const SMOOTHABLE = new Set(['calories', 'protein', 'carbs', 'fat', 'balance']);

// centered rolling mean over a daily array; ignores nulls, emits null only when
// the whole window is empty so the line spans logging gaps.
function rollingMean(arr, win) {
  if (!arr) return arr;
  const half = Math.floor(win / 2);
  const out = new Array(arr.length).fill(null);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, n = 0;
    const lo = Math.max(0, i - half), hi = Math.min(arr.length - 1, i + half);
    for (let j = lo; j <= hi; j++) if (arr[j] != null) { sum += arr[j]; n++; }
    if (n) out[i] = sum / n;
  }
  return out;
}
