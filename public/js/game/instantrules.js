import { db } from '../gamedata.js';

const teamAlive = (w, team) => {
  for (const u of w.units) if (!u.dead && u.player.team === team && u.player.id >= 0 && !u.isPad) return true;
  for (const s of w.squads) if (!s.dead && s.player.team === team && s.player.id >= 0) return true;
  return false;
};

const teamName = team => {
  const f = db.faction(team.factionName);
  return `${db.t(f?.str('Text_ID')) || team.factionName} (Team ${team.id + 1})`;
};

export class InstantRules {
  constructor(world, human, message, net = false) {
    this.world = world;
    this.human = human;
    this.message = message;
    this.net = net;
    this.ended = false;
    this.wait = 0;
  }

  end(winner) {
    if (this.ended) return;
    this.ended = true;
    this.world.onEvent('gameover', { winner });
  }

  step(dt) {
    const w = this.world,
      me = this.human();
    if ((this.wait -= dt) > 0 || w.winner) return;
    this.wait = 1;
    const sides = w.teams.filter(t => !t.mapSide && t.players.some(p => p.id >= 0));
    for (const t of sides) {
      if (t.defeated || teamAlive(w, t)) continue;
      t.defeated = true;
      if (t === me?.team) this.message('Your fleet has been destroyed', 'bad');
      else this.message(`${teamName(t)} has been eliminated`, 'good');
    }
    const alive = sides.filter(t => !t.defeated);
    if (alive.length <= 1) {
      w.winner = alive[0] || null;
      this.end(w.winner);
      return;
    }
    if (me?.team.defeated && !this.ended) {
      const best = alive
        .map(t => ({ t, n: w.units.filter(u => !u.dead && u.player.team === t).length }))
        .sort((a, b) => b.n - a.n)[0].t;
      if (!this.net) this.end(best);
      else if (!this.out) {
        this.out = true;
        w.onEvent('teamDefeated', { team: me.team, winner: best });
      }
    }
  }
}
