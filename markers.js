/* ============================================================
   markers.js — phase markers & auto-segmented timeline
   A marker is a dated label that STARTS a phase; the phase runs
   until the next marker (or the end of data). Phases can be tinted,
   hovered for a summary, and clicked to zoom the view.
   ============================================================ */

const Markers = (function () {
  // curated, harmonized phase palette (matches the data-color L/C)
  // muted phase palette, ORDERED so adjacent phases contrast strongly
  // (coral \u2192 teal \u2192 amber \u2192 violet \u2192 green \u2192 magenta). Lower chroma than the
  // data lines so they read as background zones.
  const PALETTE = [
    'oklch(0.63 0.13 25)',  // coral
    'oklch(0.64 0.11 195)', // teal
    'oklch(0.72 0.12 80)',  // amber
    'oklch(0.58 0.13 300)', // violet
    'oklch(0.66 0.12 150)', // green
    'oklch(0.60 0.13 335)', // magenta
  ];

  let cfg = { markers: [], tint: true, range: [0, 1] };
  let instances = [];
  let topU = null;
  let cardEl = null, bandEl = null, trackEl = null, tipEl = null, aligned = null;
  let onZoom = null;
  let hoverId = null;
  let layoutQueued = false;

  /* ---- color helpers ---- */
  const _cache = {};
  function resolveAny(color) {
    if (_cache[color]) return _cache[color];
    const el = document.createElement('span');
    el.style.color = color; el.style.display = 'none';
    document.body.appendChild(el);
    const c = getComputedStyle(el).color || 'rgb(120,130,150)';
    el.remove();
    _cache[color] = c;
    return c;
  }
  function withAlpha(color, a) {
    const s = ('' + color).trim();
    // modern browsers return color() / oklch() etc. as-is from getComputedStyle;
    // inject alpha via the `/ a` syntax rather than mangling the numeric channels.
    const fnMatch = s.match(/^(oklch|oklab|lch|lab|color|hsl|hwb)\(/i);
    if (fnMatch) {
      const open = s.indexOf('(');
      const inner = s.slice(open + 1, s.lastIndexOf(')')).split('/')[0].trim();
      return `${s.slice(0, open)}(${inner} / ${a})`;
    }
    const m = s.match(/-?[\d.]+/g);
    if (!m) return s;
    return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${a})`;
  }
  function clearCache() { for (const k in _cache) delete _cache[k]; }

  function sorted() { return [...cfg.markers].sort((a, b) => a.t - b.t); }
  function colorOf(mk, idx) {
    return (mk.color && mk.color !== 'auto') ? mk.color : PALETTE[idx % PALETTE.length];
  }
  function autoColorFor(count) { return PALETTE[count % PALETTE.length]; }

  // phases: one per marker, [t0,t1) with the marker's color
  function phases() {
    const ms = sorted();
    const hi = cfg.range[1];
    const out = [];
    for (let i = 0; i < ms.length; i++) {
      const t0 = ms[i].t;
      const t1 = i < ms.length - 1 ? ms[i + 1].t : hi;
      if (t1 <= t0) continue;
      out.push({ id: ms[i].id, t0, t1, label: ms[i].label || 'Phase', color: colorOf(ms[i], i), tint: ms[i].tint !== false });
    }
    return out;
  }
  function isZoomedTo(p) {
    return !!topU && Math.abs(topU.scales.x.min - p.t0) < 86400 && Math.abs(topU.scales.x.max - p.t1) < 86400;
  }

  /* ---- canvas drawing (per instance, via plugin) ---- */
  function fillTints(u) {
    if (!cfg.tint || !cfg.markers.length) return;
    const ctx = u.ctx;
    const { min, max } = u.scales.x;
    const L = u.bbox.left, T = u.bbox.top, W = u.bbox.width, H = u.bbox.height;
    ctx.save();
    for (const p of phases()) {
      if (!p.tint) continue;
      if (p.t1 < min || p.t0 > max) continue;
      let x0 = u.valToPos(Math.max(p.t0, min), 'x', true);
      let x1 = u.valToPos(Math.min(p.t1, max), 'x', true);
      x0 = Math.max(L, x0); x1 = Math.min(L + W, x1);
      if (x1 <= x0) continue;
      const hot = p.id === hoverId;
      ctx.fillStyle = withAlpha(resolveAny(p.color), hot ? 0.24 : 0.14);
      ctx.fillRect(x0, T, x1 - x0, H);
    }
    ctx.restore();
  }

  function drawLines(u) {
    if (!cfg.markers.length) return;
    const ctx = u.ctx;
    const { min, max } = u.scales.x;
    const T = u.bbox.top, H = u.bbox.height;
    ctx.save();
    for (const p of phases()) {
      if (p.t0 < min || p.t0 > max) continue;
      const x = u.valToPos(p.t0, 'x', true);
      const rgb = resolveAny(p.color);
      const hot = p.id === hoverId;
      ctx.beginPath();
      ctx.strokeStyle = withAlpha(rgb, hot ? 1 : 0.85);
      ctx.lineWidth = hot ? 2 : 1.5;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(x, T);
      ctx.lineTo(x, T + H);
      ctx.stroke();
      ctx.setLineDash([]);
      // small solid cap at the top of the boundary
      ctx.fillStyle = rgb;
      ctx.fillRect(x - 1, T, 2, 6);
    }
    ctx.restore();
  }

  function plugin() {
    return {
      hooks: {
        drawClear: (u) => { try { fillTints(u); } catch (e) {} },
        draw: (u) => {
          try { drawLines(u); } catch (e) {}
          if (u === topU) scheduleLayout();
        },
      },
    };
  }

  /* ---- DOM phase band (labels above the chart) ---- */
  function scheduleLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => { layoutQueued = false; layoutBand(); });
  }

  function escapeHtml(s) {
    return ('' + s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function layoutBand() {
    if (!bandEl || !trackEl) return;
    const ph = phases();
    if (!topU || !ph.length) { bandEl.hidden = true; return; }
    bandEl.hidden = false;

    const overRect = topU.over.getBoundingClientRect();
    const bandRect = bandEl.getBoundingClientRect();
    const left = overRect.left - bandRect.left;
    const W = overRect.width;
    trackEl.style.left = left + 'px';
    trackEl.style.width = W + 'px';

    const { min, max } = topU.scales.x;
    const xpos = (t) => ((t - min) / (max - min)) * W;

    trackEl.innerHTML = '';
    for (const p of ph) {
      let x0 = xpos(p.t0), x1 = xpos(p.t1);
      if (x1 <= 2 || x0 >= W - 2) continue;
      x0 = Math.max(0, x0); x1 = Math.min(W, x1);
      const w = x1 - x0;
      const chip = document.createElement('div');
      chip.className = 'phase-chip' + (p.id === hoverId ? ' hot' : '') + (isZoomedTo(p) ? ' active' : '');
      chip.dataset.pid = p.id;
      chip.style.left = x0 + 'px';
      chip.style.width = w + 'px';
      chip.style.setProperty('--pc', p.color);
      chip.innerHTML = w > 34 ? `<span class="lab">${escapeHtml(p.label)}</span>` : '';
      chip.addEventListener('mouseenter', () => { setHover(p.id); showTip(p, chip); });
      chip.addEventListener('mouseleave', () => { setHover(null); hideTip(); });
      chip.addEventListener('click', (e) => { e.stopPropagation(); if (onZoom) onZoom(p); });
      trackEl.appendChild(chip);
    }
  }

  function setHover(id) {
    if (hoverId === id) return;
    hoverId = id;
    instances.forEach(u => { try { u.redraw(false); } catch (e) {} });
    if (trackEl) trackEl.querySelectorAll('.phase-chip').forEach(c => c.classList.toggle('hot', c.dataset.pid === id));
  }

  /* ---- phase summary tooltip ---- */
  function row(label, val, unit, cls) {
    return `<div class="pt-row"><span class="k">${label}</span>`
      + `<span class="v ${cls || ''}">${val}<span class="u">${val === '–' ? '' : ' ' + unit}</span></span></div>`;
  }
  function showTip(p, chip) {
    if (!tipEl || !aligned) return;
    const s = computeStats(aligned, p.t0, p.t1);
    const days = Math.max(1, Math.round((p.t1 - p.t0) / 86400));
    const wks = days / 7;
    const wc = s.weightChange, rate = s.weeklyRate;
    const dirC = (v) => v == null ? 'flat' : (v < 0 ? 'down' : (v > 0 ? 'up' : 'flat'));
    tipEl.innerHTML =
      `<div class="pt-head"><span class="dot" style="background:${p.color}"></span>`
      + `<span class="pt-title">${escapeHtml(p.label)}</span></div>`
      + `<div class="pt-range">${fmtDate(p.t0, true)} – ${fmtDate(p.t1, true)}`
      + `<span class="pt-dur">${wks >= 2 ? Math.round(wks) + ' wk · ' : ''}${days} d</span></div>`
      + `<div class="pt-rows">`
      + row('Weight change', wc == null ? '–' : fmtSigned(wc, 1), 'lb', dirC(wc))
      + row('Rate', rate == null ? '–' : fmtSigned(rate, 2), 'lb/wk', dirC(rate))
      + row('Avg intake', s.avgCalories == null ? '–' : fmtNum(s.avgCalories), 'kcal', 'flat')
      + row('Avg balance', s.avgBalance == null ? '–' : fmtSigned(s.avgBalance), 'kcal', dirC(s.avgBalance))
      + `</div>`
      + `<div class="pt-foot">${isZoomedTo(p) ? 'Click to zoom back out' : 'Click to zoom to this phase'}</div>`;
    tipEl.classList.add('show');
    const chipRect = chip.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();
    const tw = tipEl.offsetWidth;
    let px = chipRect.left - cardRect.left + chipRect.width / 2 - tw / 2;
    px = Math.max(6, Math.min(px, cardRect.width - tw - 6));
    const py = chipRect.bottom - cardRect.top + 8;
    tipEl.style.left = px + 'px';
    tipEl.style.top = py + 'px';
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('show'); }

  /* ---- public API ---- */
  function configure(opts) {
    cardEl = opts.card; bandEl = opts.band; tipEl = opts.tip; aligned = opts.aligned;
    onZoom = opts.onZoom;
    cfg.range = opts.range || cfg.range;
    if (bandEl && !trackEl) {
      trackEl = document.createElement('div');
      trackEl.className = 'pb-track';
      bandEl.appendChild(trackEl);
    }
  }
  function setMarkers(markers, tint) {
    cfg.markers = markers || [];
    if (typeof tint === 'boolean') cfg.tint = tint;
  }
  function setRange(range) { cfg.range = range; }
  function onBuilt(insts) {
    instances = insts || [];
    topU = instances[0] || null;
    scheduleLayout();
  }
  function redraw() {
    instances.forEach(u => { try { u.redraw(false); } catch (e) {} });
    layoutBand();
  }
  function refreshColors() { clearCache(); redraw(); }

  return {
    PALETTE, configure, setMarkers, setRange, onBuilt, plugin, redraw, refreshColors,
    layout: layoutBand, autoColorFor, colorOf, phases,
  };
})();
window.Markers = Markers;
