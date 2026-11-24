const MAX_FRAME = 64 * 1024;
const MAX_PEERS = 108;
const MAX_LOBBIES = 500;
const LISTING_TTL = 90 * 1000;
const NAME_LEN = 32;
const AWAY_GRACE = 45 * 1000;
const STALE = 150 * 1000;

const lastHeard = (ctx, ws, a) => Math.max(ctx.getWebSocketAutoResponseTimestamp?.(ws)?.getTime() || 0, a.at || 0);
const fresh = (ctx, ws, a, now) => now - lastHeard(ctx, ws, a) <= STALE;
const drop = ws => {
  try {
    ws.close(4001, 'timed out');
  } catch {}
};

// one address can't take the whole service: listed games, hall seats and seats in one game
const LOBBIES_PER_IP = 4;
const HALL_PER_IP = 6;
const ROOM_PER_IP = 16;
const JOIN_BURST = 20,
  JOIN_RATE = 0.1;
const META_GAP = 3000;
// relayed messages a socket may send: a burst (a saved game in pieces) and a steady rate after it
const RELAY_BURST = { host: 8000, join: 2000 };
const RELAY_RATE = { host: 800, join: 200 };
const HALL_BURST = 20,
  HALL_RATE = 2;

const ipOf = req => req.headers.get('CF-Connecting-IP') || '';

// a token bucket per socket, kept in memory: it starts full again if the object is evicted, which is fine
const buckets = new WeakMap();
function spend(ws, burst, rate) {
  const now = Date.now();
  let b = buckets.get(ws);
  if (!b) buckets.set(ws, (b = { left: burst, at: now }));
  b.left = Math.min(burst, b.left + ((now - b.at) / 1000) * rate);
  b.at = now;
  if (b.left < 1) return false;
  b.left--;
  return true;
}

