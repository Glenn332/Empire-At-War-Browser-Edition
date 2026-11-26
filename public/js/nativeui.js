// The game screens are icons, images and canvases: the browser's own right-click menu ("Save image as") and image
// dragging only get in the way of right-click orders, so both stay limited to text fields, links and selected text.
const NATIVE = 'input, textarea, select, a[href], [contenteditable=""], [contenteditable=true]';

const elementOf = t => (t && t.nodeType === 3 ? t.parentElement : t);

export function nativeAllowed(target, selection = null) {
  const el = elementOf(target);
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest(NATIVE)) return true;
  return !!selection && !selection.isCollapsed && String(selection).length > 0 && !!selection.containsNode?.(el, true);
}

export function guardNativeUI(win = globalThis) {
  if (!win?.addEventListener || win.__nativeUIGuard) return;
  win.__nativeUIGuard = true;
  const block = e => {
    if (!nativeAllowed(e.target, e.type === 'contextmenu' ? win.getSelection?.() : null)) e.preventDefault();
  };
  // capture phase, so panels that stop propagation of their own right clicks are covered too; their handlers still run
  win.addEventListener('contextmenu', block, true);
  win.addEventListener('dragstart', block, true);
}
