/* ============================================================
   brush.js — draggable overview / range selector under the charts
   ============================================================ */

const Brush = (function () {
  let root, canvas, ctx, maskL, maskR, win, hL, hR;
  let aligned = null, onChange = null;
  let dMin = 0, dMax = 1;
  let view = [0, 1];
  let W = 0, H = 56;

  function init(container, ali, cb) {
    aligned = ali; onChange = cb;
    [dMin, dMax] = aligned.range;
    container.innerHTML = '';
    root = document.createElement('div');
    root.className = 'overview';
    root.innerHTML =
      '<canvas class="ovcanvas"></canvas>' +
      '<div class="mask l"></div><div class="mask r"></div>' +
      '<div class="window"><div class="handle l"></div><div class="handle r"></div></div>';
    container.appendChild(root);
    canvas = root.querySelector('canvas');
    ctx = canvas.getContext('2d');
    maskL = root.querySelector('.mask.l');
    maskR = root.querySelector('.mask.r');
    win = root.querySelector('.window');
    hL = root.querySelector('.handle.l');
    hR = root.querySelector('.handle.r');
    bindDrag();
    resize();
  }

  function tToX(t) { return ((t - dMin) / (dMax - dMin)) * W; }
  function xToT(x) { return dMin + (x / W) * (dMax - dMin); }

  function resize() {
    if (!root) return;
    W = root.clientWidth; H = root.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
    layout();
  }

  function draw() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    const baseY = H - 16;
    const startY = new Date(aligned.range[0] * 1000).getUTCFullYear();
    const endY = new Date(aligned.range[1] * 1000).getUTCFullYear();
    // month ticks (minor) + year ticks (major) rising from the baseline
    for (let y = startY; y <= endY + 1; y++) {
      for (let mo = 0; mo < 12; mo++) {
        const t = Math.floor(Date.UTC(y, mo, 1) / 1000);
        if (t < aligned.range[0] || t > aligned.range[1]) continue;
        const x = tToX(t);
        const major = mo === 0;
        ctx.beginPath();
        ctx.moveTo(x, major ? 9 : baseY - 5);
        ctx.lineTo(x, baseY);
        ctx.strokeStyle = withAlpha(resolveColor('--ink-3'), major ? 0.34 : 0.16);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    // year labels
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.fillStyle = resolveColor('--ink-3');
    ctx.textBaseline = 'alphabetic';
    for (let y = startY; y <= endY; y++) {
      const t = Math.floor(Date.UTC(y, 0, 1) / 1000);
      const x = tToX(t);
      if (t < aligned.range[0] || x < 2 || x > W - 32) continue;
      ctx.fillText(String(y), x + 5, H - 4);
    }
  }

  function layout() {
    if (!W) return;
    const xl = Math.max(0, Math.min(W, tToX(view[0])));
    const xr = Math.max(0, Math.min(W, tToX(view[1])));
    maskL.style.left = '0px'; maskL.style.width = xl + 'px';
    maskR.style.right = '0px'; maskR.style.width = (W - xr) + 'px';
    win.style.left = xl + 'px'; win.style.width = Math.max(2, xr - xl) + 'px';
  }

  function setView(v, silent) {
    view = [Math.max(dMin, v[0]), Math.min(dMax, v[1])];
    layout();
    if (!silent && onChange) onChange(view.slice());
  }

  function bindDrag() {
    let mode = null, startX = 0, startView = null;
    const getX = (e) => {
      const r = root.getBoundingClientRect();
      return Math.max(0, Math.min(W, e.clientX - r.left));
    };
    const down = (m) => (e) => {
      e.preventDefault(); e.stopPropagation();
      mode = m; startX = getX(e); startView = view.slice();
      root.setPointerCapture && root.setPointerCapture(e.pointerId);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    const move = (e) => {
      if (!mode) return;
      const x = getX(e);
      const t = xToT(x);
      const minSpan = 5 * 86400;
      if (mode === 'move') {
        const dt = xToT(x) - xToT(startX);
        let a = startView[0] + dt, b = startView[1] + dt;
        if (a < dMin) { b += dMin - a; a = dMin; }
        if (b > dMax) { a -= b - dMax; b = dMax; }
        setView([a, b]);
      } else if (mode === 'l') {
        setView([Math.min(t, view[1] - minSpan), view[1]]);
      } else if (mode === 'r') {
        setView([view[0], Math.max(t, view[0] + minSpan)]);
      }
    };
    const up = () => {
      mode = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    win.addEventListener('pointerdown', down('move'));
    hL.addEventListener('pointerdown', down('l'));
    hR.addEventListener('pointerdown', down('r'));
    // click on empty track to recenter
    root.addEventListener('pointerdown', (e) => {
      if (e.target === win || e.target === hL || e.target === hR) return;
      const x = getX(e);
      const span = view[1] - view[0];
      let a = xToT(x) - span / 2, b = xToT(x) + span / 2;
      if (a < dMin) { b += dMin - a; a = dMin; }
      if (b > dMax) { a -= b - dMax; b = dMax; }
      setView([a, b]);
    });
  }

  function refresh(ali) { aligned = ali;[dMin, dMax] = aligned.range; resize(); }

  return { init, setView, resize, refresh };
})();