const allows = (entry, origin) => {
  if (entry === '*' || entry === origin) return true;
  const m = /^(https?:\/\/)\*\.([^/*]+)$/.exec(entry);
  return !!m && origin.startsWith(m[1]) && origin.endsWith('.' + m[2]) && origin.length > m[1].length + m[2].length + 1;
};

const cors = (req, env) => {
  const origin = req.headers.get('Origin') || '';
  // no list configured lets no other site in: '*' has to be set on purpose
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const ok = !origin || allowed.some(a => allows(a, origin)) || /^https?:\/\/(localhost|127\.0\.0\.1|swr\.localhost)(:\d+)?$/.test(origin);
  return { ok, headers: ok && origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {} };
};

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const c = cors(req, env);
    if (req.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: { ...c.headers, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' }
      });
    if (!c.ok) return json({ error: 'origin not allowed' }, 403);

    if (url.pathname === '/lobbies' && req.method === 'GET') {
      const reg = env.REGISTRY.get(env.REGISTRY.idFromName('main'));
      const list = await (await reg.fetch('https://registry/list')).json();
      return json(list, 200, c.headers);
    }
    if (url.pathname === '/hall') {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'websocket expected' }, 426, c.headers);
      return env.HALL.get(env.HALL.idFromName('main')).fetch(req);
    }
    const m = url.pathname.match(/^\/lobby\/([A-Za-z0-9_-]{6,32})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'websocket expected' }, 426, c.headers);
      const room = env.LOBBY.get(env.LOBBY.idFromName(m[1]));
      const fwd = new URL(req.url);
      fwd.searchParams.set('lobby', m[1]);
      return room.fetch(new Request(fwd, req));
    }
    if (url.pathname === '/') return json({ service: 'sw-revival lobby', ok: true }, 200, c.headers);
    return json({ error: 'not found' }, 404, c.headers);
  }
};

export class Registry {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(req) {
    const url = new URL(req.url),
      now = Date.now();
    const all = await this.ctx.storage.list({ prefix: 'l:' });
    if (url.pathname === '/list') {
      const out = [];
      for (const [key, e] of all) {
        if (now - e.at > LISTING_TTL) {
          await this.ctx.storage.delete(key);
          continue;
        }
        out.push({ id: key.slice(2), ...e.meta, age: Math.round((now - e.created) / 1000) });
      }
      return json(out);
    }
    const body = await req.json();
    if (url.pathname === '/put') {
      const key = 'l:' + body.id,
        old = all.get(key),
        ip = String(body.ip || '');
      if (!old && all.size >= MAX_LOBBIES) return json({ ok: false, why: 'The game list is full.' });
      if (!old && ip && [...all].filter(([k, e]) => k !== key && e.ip === ip && now - e.at <= LISTING_TTL).length >= LOBBIES_PER_IP)
        return json({ ok: false, why: 'Too many games are listed from this address.' });
      await this.ctx.storage.put(key, { meta: body.meta, at: now, created: old ? old.created : now, ip });
      return json({ ok: true });
    }
    if (url.pathname === '/del') {
      await this.ctx.storage.delete('l:' + body.id);
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  }
}

const HALL_MAX = 400;
const CHAT_LEN = 200,
  CHAT_GAP = 700;

export class Hall {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }
  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }
  live(except = null) {
    const now = Date.now();
    return this.ctx.getWebSockets().filter(ws => {
      if (ws === except) return false;
      if (fresh(this.ctx, ws, ws.deserializeAttachment() || {}, now)) return true;
      drop(ws);
      return false;
    });
  }
  all(msg, except = null) {
    const s = JSON.stringify(msg);
    for (const ws of this.live())
      if (ws !== except)
        try {
          ws.send(s);
        } catch {}
  }
  players(except = null) {
    const names = this.live(except)
      .map(ws => (ws.deserializeAttachment() || {}).name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    this.all({ t: 'players', names }, except);
  }

  async fetch(req) {
    const name = cleanName(new URL(req.url).searchParams.get('name')),
      ip = ipOf(req);
    const [client, server] = Object.values(new WebSocketPair());
    const present = this.live();
    const full =
      present.length >= HALL_MAX
        ? 'the lobby is full'
        : ip && present.filter(ws => (ws.deserializeAttachment() || {}).ip === ip).length >= HALL_PER_IP
          ? 'too many connections from this address'
          : null;
    if (full) {
      server.accept();
      server.close(4010, full);
      return new Response(null, { status: 101, webSocket: client });
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ name, last: 0, ip, at: Date.now() });
    if (!this.forgot) {
      this.forgot = true;
      await this.ctx.storage.delete('history');
    }
    this.players();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 1024) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!spend(ws, HALL_BURST, HALL_RATE)) return;
    const me = ws.deserializeAttachment() || {};
    me.at = Date.now();
    if (msg.t === 'name') {
      me.name = cleanName(msg.name);
      ws.serializeAttachment(me);
      this.players();
      return;
    }
    if (msg.t === 'say') {
      const text = String(msg.text || '')
          .replace(/[\u0000-\u001f]/g, ' ')
          .trim()
          .slice(0, CHAT_LEN),
        now = Date.now();
      if (!text || now - (me.last || 0) < CHAT_GAP) return;
      me.last = now;
      ws.serializeAttachment(me);
      const line = { name: me.name, text };
      this.all({ t: 'chat', ...line });
    }
  }
  async webSocketClose(ws, code) {
    finishClose(ws, code);
    this.players(ws);
  }
  async webSocketError(ws) {
    this.players(ws);
  }
}

function finishClose(ws, code) {
  try {
    ws.close(code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000, 'closed');
  } catch {}
}

const cleanName = n =>
  String(n || 'Player')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, NAME_LEN) || 'Player';

function cleanMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const s = (v, n) => String(v ?? '').slice(0, n);
  const i = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));
  return {
    name: s(meta.name, 48),
    host: s(meta.host, NAME_LEN),
    map: s(meta.map, 64),
    mode: s(meta.mode, 16),
    players: i(meta.players, 0, 100),
    slots: i(meta.slots, 0, 100),
    version: s(meta.version, 64),
    mod: s(meta.mod, 64),
    locked: !!meta.locked,
    started: !!meta.started
  };
}

export class Lobby {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.joins = new Map();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  sockets() {
    const now = Date.now();
    return this.ctx
      .getWebSockets()
      .map(ws => ({ ws, a: ws.deserializeAttachment() || {} }))
      .filter(s => !s.a.counted && fresh(this.ctx, s.ws, s.a, now));
  }
  async prune() {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.counted || fresh(this.ctx, ws, a, now)) continue;
      await this.gone(ws);
      drop(ws);
    }
  }
  find(id) {
    return this.sockets().find(s => s.a.id === id);
  }
  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }
  joinAllowed(ip) {
    const now = Date.now();
    let b = this.joins.get(ip);
    if (!b) this.joins.set(ip, (b = { left: JOIN_BURST, at: now }));
    b.left = Math.min(JOIN_BURST, b.left + ((now - b.at) / 1000) * JOIN_RATE);
    b.at = now;
    if (this.joins.size > 4096) for (const [k, v] of this.joins) if (v.left >= JOIN_BURST - 1) this.joins.delete(k);
    if (b.left < 1) return false;
    b.left--;
    return true;
  }
  registry() {
    return this.env.REGISTRY.get(this.env.REGISTRY.idFromName('main'));
  }

  async fetch(req) {
    const url = new URL(req.url);
    const name = cleanName(url.searchParams.get('name'));
    const lobby = url.searchParams.get('lobby'),
      ip = ipOf(req);
    await this.prune();
    const present = this.sockets();
    const host = present.find(s => s.a.role === 'host');
    const [client, server] = Object.values(new WebSocketPair());
    const refuse = (code, why) => {
      server.accept();
      server.close(code, why);
      return new Response(null, { status: 101, webSocket: client });
    };
    const resume = url.searchParams.get('resume'),
      token = url.searchParams.get('token');
    let id, role;
    if (resume !== null) {
      id = Number(resume);
      const known = await this.ctx.storage.get('tok:' + id);
      if (!known || known !== token || present.some(s => s.a.id === id)) return refuse(4004, 'no such game');
      role = id === 0 ? 'host' : 'join';
      const away = (await this.ctx.storage.get('away')) || {};
      delete away[id];
      await this.ctx.storage.put('away', away);
    } else {
      role = url.searchParams.get('role') === 'host' ? 'host' : 'join';
      const open = !!(await this.ctx.storage.get('lobby'));
      if (role === 'host' && open) return refuse(4009, 'game already has a host');
      if (role === 'join' && (!open || !host)) return refuse(4004, 'no such game');
      if (role === 'join' && (await this.ctx.storage.get('locked'))) return refuse(4011, 'the game has already started');
      if (present.length >= MAX_PEERS) return refuse(4010, 'game is full');
      if (ip && present.filter(s => s.a.ip === ip).length >= ROOM_PER_IP) return refuse(4010, 'too many connections from this address');
      if (role === 'join' && ip && !this.joinAllowed(ip)) return refuse(4010, 'too many tries from this address: wait a minute');
      if (role === 'join') {
        id = (await this.ctx.storage.get('next')) || 1;
        await this.ctx.storage.put('next', id + 1);
      } else {
        id = 0;
        await this.ctx.storage.put('lobby', lobby);
        await this.ctx.storage.put('ip', ip);
      }
    }
    const tok = resume !== null ? token : crypto.randomUUID();
    await this.ctx.storage.put('tok:' + id, tok);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, role, name, ip, at: Date.now() });
    this.send(server, { t: 'welcome', id, token: tok, resumed: resume !== null });
    if (host && resume === null) this.send(host.ws, { t: 'join', id, name });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_FRAME) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const me = ws.deserializeAttachment() || {};
    if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
    if (msg.t === 'bye') {
      me.bye = true;
      ws.serializeAttachment(me);
      try {
        ws.close(1000, 'bye');
      } catch {}
      await this.gone(ws);
      return;
    }
    if (msg.t === 'to') {
      if (!spend(ws, RELAY_BURST[me.role] || RELAY_BURST.join, RELAY_RATE[me.role] || RELAY_RATE.join)) return;
      if (msg.to === '*') {
        if (me.role !== 'host') return;
        for (const s of this.sockets()) if (s.ws !== ws) this.send(s.ws, { t: 'from', from: me.id, d: msg.d });
        return;
      }
      if (me.role !== 'host' && msg.to !== 0) return;
      const target = this.find(msg.to);
      if (target) this.send(target.ws, { t: 'from', from: me.id, d: msg.d });
      return;
    }
    if (msg.t === 'meta' && me.role === 'host' && !me.counted) {
      // at most one listing write every few seconds; the latest one is kept and sent when the gap is over
      this.meta = cleanMeta(msg.meta);
      const wait = (this.metaAt || 0) + META_GAP - Date.now();
      if (wait > 0) {
        this.metaTimer ||= setTimeout(() => {
          this.metaTimer = null;
          this.list(ws).catch(() => {});
        }, wait);
        return;
      }
      await this.list(ws);
      return;
    }
    if (me.role !== 'host') return;
    if (msg.t === 'lock') {
      await this.ctx.storage.put('locked', !!msg.on);
      return;
    }
    if (msg.t === 'kick' && Number.isInteger(msg.id) && msg.id !== 0) {
      // the host sent this peer away: close its socket and don't let it resume
      const target = this.find(msg.id);
      await this.ctx.storage.delete('tok:' + msg.id);
      if (!target) return;
      target.a.counted = true;
      try {
        target.ws.serializeAttachment(target.a);
        target.ws.close(4003, 'removed by the host');
      } catch {}
    }
  }

  async list(ws) {
    this.metaAt = Date.now();
    const meta = this.meta,
      lobby = await this.ctx.storage.get('lobby');
    if (!lobby) return;
    const ip = (await this.ctx.storage.get('ip')) || '';
    const r = await this.registry().fetch('https://registry' + (meta ? '/put' : '/del'), {
      method: 'POST',
      body: JSON.stringify({ id: lobby, meta, ip })
    });
    // The game may have ended while the listing was written: take it down again.
    if (meta && !(await this.ctx.storage.get('lobby')))
      await this.registry().fetch('https://registry/del', { method: 'POST', body: JSON.stringify({ id: lobby }) });
    const res = await r.json().catch(() => ({}));
    const refused = meta && res.ok === false;
    if (refused !== !!this.refused) this.send(ws, { t: 'listing', ok: !refused, why: res.why || '' });
    this.refused = refused;
  }

  async webSocketClose(ws, code) {
    finishClose(ws, code);
    await this.gone(ws);
  }
  async webSocketError(ws) {
    await this.gone(ws);
  }

  async gone(ws) {
    const me = ws.deserializeAttachment() || {};
    if (me.counted) return;
    me.counted = true;
    try {
      ws.serializeAttachment(me);
    } catch {}
    if (me.id === undefined || !(await this.ctx.storage.get('lobby'))) return;
    if (me.bye) return this.left(me.id, true);
    const away = (await this.ctx.storage.get('away')) || {};
    away[me.id] = Date.now() + AWAY_GRACE;
    await this.ctx.storage.put('away', away);
    await this.ctx.storage.setAlarm(Math.min(...Object.values(away)));
  }

  async alarm() {
    const away = (await this.ctx.storage.get('away')) || {},
      now = Date.now();
    for (const [id, until] of Object.entries(away)) {
      if (until > now) continue;
      delete away[id];
      await this.ctx.storage.put('away', away);
      if (!this.sockets().some(s => s.a.id === Number(id))) await this.left(Number(id));
    }
    const left = Object.values((await this.ctx.storage.get('away')) || {});
    if (left.length) await this.ctx.storage.setAlarm(Math.min(...left));
  }

  async left(id, bye = false) {
    if (id === 0) {
      for (const s of this.sockets()) {
        this.send(s.ws, { t: 'closed' });
        try {
          s.ws.close(4000, 'host left');
        } catch {}
      }
      const lobby = await this.ctx.storage.get('lobby');
      if (lobby) await this.registry().fetch('https://registry/del', { method: 'POST', body: JSON.stringify({ id: lobby }) });
      await this.ctx.storage.deleteAll();
    } else {
      await this.ctx.storage.delete('tok:' + id);
      const host = this.sockets().find(s => s.a.role === 'host');
      if (host) this.send(host.ws, { t: 'leave', id, bye });
    }
  }
}
