export function isPlainObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return !proto || !Object.getPrototypeOf(proto);
}

// A copy made in this window of plain data from another window (a battle or galaxy frame): holding any object made in
// a window keeps that whole window, and every game data table it loaded, alive after it closes.
export function ownCopy(value) {
  if (!value || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    // something in it cannot be copied (a function or a page element): keep it as it is
    return value;
  }
}
