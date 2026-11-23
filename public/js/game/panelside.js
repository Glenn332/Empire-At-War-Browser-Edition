const key = s => String(s || '').toUpperCase();

export function panelSide(game, owner, player = null) {
  const human = game.isHuman ? game.isHuman(owner) : player?.ai === null || key(owner) === key(game.me);
  if (!human) return 'ai';
  return key(owner) === key(game.localFaction ?? game.me) ? 'local' : 'remote';
}

export function offerPanel(game, kind, actor, planet, offer = {}) {
  (game.panelOffers ||= new Map()).set(actor.record || actor, { kind, planet, owner: actor.owner, ...offer });
}
export function panelOffer(game, record, kind, planet) {
  const o = game.panelOffers?.get(record);
  return o && o.kind === kind && o.planet === planet ? o : null;
}
export function closeOffer(game, record) {
  game.panelOffers?.delete(record);
}
