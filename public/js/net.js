import { LOBBY } from './deploy.js';

const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const DIRECT_TIMEOUT = 8000;
const PING_EVERY = 25000;
const PART = 20000;

export function lobbyUrl() {
  const q = new URLSearchParams(location.search).get('lobby');
  if (q) return q.replace(/\/$/, '');
  try {
    const s = localStorage.getItem('swr.lobby');
    if (s) return s.replace(/\/$/, '');
  } catch {}
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return 'http://localhost:8787';
  return LOBBY;
}

export async function listGames() {
  const r = await fetch(lobbyUrl() + '/lobbies', { cache: 'no-store' });
  if (!r.ok) throw new Error('lobby service: ' + r.status);
  return r.json();
}

export const newGameId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(9)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b & 31]).join('');

export function ticker(ms, fn) {
  let wk = null;
  try {
    const src = 'let t; onmessage = e => { clearInterval(t); if (e.data > 0) t = setInterval(() => postMessage(0), e.data); };';
    wk = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    wk.onmessage = () => fn();
    wk.postMessage(ms);
    return {
      stop() {
        wk.postMessage(0);
        wk.terminate();
      }
    };
  } catch {
    const t = setInterval(fn, ms);
    return {
      stop() {
        clearInterval(t);
      }
    };
  }
}

class Emitter {
  constructor() {
    this.handlers = {};
  }
  on(ev, fn) {
    (this.handlers[ev] ||= []).push(fn);
    return () => this.off(ev, fn);
  }
  off(ev, fn) {
    this.handlers[ev] = (this.handlers[ev] || []).filter(f => f !== fn);
  }
  emit(ev, ...a) {
    for (const fn of this.handlers[ev] || []) {
      try {
        fn(...a);
      } catch (e) {
        console.error(e);
      }
    }
  }
}

class Link {
  constructor(session, peer, initiator) {
    this.session = session;
    this.peer = peer;
    this.mode = 'connecting';
    this.queue = [];
    this.pc = new RTCPeerConnection({ iceServers: STUN });
    this.pc.onicecandidate = e => {
      if (e.candidate) this.signal({ ice: e.candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => {
      const st = this.pc.connectionState;
      if (st === 'failed' && this.mode === 'connecting') this.useRelay();
      else if ((st === 'failed' || st === 'closed') && this.mode === 'direct') this.session.lost(this.peer);
    };
    if (initiator) {
      this.attach(this.pc.createDataChannel('game', { ordered: true }));
      this.pc
        .createOffer()
        .then(o => this.pc.setLocalDescription(o))
        .then(() => this.signal({ sdp: this.pc.localDescription.toJSON() }))
        .catch(() => this.useRelay());
    } else {
      this.pc.ondatachannel = e => this.attach(e.channel);
    }
    this.timer = setTimeout(() => {
      if (this.mode === 'connecting') this.useRelay();
    }, DIRECT_TIMEOUT);
  }

  signal(d) {
    this.session.out({ t: 'to', to: this.peer, d: { rtc: d } });
  }

  async onSignal(d) {
    try {
      if (d.sdp) {
        await this.pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === 'offer') {
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          this.signal({ sdp: this.pc.localDescription.toJSON() });
        }
      } else if (d.ice) await this.pc.addIceCandidate(d.ice);
    } catch (e) {
      console.warn('[net] signal', e);
    }
  }

  attach(dc) {
    this.dc = dc;
    dc.onopen = () => {
      if (this.mode !== 'relay') this.ready('direct');
    };
    dc.onmessage = e => this.session.receive(this.peer, JSON.parse(e.data));
    dc.onclose = () => {
      if (this.mode === 'direct') this.session.lost(this.peer);
    };
  }

  useRelay() {
    if (this.mode !== 'connecting') return;
    this.session.out({ t: 'to', to: this.peer, d: { relay: true } });
    this.ready('relay');
  }

  forceRelay() {
    if (this.mode === 'connecting') return this.ready('relay');
    if (this.mode !== 'direct') return;
    this.mode = 'relay';
    try {
      this.pc.close();
    } catch {}
    this.session.emit('link', this.peer, 'relay');
  }

  ready(mode) {
    if (this.mode !== 'connecting') return;
    clearTimeout(this.timer);
    this.mode = mode;
    if (mode === 'relay')
      try {
        this.pc.close();
      } catch {}
    for (const m of this.queue) this.send(m);
    this.queue = [];
    this.session.emit('link', this.peer, mode);
  }

  send(msg) {
    if (this.mode === 'connecting') {
      this.queue.push(msg);
      return;
    }
    const s = JSON.stringify(msg);
    if (s.length <= PART) {
      this.sendText(s);
      return;
    }
    const id = ++this.session.parts,
      n = Math.ceil(s.length / PART);
    for (let i = 0; i < n; i++) this.sendText(JSON.stringify({ _part: id, i, n, s: s.slice(i * PART, (i + 1) * PART) }));
  }

  sendText(s) {
    if (this.mode === 'direct' && this.dc?.readyState === 'open') this.dc.send(s);
    else this.session.out({ t: 'to', to: this.peer, d: { m: s } });
  }

  close() {
    clearTimeout(this.timer);
    try {
      this.dc?.close();
      this.pc.close();
    } catch {}
    this.mode = 'closed';
  }
  direct() {
    return this.mode === 'direct' && this.dc?.readyState === 'open' && this.pc.connectionState === 'connected';
  }
}

export class NetSession extends Emitter {
  constructor() {
    super();
    this.links = new Map();
    this.id = null;
    this.host = false;
    this.parts = 0;
    this.pieces = new Map();
  }

  connect(gameId, { host, name }) {
    this.host = !!host;
    this.gameId = gameId;
    this.name = name || 'Player';
    this.outbox = [];
    this.onHide = () => this.close();
    addEventListener('pagehide', this.onHide);
    return new Promise((resolve, reject) => this.open(resolve, reject));
  }

  open(resolve = null, reject = null) {
    const base = lobbyUrl().replace(/^http/, 'ws') + '/lobby/' + this.gameId + '?name=' + encodeURIComponent(this.name);
    const url =
      base + (this.token ? '&resume=' + this.id + '&token=' + encodeURIComponent(this.token) : '&role=' + (this.host ? 'host' : 'join'));
    const ws = (this.ws = new WebSocket(url));
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.t === 'welcome') {
        const first = this.id === null;
        this.id = msg.id;
        this.token = msg.token;
        this.retries = 0;
        this.ping?.stop();
        this.ping = ticker(PING_EVERY, () => ws.readyState === 1 && ws.send('{"t":"ping"}'));
        for (const m of this.outbox.splice(0)) ws.send(JSON.stringify(m));
        if (first) {
          if (!this.host) this.links.set(0, new Link(this, 0, true));
          this.emit('open', this.id);
          resolve?.(this.id);
        } else this.emit('back');
      } else this.control(msg);
    };
    ws.onclose = e => {
      if (this.ws !== ws) return;
      this.ping?.stop();
      this.ping = null;
      if (this.id === null) {
        reject?.(new Error(e.reason || 'could not connect (' + e.code + ')'));
        return;
      }
      if (this.closing) return;
      if (e.code === 4004 || e.code === 4000) {
        this.roomGone();
        return;
      }
      this.emit('away');
      const wait = Math.min(15000, 1000 * 2 ** Math.min(4, (this.retries = (this.retries || 0) + 1)));
      setTimeout(() => {
        if (!this.closing) this.open();
      }, wait);
    };
    ws.onerror = () => {};
  }

