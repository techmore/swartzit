export const AUTOPLAY_KEY = 'swartzit_autoplay';

export function autoplayEnabled(storage) {
  try { return storage.getItem(AUTOPLAY_KEY) !== 'off'; } catch { return true; }
}

export function observeAutoplay(node, win = window, doc = document) {
  const readPreference = () => { try { return autoplayEnabled(win.localStorage); } catch { return true; } };
  let enabled = readPreference();
  let visible = false;
  let destroyed = false;
  let manuallyPaused = false;
  let internalPause = false;
  const pause = () => { if (!node.paused) { internalPause = true; node.pause(); } };
  const onPause = () => { if (internalPause) internalPause = false; else if (visible) manuallyPaused = true; };
  const sync = () => {
    if (destroyed) return;
    if (enabled && visible && !doc.hidden && !manuallyPaused) {
      if (node.paused) {
        node.muted = true;
        try { const result = node.play(); if (result?.catch) result.catch(() => {}); } catch { /* Browser may reject autoplay. */ }
      }
    } else if (!visible || doc.hidden) pause();
  };
  const setVisible = value => {
    if (!value) manuallyPaused = false;
    visible = value;
    win.dispatchEvent(new CustomEvent('swartzit-media-visibility', { detail: { element: node, visible } }));
    sync();
  };
  const measure = () => {
    const rect = node.getBoundingClientRect();
    const shown = Math.max(0, Math.min(rect.bottom, win.innerHeight) - Math.max(rect.top, 0));
    setVisible(rect.height > 0 && shown >= Math.min(rect.height, win.innerHeight) * 0.45);
  };
  const preference = event => { enabled = event.detail?.enabled === true; if (!enabled) pause(); else { manuallyPaused = false; sync(); } };
  const storage = event => { if (event.key === AUTOPLAY_KEY || event.key === null) { enabled = readPreference(); if (!enabled) pause(); else { manuallyPaused = false; sync(); } } };
  const visibility = () => sync();
  let observer;
  if (win.IntersectionObserver) {
    observer = new win.IntersectionObserver(() => measure(), { threshold: Array.from({length: 21}, (_, i) => i / 20) });
    observer.observe(node);
  } else {
    win.addEventListener('scroll', measure, { passive: true });
    win.addEventListener('resize', measure);
    measure();
  }
  win.addEventListener('swartzit-autoplay-change', preference);
  win.addEventListener('storage', storage);
  node.addEventListener('pause', onPause);
  doc.addEventListener('visibilitychange', visibility);
  return { destroy() { destroyed = true; observer?.disconnect(); win.removeEventListener('scroll', measure); win.removeEventListener('resize', measure); win.removeEventListener('swartzit-autoplay-change', preference); win.removeEventListener('storage', storage); node.removeEventListener('pause', onPause); doc.removeEventListener('visibilitychange', visibility); } };
}
