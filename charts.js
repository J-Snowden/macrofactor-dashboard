/* ============================================================
   charts.js — uPlot panel builder
   Modes: 'stacked' (one synced panel per unit-group) | 'overlaid' (one chart, multi-axis)
   Plus: custom crosshair tooltip, wheel-zoom, drag-pan, dbl-click reset.
   ============================================================ */

const SYNC = uPlot.sync('mf');
window.TWK = window.TWK || { lineScale: 1 };
function lw(base) { return base * (window.TWK.lineScale || 1); }

/* resolve a CSS custom property to a concrete rgb() string for canvas use */
const _colorCache = {};
function resolveColor(varName) {
  if (_colorCache[varName]) return _colorCache[varName];
  const el = document.createElement('span');
  el.style.color = `var(${varName})`;
  el.style.display = 'none';
  document.body.appendChild(el);
  const c = getComputedStyle(el).color || '#888';
  el.remove();
  _colorCache[varName] = c;
  return c;
}
function withAlpha(rgb, a) {
  const m = rgb.match(/-?[\d.]+/g);
  if (!m) return rgb;
  return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${a})`;
}
function clearColorCache() { for (const k in _colorCache) delete _colorCache[k]; }

const Charts = (function () {
  let instances = [];   // { u, groupId }
  let host = null;      // container element
  let onView = null;    // callback(view)
  let tooltipEl = null;
  let cardEl = null;    // positioning origin for tooltip
  let aligned = null;
  let state = null;
  let suppress = false;

  function destroy() {
    instances.forEach(o => { try { o.u.destroy(); } catch (e) {} });
    instances = [];
    if (host) host.innerHTML = '';
  }

  function gridColor() { return resolveColor('--line'); }
  function tickColor() { return resolveColor('--ink-3'); }

  // overlaid chart grows to roughly fill the height of the metrics sidebar
  function estOverlaidHeight() {
    const side = document.querySelector('.side');
    const h = side ? side.offsetHeight : 0;
    return Math.max(430, Math.min(760, h - 150));
  }
  function fit() {
    const ov = instances.find(o => o.groupId === 'overlaid');
    if (!ov || !host) return;
    const side = document.querySelector('.side');
    if (!side || !ov.u.root) return;
    const plotRect = ov.u.root.getBoundingClientRect();
    const sideRect = side.getBoundingClientRect();
    const ovEl = document.getElementById('overview');
    const ovH = ovEl ? ovEl.offsetHeight : 0;
    const desiredBottom = sideRect.bottom - ovH - 16; // leave room for the scrubber
    const delta = desiredBottom - plotRect.bottom;
    let newH = Math.round(ov.u.height + delta);
    newH = Math.max(430, Math.min(760, newH));
    if (Math.abs(newH - ov.u.height) > 2) ov.u.setSize({ width: host.clientWidth, height: newH });
  }

  function axisCfg(extra) {
    return Object.assign({
      stroke: tickColor(),
      grid: { stroke: gridColor(), width: 1 },
      ticks: { stroke: gridColor(), width: 1, size: 4 },
      font: '11px "JetBrains Mono", monospace',
      size: 52,
      gap: 4,
    }, extra || {});
  }

  function makeSeries(reg, scaleKey) {
    const col = resolveColor(reg.colorVar);
    const s = { label: reg.label, scale: scaleKey, _key: reg.key, _unit: reg.unit, stroke: col, _color: col };
    if (reg.type === 'dots') {
      s.paths = () => null;
      s.points = { show: true, size: 5, fill: col, stroke: '#fff', width: 1 };
    } else if (reg.type === 'spline') {
      s.paths = uPlot.paths.spline();
      s.width = lw(2.5);
      s.spanGaps = true;
      s.points = { show: false };
    } else if (reg.type === 'area') {
      s.paths = uPlot.paths.linear();
      s.width = lw(1.25);
      s.spanGaps = true;
      s.fill = withAlpha(col, 0.16);
      s.fillTo = () => 0;
      s.points = { show: false };
    } else { // line
      s.paths = uPlot.paths.linear();
      s.width = lw(1.6);
      s.spanGaps = true;
      s.points = { show: false };
    }
    return s;
  }

  /* ---- interactions: wheel zoom, drag pan, dbl-click reset ---- */
  function attachInteractions(u) {
    const over = u.over;
    let dragging = false, lastX = 0, moved = false;

    over.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true; moved = false; lastX = e.clientX;
      over.setPointerCapture(e.pointerId);
      over.style.cursor = 'grabbing';
    });
    over.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      if (Math.abs(dx) < 1) return;
      moved = true; lastX = e.clientX;
      const { min, max } = u.scales.x;
      const secPerPx = (max - min) / u.over.clientWidth;
      let shift = -dx * secPerPx;
      let nmin = min + shift, nmax = max + shift;
      const [dMin, dMax] = aligned.range;
      if (nmin < dMin) { nmax += (dMin - nmin); nmin = dMin; }
      if (nmax > dMax) { nmin -= (nmax - dMax); nmax = dMax; }
      nmin = Math.max(dMin, nmin); nmax = Math.min(dMax, nmax);
      emit([nmin, nmax]);
    });
    const end = (e) => { if (dragging) { dragging = false; over.style.cursor = 'crosshair'; } };
    over.addEventListener('pointerup', end);
    over.addEventListener('pointercancel', end);

    over.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = over.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width; // 0..1
      const { min, max } = u.scales.x;
      const span = max - min;
      const cursorT = min + fx * span;
      const factor = Math.pow(1.0018, e.deltaY);
      let nmin = cursorT - (cursorT - min) * factor;
      let nmax = cursorT + (max - cursorT) * factor;
      const [dMin, dMax] = aligned.range;
      const minSpan = 5 * 86400;
      if (nmax - nmin < minSpan) {
        const mid = (nmin + nmax) / 2; nmin = mid - minSpan / 2; nmax = mid + minSpan / 2;
      }
      nmin = Math.max(dMin, nmin); nmax = Math.min(dMax, nmax);
      if (nmax - nmin < minSpan) return;
      emit([nmin, nmax]);
    }, { passive: false });

    over.addEventListener('dblclick', () => { emit(aligned.range.slice()); });
    over.style.cursor = 'crosshair';
  }

  function emit(view) {
    if (onView) onView(view);
  }

  // resolve the array to PLOT for a metric (smoothed when enabled)
  function plotArr(key) {
    if (state.smooth && state.smooth.on && SMOOTHABLE.has(key) && aligned._sm && aligned._sm[key]) {
      return aligned._sm[key];
    }
    return aligned.byKey[key];
  }
  function smoothedKey(key) {
    return state.smooth && state.smooth.on && SMOOTHABLE.has(key);
  }

  /* ---- shared tooltip ---- */
  function buildTooltip(u, leftPx, idx, panelRect) {
    if (idx == null || leftPx < 0) { tooltipEl.classList.remove('show'); return; }
    const t = aligned.x[idx];
    if (t == null) { tooltipEl.classList.remove('show'); return; }
    const activeRegs = METRICS.filter(m => state.active.has(m.key) && aligned.available.has(m.key));
    let rows = '';
    for (const reg of activeRegs) {
      const arr = plotArr(reg.key);
      const sparse = reg.type === 'dots';
      const v = sparse ? (arr[idx] != null ? arr[idx] : null) : valueAt(arr, idx, 4);
      const muted = v == null ? ' muted' : '';
      const dp = (reg.unit === 'lb' || reg.unit === '%') ? 1 : 0;
      const valStr = v == null ? '–' : (reg.key === 'balance' ? fmtSigned(v, dp) : fmtNum(v, dp));
      const nameTag = smoothedKey(reg.key) ? `${reg.label} <span style="color:var(--ink-3);font-weight:600;font-size:10px">${state.smooth.window}d avg</span>` : reg.label;
      rows += `<div class="tr${muted}"><span class="sw" style="background:${reg._cachedColor || resolveColor(reg.colorVar)}"></span>`
        + `<span class="nm">${nameTag}</span>`
        + `<span class="vv">${valStr}<span style="color:var(--ink-3);font-weight:500"> ${v == null ? '' : reg.unit}</span></span></div>`;
    }
    tooltipEl.innerHTML = `<div class="date">${fmtDateLong(t)}</div>${rows}`;
    tooltipEl.classList.add('show');

    // position relative to card
    const cardRect = cardEl.getBoundingClientRect();
    const x = panelRect.left - cardRect.left + leftPx;
    const tw = tooltipEl.offsetWidth, th = tooltipEl.offsetHeight;
    let px = x + 16;
    if (px + tw > cardRect.width - 6) px = x - tw - 16;
    px = Math.max(6, px);
    let py = panelRect.top - cardRect.top + 12;
    py = Math.min(py, cardRect.height - th - 6);
    tooltipEl.style.left = px + 'px';
    tooltipEl.style.top = Math.max(6, py) + 'px';
  }

  function cursorPlugin(getPanelEl) {
    return {
      hooks: {
        setCursor: (u) => {
          if (suppress) return;
          const idx = u.cursor.idx;
          const left = u.cursor.left;
          if (left == null || left < 0 || idx == null) { tooltipEl.classList.remove('show'); return; }
          buildTooltip(u, left, idx, getPanelEl().getBoundingClientRect());
        },
      },
    };
  }

  function commonOpts(view) {
    return {
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'Etc/UTC'),
      cursor: {
        sync: { key: SYNC.key, setSeries: false },
        drag: { x: false, y: false, setScale: false },
        points: { size: 7, width: 2, stroke: (u, si) => u.series[si]._color || '#888', fill: '#fff' },
        focus: { prox: 24 },
      },
      legend: { show: false },
      scales: { x: { time: true, min: view[0], max: view[1] } },
    };
  }

  function xAxis(show) {
    return axisCfg({
      scale: 'x',
      show,
      size: show ? 30 : 0,
      space: 78,
      values: (u, splits) => {
        const span = u.scales.x.max - u.scales.x.min;
        let lastYear = null;
        return splits.map(s => {
          const d = new Date(s * 1000);
          const y = d.getUTCFullYear();
          const showYear = y !== lastYear;
          lastYear = y;
          if (span > 80 * 86400) {
            const m = MONTHS[d.getUTCMonth()];
            return showYear ? m + ' ' + y : m;
          }
          return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
        });
      },
    });
  }

  // y-axis value formatter per unit
  function yVals(unit) {
    return (u, splits) => splits.map(v => {
      if (v == null) return '';
      if (unit === 'kcal') return Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k' : '' + v;
      if (unit === 'lb' || unit === '%') return '' + (Math.round(v * 10) / 10);
      return '' + v;
    });
  }

  function goalLinePlugin(scaleKey) {
    return {
      hooks: {
        draw: (u) => {
          if (!state.goal || !state.goal.on || state.goal.value == null) return;
          if (!u.scales[scaleKey]) return;
          const gv = state.goal.value;
          const y = u.valToPos(gv, scaleKey, true);
          if (!isFinite(y)) return;
          const ctx = u.ctx;
          ctx.save();
          ctx.beginPath();
          ctx.strokeStyle = resolveColor('--c-goal');
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.5;
          ctx.moveTo(u.bbox.left, y);
          ctx.lineTo(u.bbox.left + u.bbox.width, y);
          ctx.stroke();
          ctx.setLineDash([]);
          // label chip
          const txt = 'Goal ' + gv;
          ctx.font = '600 10px "JetBrains Mono", monospace';
          const tw = ctx.measureText(txt).width;
          const bx = u.bbox.left + u.bbox.width - tw - 12;
          ctx.fillStyle = resolveColor('--c-goal');
          ctx.globalAlpha = 0.14;
          roundRect(ctx, bx - 5, y - 14, tw + 10, 14, 4); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = resolveColor('--ink-2');
          ctx.textBaseline = 'middle';
          ctx.fillText(txt, bx, y - 7);
          ctx.restore();
        },
      },
    };
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function balanceZeroLine() {
    return {
      hooks: {
        draw: (u) => {
          const s = u.scales.balance || u.scales.y;
          if (!s) return;
          const y = u.valToPos(0, u.scales.balance ? 'balance' : 'y', true);
          const ctx = u.ctx;
          ctx.save();
          ctx.beginPath();
          ctx.strokeStyle = withAlpha(resolveColor('--ink-3'), 0.5);
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          ctx.moveTo(u.bbox.left, y);
          ctx.lineTo(u.bbox.left + u.bbox.width, y);
          ctx.stroke();
          ctx.restore();
        },
      },
    };
  }

  /* ---- build STACKED ---- */
  function buildStacked(view) {
    const visGroups = GROUPS.filter(g =>
      METRICS.some(m => m.group === g.id && state.active.has(m.key) && aligned.available.has(m.key))
    );
    visGroups.forEach((g, gi) => {
      const regs = METRICS.filter(m => m.group === g.id && state.active.has(m.key) && aligned.available.has(m.key));
      const isLast = gi === visGroups.length - 1;

      const row = document.createElement('div');
      row.className = 'panel-row';
      const label = document.createElement('div');
      label.className = 'plabel';
      label.innerHTML = `${g.label} <span class="u">${g.unit}</span>`;
      row.appendChild(label);
      const plot = document.createElement('div');
      row.appendChild(plot);
      host.appendChild(row);

      const series = [{}];
      regs.forEach(r => series.push(makeSeries(r, 'y')));

      const data = [aligned.x];
      regs.forEach(r => data.push(plotArr(r.key)));

      const scaleY = { auto: true };
      if (g.id === 'balance') {
        scaleY.range = (u, dmin, dmax) => {
          const m = Math.max(Math.abs(dmin), Math.abs(dmax), 100) * 1.15;
          return [-m, m];
        };
      } else {
        scaleY.range = (u, dmin, dmax) => {
          const pad = (dmax - dmin) * 0.12 || 1;
          return [dmin - pad, dmax + pad];
        };
      }

      const plugins = [cursorPlugin(() => plot)];
      if (g.id === 'balance') plugins.push(balanceZeroLine());
      if (g.id === 'body') plugins.push(goalLinePlugin('y'));
      if (window.Markers) plugins.push(window.Markers.plugin());

      const opts = Object.assign(commonOpts(view), {
        width: host.clientWidth,
        height: g.h,
        padding: [12, 8, 0, 0],
        scales: Object.assign(commonOpts(view).scales, { y: scaleY }),
        axes: [
          xAxis(isLast),
          axisCfg({ scale: 'y', size: 52, values: yVals(g.unit), space: 40 }),
        ],
        series,
        plugins,
      });

      const u = new uPlot(opts, data, plot);
      SYNC.sub(u);
      attachInteractions(u);
      instances.push({ u, groupId: g.id });
    });

    if (!visGroups.length) emptyState();
  }

  /* ---- build OVERLAID ---- */
  function buildOverlaid(view) {
    const regs = METRICS.filter(m => state.active.has(m.key) && aligned.available.has(m.key));
    if (!regs.length) { emptyState(); return; }

    const row = document.createElement('div');
    row.className = 'panel-row';
    const plot = document.createElement('div');
    row.appendChild(plot);
    host.appendChild(row);

    // unit -> scale key
    const unitScale = { lb: 'lb', kcal: 'kcal', g: 'g', '%': 'pct' };
    const series = [{}];
    const data = [aligned.x];
    const scales = Object.assign(commonOpts(view).scales, {});
    const usedUnits = [];
    regs.forEach(r => {
      let sk = r.key === 'balance' ? 'bal' : unitScale[r.unit];
      series.push(makeSeries(r, sk));
      data.push(plotArr(r.key));
      if (!usedUnits.includes(r.unit) && r.key !== 'balance') usedUnits.push(r.unit);
      if (!scales[sk]) {
        scales[sk] = { auto: true };
        if (sk === 'bal') {
          scales[sk].range = (u, dmin, dmax) => { const m = Math.max(Math.abs(dmin), Math.abs(dmax), 100) * 1.15; return [-m, m]; };
        } else {
          scales[sk].range = (u, dmin, dmax) => { const pad = (dmax - dmin) * 0.12 || 1; return [dmin - pad, dmax + pad]; };
        }
      }
    });

    // axes: x + up to two unit axes (left, right)
    const axes = [xAxis(true)];
    const leftUnit = usedUnits[0];
    const rightUnit = usedUnits[1];
    if (leftUnit) axes.push(axisCfg({ scale: unitScale[leftUnit], side: 3, size: 52, values: yVals(leftUnit), space: 40 }));
    if (rightUnit) axes.push(axisCfg({ scale: unitScale[rightUnit], side: 1, size: 52, values: yVals(rightUnit), space: 40, grid: { show: false } }));

    const opts = Object.assign(commonOpts(view), {
      width: host.clientWidth,
      height: estOverlaidHeight(),
      padding: [14, 8, 0, 0],
      scales,
      axes,
      series,
      plugins: [cursorPlugin(() => plot)],
    });
    if (scales.lb) opts.plugins.push(goalLinePlugin('lb'));
    if (window.Markers) opts.plugins.push(window.Markers.plugin());
    const u = new uPlot(opts, data, plot);
    SYNC.sub(u);
    attachInteractions(u);
    instances.push({ u, groupId: 'overlaid' });
  }

  function emptyState() {
    const d = document.createElement('div');
    d.style.cssText = 'padding:60px 20px;text-align:center;color:var(--ink-3);font-weight:650;font-size:14px;';
    d.textContent = 'No metrics selected. Turn some on from the left to plot them.';
    host.appendChild(d);
  }

  function build(st, ali, opts) {
    state = st; aligned = ali;
    host = opts.host; onView = opts.onView; tooltipEl = opts.tooltip; cardEl = opts.card;
    destroy();
    // cache colors on regs
    METRICS.forEach(m => { m._cachedColor = resolveColor(m.colorVar); });
    if (state.mode === 'overlaid') buildOverlaid(state.view);
    else buildStacked(state.view);
    if (window.Markers) window.Markers.onBuilt(instances.map(o => o.u));
    requestAnimationFrame(() => { try { fit(); } catch (e) {} });
  }

  function applyXScale(view) {
    suppress = true;
    instances.forEach(o => { try { o.u.setScale('x', { min: view[0], max: view[1] }); } catch (e) {} });
    suppress = false;
  }

  function resize() {
    if (!host) return;
    instances.forEach(o => { o.u.setSize({ width: host.clientWidth, height: o.u.height }); });
  }

  return { build, applyXScale, destroy, resize, fit, hideTooltip: () => tooltipEl && tooltipEl.classList.remove('show') };
})();
