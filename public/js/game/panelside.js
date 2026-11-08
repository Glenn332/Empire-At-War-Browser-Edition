const key = s => String(s || '').toUpperCase();

export function panelSide(game, owner, player = null) {
  const human = game.isHuman ? game.isHuman(owner) : player?.ai === null || key(owner) === key(game.me);
  if (!human) return 'ai';
  return key(owner) === key(game.localFaction ?? game.me) ? 'local' : 'remote';
}
