/* ============================================================
   theme.js — light/dark surface theming
   Single source of truth for the page theme. Drives both the
   topbar toggle and the Tweaks "Mode" control. Loaded in <head>
   (blocking) so vars apply before first paint → no flash.
   ============================================================ */
(function () {
  const THEMES = {
    Light: {
      '--bg': '#F4F6F8', '--bg-2': '#EDF0F3', '--card': '#FFFFFF',
      '--ink': '#161A20', '--ink-2': '#5A6472', '--ink-3': '#8B95A3',
      '--line': '#E5E9EE', '--line-2': '#EEF1F4', '--brand-wash': 'oklch(0.96 0.02 245)',
      '--tooltip-bg': 'rgba(255,255,255,.97)',
      '--shadow': '0 1px 2px rgba(20,24,29,.04), 0 10px 30px -20px rgba(20,24,29,.22)',
      '--shadow-lg': '0 1px 2px rgba(20,24,29,.05), 0 24px 48px -24px rgba(20,24,29,.30)',
    },
    Dark: {
      '--bg': '#0D1014', '--bg-2': '#191F27', '--card': '#141A21',
      '--ink': '#E8ECF2', '--ink-2': '#9AA5B3', '--ink-3': '#69737F',
      '--line': '#242C36', '--line-2': '#1B222B', '--brand-wash': 'oklch(0.32 0.06 245)',
      '--tooltip-bg': 'rgba(24,30,38,.96)',
      '--shadow': '0 1px 2px rgba(0,0,0,.4), 0 14px 34px -20px rgba(0,0,0,.8)',
      '--shadow-lg': '0 2px 6px rgba(0,0,0,.5), 0 30px 60px -28px rgba(0,0,0,.9)',
    },
  };

  const KEY = 'mf-theme';
  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  function preferred() {
    const saved = localStorage.getItem(KEY);
    if (saved === 'Light' || saved === 'Dark') return saved;
    return mq.matches ? 'Dark' : 'Light';   // default to the user's OS setting
  }

  const SUN = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3.1" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  const MOON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.4 9.3A5.4 5.4 0 0 1 6.7 2.6a5.6 5.6 0 1 0 6.7 6.7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

  function updateBtn(mode) {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const dark = mode === 'Dark';
    // show the icon for the mode you'll switch TO
    btn.innerHTML = dark ? SUN : MOON;
    const lbl = dark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('title', lbl);
    btn.setAttribute('aria-label', lbl);
  }

  function apply(mode) {
    const t = THEMES[mode] || THEMES.Light;
    const root = document.documentElement.style;
    for (const k in t) root.setProperty(k, t[k]);
    root.colorScheme = mode === 'Dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', mode);
    // charts cache colors read from CSS vars — clear + reflow
    if (window.clearColorCache) window.clearColorCache();
    if (window.refreshVisuals) window.refreshVisuals();
    updateBtn(mode);
    window.dispatchEvent(new CustomEvent('mf-theme', { detail: mode }));
  }

  function set(mode) { localStorage.setItem(KEY, mode); apply(mode); }
  function toggle() { set(preferred() === 'Dark' ? 'Light' : 'Dark'); }
  function get() { return preferred(); }

  window.MFTheme = { apply, set, toggle, get };

  // apply immediately so the very first paint is already themed
  apply(preferred());

  // follow OS changes live, but only while the user hasn't picked explicitly
  if (mq.addEventListener) {
    mq.addEventListener('change', () => {
      if (!localStorage.getItem(KEY)) apply(mq.matches ? 'Dark' : 'Light');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', toggle);
    updateBtn(preferred());
  });
})();
