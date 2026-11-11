export function losingSideBonus(groups, rateOf, k, give, out) {
  if (groups.length !== 3) return;
  const [A, B, C] = groups,
    a = A.earn,
    b = B.earn,
    c = C.earn;
  if (a === 0 && b === 0 && c === 0) return;
  let low, mid, max;
  if (a <= b) {
    if (a <= c) {
      low = A;
      if (b < c) (mid = B), (max = c);
      else (mid = C), (max = b);
    } else (low = C), (mid = A), (max = b);
  } else if (c < b) (low = C), (mid = B), (max = a);
  else if (c <= a) (low = B), (mid = C), (max = a);
  else (low = B), (mid = A), (max = c);
  const pay = (g, bonus) => {
    const n = g.players.length;
    if (n < 2) {
      if (!out(g.players[0])) give(g.players[0], bonus);
      return;
    }
    for (const p of g.players) if (!out(p)) give(p, (g.earn > 0 ? 1 - rateOf(p) / g.earn : 1 / n) * bonus);
  };
  if (mid.paid) pay(mid, (max - mid.earn) * k);
  if (low.paid) pay(low, (max - low.earn) * k);
}
