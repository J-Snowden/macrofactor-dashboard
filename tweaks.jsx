/* ============================================================
   tweaks.jsx — visual variations panel (React island bridged to the vanilla app)
   ============================================================ */
const { useEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "scheme": "Cool",
  "font": "Manrope",
  "lineWeight": 1,
  "radius": 16
}/*EDITMODE-END*/;

// ---- color schemes (series + brand) ----
const SCHEMES = {
  Cool: {
    '--c-weight': 'oklch(0.74 0.055 245)', '--c-trend': 'oklch(0.56 0.13 245)',
    '--c-expenditure': 'oklch(0.55 0.15 292)', '--c-calories': 'oklch(0.70 0.14 55)',
    '--c-balance': 'oklch(0.64 0.13 158)', '--c-balance-neg': 'oklch(0.63 0.16 25)',
    '--c-protein': 'oklch(0.60 0.16 12)', '--c-carbs': 'oklch(0.70 0.14 62)',
    '--c-fat': 'oklch(0.76 0.12 92)', '--c-bodyfat': 'oklch(0.62 0.10 200)',
    '--brand': 'oklch(0.58 0.13 245)', '--brand-ink': 'oklch(0.46 0.13 245)',
  },
  Sunset: {
    '--c-weight': 'oklch(0.78 0.06 50)', '--c-trend': 'oklch(0.58 0.15 32)',
    '--c-expenditure': 'oklch(0.55 0.16 18)', '--c-calories': 'oklch(0.74 0.14 72)',
    '--c-balance': 'oklch(0.64 0.13 150)', '--c-balance-neg': 'oklch(0.60 0.17 18)',
    '--c-protein': 'oklch(0.58 0.17 10)', '--c-carbs': 'oklch(0.72 0.14 60)',
    '--c-fat': 'oklch(0.78 0.12 88)', '--c-bodyfat': 'oklch(0.62 0.12 30)',
    '--brand': 'oklch(0.62 0.15 38)', '--brand-ink': 'oklch(0.50 0.15 32)',
  },
  Mono: {
    '--c-weight': 'oklch(0.76 0.012 250)', '--c-trend': 'oklch(0.42 0.02 255)',
    '--c-expenditure': 'oklch(0.58 0.02 255)', '--c-calories': 'oklch(0.60 0.14 245)',
    '--c-balance': 'oklch(0.58 0.02 255)', '--c-balance-neg': 'oklch(0.60 0.14 25)',
    '--c-protein': 'oklch(0.52 0.02 255)', '--c-carbs': 'oklch(0.66 0.015 255)',
    '--c-fat': 'oklch(0.78 0.012 255)', '--c-bodyfat': 'oklch(0.60 0.14 245)',
    '--brand': 'oklch(0.55 0.13 245)', '--brand-ink': 'oklch(0.44 0.13 245)',
  },
};

// NOTE: light/dark surface theming lives in theme.js (window.MFTheme) so the
// topbar toggle and this panel share one source of truth. This file only owns
// data colors, type, and shape.

const FONTS = {
  Manrope: '"Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  'Plus Jakarta': '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif',
  System: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

function applyTweaks(t) {
  const root = document.documentElement.style;
  const sch = SCHEMES[t.scheme] || SCHEMES.Cool;
  for (const k in sch) root.setProperty(k, sch[k]);
  root.setProperty('--font', FONTS[t.font] || FONTS.Manrope);
  root.setProperty('--radius', t.radius + 'px');
  root.setProperty('--radius-sm', Math.max(6, t.radius - 6) + 'px');
  window.TWK.lineScale = t.lineWeight;
  // reflow charts (canvas colors are read from CSS vars)
  if (window.clearColorCache) window.clearColorCache();
  if (window.refreshVisuals) window.refreshVisuals();
}

function TweaksApp() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [mode, setMode] = React.useState(() => (window.MFTheme ? window.MFTheme.get() : 'Light'));
  useEffect(() => { applyTweaks(t); }, [t.scheme, t.font, t.lineWeight, t.radius]);
  useEffect(() => {
    const h = (e) => setMode(e.detail);
    window.addEventListener('mf-theme', h);
    return () => window.removeEventListener('mf-theme', h);
  }, []);
  return (
    React.createElement(TweaksPanel, { title: 'Tweaks' },
      React.createElement(TweakSection, { label: 'Theme' }),
      React.createElement(TweakRadio, { label: 'Mode', value: mode, options: ['Light', 'Dark'], onChange: (v) => { if (window.MFTheme) window.MFTheme.set(v); } }),
      React.createElement(TweakRadio, { label: 'Data colors', value: t.scheme, options: ['Cool', 'Sunset', 'Mono'], onChange: (v) => setTweak('scheme', v) }),
      React.createElement(TweakSection, { label: 'Type & shape' }),
      React.createElement(TweakSelect, { label: 'Font', value: t.font, options: ['Manrope', 'Plus Jakarta', 'System'], onChange: (v) => setTweak('font', v) }),
      React.createElement(TweakSlider, { label: 'Corner radius', value: t.radius, min: 6, max: 22, step: 1, unit: 'px', onChange: (v) => setTweak('radius', v) }),
      React.createElement(TweakSection, { label: 'Chart' }),
      React.createElement(TweakSlider, { label: 'Line weight', value: t.lineWeight, min: 0.7, max: 2, step: 0.1, unit: '×', onChange: (v) => setTweak('lineWeight', v) }),
    )
  );
}

(function mount() {
  const el = document.getElementById('tweaks-root');
  if (!el) return;
  // TWEAK_DEFAULTS is the persisted source of truth (host rewrites the block on save)
  applyTweaks(TWEAK_DEFAULTS);
  ReactDOM.createRoot(el).render(React.createElement(TweaksApp));
})();