  out(m) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
    else if (this.outbox) this.outbox.push(m);
  }

  roomGone() {
    if (this.closing) return;
    if (!this.host && this.links.get(0)?.direct()) {
      this.roomless = true;
      return;
    }
    this.closing = true;
    this.emit('closed', 'host left');
  }

  control(msg) {
    if (msg.t === 'join' && this.host) {
      this.links.set(msg.id, new Link(this, msg.id, false));
      this.emit('join', msg.id, msg.name);
    } else if (msg.t === 'leave' && this.host) {
      if (msg.bye || !this.links.get(msg.id)?.direct()) this.lost(msg.id);
    } else if (msg.t === 'closed') this.roomGone();
    else if (msg.t === 'from') {
      const link = this.links.get(msg.from),
        d = msg.d || {};
      if (!link) return;
      if (d.rtc) link.onSignal(d.rtc);
      else if (d.relay) link.forceRelay();
      else if (d.m !== undefined) this.receive(msg.from, JSON.parse(d.m));
    }
  }

  receive(from, msg) {
    if (msg && msg._part !== undefined) {
      const key = from + ':' + msg._part,
        got = this.pieces.get(key) || [];
      got.push(msg.s);
      if (got.length < msg.n) {
        this.pieces.set(key, got);
        return;
      }
      this.pieces.delete(key);
      msg = JSON.parse(got.join(''));
    }
    this.emit('message', from, msg);
  }

  lost(peer) {
    const link = this.links.get(peer);
    if (!link) return;
    link.close();
    this.links.delete(peer);
    if (this.host) this.emit('leave', peer);
    else if (!this.closing) {
      this.closing = true;
      this.emit('closed', 'host left');
    }
  }

  send(peer, msg) {
    this.links.get(peer)?.send(msg);
  }
  broadcast(msg, except = null) {
    for (const [p, l] of this.links) if (p !== except) l.send(msg);
  }

  setListing(meta) {
    this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ t: 'meta', meta }));
  }

  kick(peer) {
    this.send(peer, { k: 'kicked' });
    setTimeout(() => this.lost(peer), 200);
  }

  linkMode(peer) {
    return this.links.get(peer)?.mode;
  }

  close() {
    if (this.closing && !this.links.size) return;
    this.closing = true;
    this.ping?.stop();
    this.ping = null;
    if (this.onHide) removeEventListener('pagehide', this.onHide);
    for (const l of this.links.values()) l.close();
    this.links.clear();
    try {
      if (this.ws?.readyState === 1) this.ws.send('{"t":"bye"}');
      this.ws?.close(1000, 'bye');
    } catch {}
  }
}

export class Hall extends Emitter {
  constructor(name) {
    super();
    this.name = name;
    this.closed = false;
    this.connect();
  }
  connect() {
    if (this.closed) return;
    const ws = (this.ws = new WebSocket(lobbyUrl().replace(/^http/, 'ws') + '/hall?name=' + encodeURIComponent(this.name)));
    ws.onmessage = e => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'players') this.emit('players', m.names || []);
      else if (m.t === 'chat') this.emit('chat', m.name, m.text);
    };
    ws.onopen = () => {
      this.ping?.stop();
      this.ping = ticker(PING_EVERY, () => ws.readyState === 1 && ws.send('{"t":"ping"}'));
    };
    ws.onclose = () => {
      this.ping?.stop();
      this.ping = null;
      if (!this.closed) {
        this.emit('closed');
        setTimeout(() => this.connect(), 5000);
      }
    };
    ws.onerror = () => {};
  }
  say(text) {
    this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ t: 'say', text }));
  }
  rename(name) {
    this.name = name;
    this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ t: 'name', name }));
  }
  close() {
    this.closed = true;
    this.ping?.stop();
    try {
      this.ws?.close(1000, 'bye');
    } catch {}
  }
}
