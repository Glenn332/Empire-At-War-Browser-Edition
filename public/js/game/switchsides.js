const key = s =>
  String(s || '')
    .trim()
    .toUpperCase();

export function switchTarget(count, start, can, factionOf, target = '') {
  if (!(count > 0) || start < 0) return start;
  const step = i => {
    for (let k = 1; k <= count; k++) {
      const j = (i + k) % count;
      if (can(j)) return j;
    }
    return i;
  };
  const want = key(target),
    first = key(factionOf(start));
  let cur = start;
  do cur = step(cur);
  while (want && cur !== start && key(factionOf(cur)) !== first && key(factionOf(cur)) !== want);
  return cur;
}
