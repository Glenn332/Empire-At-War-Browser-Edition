import { diag } from './diag.js';
import { db } from './gamedata.js';
import { fetchBinary, fetchText, mediaUrl } from './vfs.js';
import { SpeechPlayer } from './speech.js';
import { activeLanguage } from './language.js';
import { localizedAudioFile } from './localizedmedia.js';

const release = el => { el.pause(); el.src = ''; el.node?.disconnect(); };

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.active = new Map();
    this.lastPlay = new Map();
    this.listener = { x: 0, y: 0, dist: 1500 };
    this.sfxVolume = 0.7; this.musicVolume = 0.45; this.voiceVolume = 0.9; this.masterVolume = 1;
    this.music = null;
    this.playlist = []; this.playIndex = 0; this.once = false;
    this.musicMode = -1; this.musicEvent = null; this.musicGain = 1; this.fadeIn = 0; this.fadeOut = 0;
    this.human = null;
    this.voiceUntil = 0;
    this.total = 0;
    this.seq = new Map();
    this.groups = new Map();
    this.hud = [];
    this.hudUntil = 0;
    this.loops = new Map();
    this.speech = new SpeechPlayer(this);
    this.space3D = null;
  }

  async useAudioMode(prefix) {
    const xml = await this.audioXml();
    const num = (tag, d) => { const m = xml && new RegExp('<' + tag + '>\\s*([-\\d.]+)', 'i').exec(xml); return m ? parseFloat(m[1]) : d; };
    this.space3D = { sat: num(`Audio_${prefix}_3D_Saturation_Distance_Mod`, 1), roll: num(`Audio_${prefix}_3D_Rolloff_Distance_Mod`, 1), pull: num(`Audio_${prefix}_3D_Listener_Z_Pullback_Dist`, 0) };
  }

  reset() {
    this.stopLoops(); this.stopMusic(); this.speech?.clear(false);
    if (this.speech) this.speech.suspended = 0;
    this.hud = []; this.hudUntil = 0; this.voiceUntil = 0;
    this.human = null; this.menuOnly = false; this.movieUp = false; this.space3D = null;
  }

  audioXml() { return this._audioXml ||=fetchText('Data/XML/Audio.xml').catch(() => null); }

  async playAudioEvent(tag) {
    const xml = await this.audioXml(), m = xml && new RegExp('<' + tag + '>\\s*([^<\\s]+)', 'i').exec(xml);
    if (m) this.play(m[1]);
  }

  ducked(v) {
    const r = this.speech?.queue?.[0];
    return r && r.state === 'playing' && !this.movieUp ? Math.min(v, 0.3) : v;
  }

  get voiceVolume() { return this._voiceVolume; }
  set voiceVolume(value) { this._voiceVolume=value;this.speech?.setVolume(); }

  unlock() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.master.gain.value = this.masterVolume;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  async buffer(file,language=activeLanguage) {
    const key = file.toUpperCase()+'|language='+language;
    let p = this.buffers.get(key);
    if (!p) {
      p = fetchBinary(file,{language,keep:false}).then(buf => (buf ? diag.task('sound ' + file.split('/').pop(), () => this.ctx.decodeAudioData(buf.slice(0))) : null)).catch(() => null);
      this.buffers.set(key, p);
    }
    return p;
  }

  loopable(buf) {
    const rate = buf.sampleRate, over = n => (n / rate) * rate > n;
    if (!over(buf.length) || typeof this.ctx?.createBuffer !== 'function') return buf;
    let clean = (this.cleanLoops ||= new WeakMap()).get(buf);
    if (!clean) {
      let n = buf.length - 1;
      while (n > 1 && over(n)) n--;
      clean = this.ctx.createBuffer(buf.numberOfChannels, n, rate);
      for (let c = 0; c < buf.numberOfChannels; c++) clean.copyToChannel(buf.getChannelData(c).subarray(0, n), c);
      this.cleanLoops.set(buf, clean);
    }
    return clean;
  }

  hear(sat, x, y) {
    const M = this.space3D;
    if (M) {
      const dx = x - this.listener.x, dy = y - this.listener.y, d = Math.hypot(dx, dy, M.pull), s = Math.max(1, sat * M.sat);
      const gain = d <= s ? 1 : d >= 15000 ? 0 : s / (s + M.roll * (d - s));
      return { gain, pan: this.panOf(dx, dy, d) };
    }
    const L = this.listener, EAR = 0.35;
    const cx = L.cx ?? L.x, cy = L.cy ?? L.y, cz = L.cz ?? L.dist;
    const ex = L.x + (cx - L.x) * EAR, ey = L.y + (cy - L.y) * EAR, ez = cz * EAR;
    const dx = x - ex, dy = y - ey, d = Math.hypot(dx, dy, ez);
    const gain = sat > 0 && d > sat ? sat / d : 1;
    let fx = L.x - cx, fy = L.y - cy; const fl = Math.hypot(fx, fy);
    if (fl > 1) { fx /= fl; fy /= fl; } else { fx = 0; fy = 1; }
    const pan = Math.max(-0.9, Math.min(0.9, (dx * fy - dy * fx) / Math.max(d, 1)));
    return { gain, pan };
  }
  panOf(dx, dy, d) {
    const L = this.listener, cx = L.cx ?? L.x, cy = L.cy ?? L.y;
    let fx = L.x - cx, fy = L.y - cy; const fl = Math.hypot(fx, fy);
    if (fl > 1) { fx /= fl; fy /= fl; } else { fx = 0; fy = 1; }
    return Math.max(-0.9, Math.min(0.9, (dx * fy - dy * fx) / Math.max(d, 1)));
  }

  play(name, x, y, language = activeLanguage) {
    if (!name || !this.ctx) return false;
    if (this.menuOnly && !/^GUI_/i.test(name.trim())) return false;
    const ev = db.sfx.get(name.trim().toUpperCase());
    if (!ev) return false;
    const samples = ev.list('Samples');
    if (!samples.length) return true;
    const key = ev.name, now = this.ctx.currentTime;
    const live = this.active.get(key) || 0;
    if (live >= ev.num('Max_Instances', 4)) return true;
    const prob = ev.num('Probability', 100);
    if (prob < 100 && Math.random() * 100 > prob) return true;
    const reply = ev.bool('Is_Unit_Response_VO'), hud = ev.bool('Is_HUD_VO');
    const voice = reply || hud || ev.bool('Is_Ambient_VO') || ev.bool('Localize');
    const group = ev.str('Overlap_Test').toUpperCase();
    if (voice && group && now < (this.groups.get(group) || 0)) return true;
    if (hud && now < this.hudUntil) {
      if (this.hud.length < 4 && !this.hud.some(h => h.name === name)) this.hud.push({ name, at: now, language });
      return true;
    }
    if (!voice && now - (this.lastPlay.get(key) || -1) < 0.04) return true;
    const prio = ev.num('Priority', 3);
    if (!voice && ((this.total >= 40 && prio >= 3) || (this.total >= 28 && prio >= 4) || this.total >= 56)) return true;
    this.lastPlay.set(key, now);

    let gain = (ev.num('Min_Volume', 80) + Math.random() * (ev.num('Max_Volume', 80) - ev.num('Min_Volume', 80))) / 100;
    let pan = 0, far = 1;
    const positional = x !== undefined && !voice && ev.bool('Is_3D', !ev.bool('Is_2D'));
    if (positional) {
      const h = this.hear(ev.num('Volume_Saturation_Distance', 400), x, y);
      far = h.gain; pan = h.pan;
      if (gain * far < 0.02) return true;
    }
    gain = (voice ? gain * this.voiceVolume : this.ducked(gain * this.sfxVolume)) * far;
    let file;
    if (ev.bool('Play_Sequentially')) { const i = this.seq.get(key) || 0; file = samples[i % samples.length]; this.seq.set(key, i + 1); }
    else file = samples[Math.floor(Math.random() * samples.length)];
    if(ev.bool('Localize'))file=localizedAudioFile(file,language);
    this.active.set(key, live + 1);
    this.total++;
    const delay = (ev.num('Min_Predelay', 0) + Math.random() * Math.max(0, ev.num('Max_Predelay', 0) - ev.num('Min_Predelay', 0))) / 1000;
    if (voice && group) this.groups.set(group, now + delay + 1.2);
    if (hud) this.hudUntil = now + delay + 1.2;
    if (reply) this.voiceUntil = now + delay + 1.2;
    const done = () => { this.active.set(key, Math.max(0, (this.active.get(key) || 1) - 1)); this.total = Math.max(0, this.total - 1); };
    this.buffer(file,language).then(buf => {
      if (!buf) { done(); return; }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const lo = ev.num('Min_Pitch', 100), hi = ev.num('Max_Pitch', 100);
      const rate = src.playbackRate.value = (lo + Math.random() * (hi - lo)) / 100;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      let node = g;
      if (positional && this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = pan;
        g.connect(p); node = p;
      }
      src.connect(g); node.connect(this.master);
      const at = this.ctx.currentTime + delay, end = at + buf.duration / rate;
      if (voice && group) this.groups.set(group, end);
      if (hud) this.hudUntil = end + 0.15;
      if (reply) this.voiceUntil = Math.max(this.voiceUntil, end);
      src.onended = () => {
        done();
        const next = ev.str('Chained_SFXEvent');
        if (next) this.play(next, x, y);
        if (hud) this.nextHud();
      };
      src.start(at);
    });
    return true;
  }

  nextHud() {
    const now = this.ctx.currentTime;
    while (this.hud.length) {
      const h = this.hud.shift();
      if (now - h.at > 8) continue;
      this.hudUntil = 0;
      this.play(h.name,undefined,undefined,h.language);
      return;
    }
  }

  setLoops(cands) {
    if (!this.ctx) return;
    if (this.menuOnly) cands = [];
    const MAX = 10, now = this.ctx.currentTime;
    const scored = [];
    for (const c of cands) {
      const ev = c.event && db.sfx.get(c.event.toUpperCase());
      if (!ev) continue;
      const h = this.hear(ev.num('Volume_Saturation_Distance', 400), c.x, c.y);
      const gain = this.ducked((ev.num('Max_Volume', 80) / 100) * this.sfxVolume) * h.gain * 0.55;
      if (gain > 0.012) scored.push({ c, ev, gain, pan: h.pan });
    }
    scored.sort((a, b) => b.gain - a.gain);
    const keep = new Map(), perEvent = new Map();
    for (const s of scored) {
      if (keep.size >= MAX) break;
      const n = perEvent.get(s.ev.name) || 0;
      if (n >= Math.max(1, s.ev.num('Max_Instances', 2))) continue;
      perEvent.set(s.ev.name, n + 1);
      keep.set(s.c.id, s);
    }
    for (const [id, l] of this.loops) {
      const k = keep.get(id);
      if (k && k.ev.name === l.event) continue;
      this.endLoop(id, l);
    }
    for (const [id, { c, ev, gain, pan }] of keep) {
      let l = this.loops.get(id);
      if (!l) {
        const samples = ev.list('Samples');
        if (!samples.length) continue;
        l = { event: ev.name, language:activeLanguage, gain: null, pan: null, src: null, alive: true, fadeOut: ev.num('Loop_Fade_Out_Seconds', 1) };
        this.loops.set(id, l);
        const fadeIn = ev.num('Loop_Fade_In_Seconds', 0.5), target = gain, at = pan;
        const sample=samples[Math.floor(Math.random() * samples.length)];
        this.buffer(ev.bool('Localize')?localizedAudioFile(sample,l.language):sample,l.language).then(buf => {
          if (!buf || !l.alive) { if (this.loops.get(id) === l) this.loops.delete(id); return; }
          const src = this.ctx.createBufferSource();
          src.buffer = this.loopable(buf); src.loop = true;
          const g = this.ctx.createGain();
          g.gain.value = 0;
          g.gain.linearRampToValueAtTime(target, this.ctx.currentTime + Math.max(0.05, fadeIn));
          src.connect(g);
          let out = g;
          if (this.ctx.createStereoPanner) { l.pan = this.ctx.createStereoPanner(); l.pan.pan.value = at; g.connect(l.pan); out = l.pan; }
          out.connect(this.master);
          src.start(0, Math.random() * buf.duration);
          l.src = src; l.gain = g; l.out = out;
        });
      } else if (l.gain) {
        l.gain.gain.setTargetAtTime(gain, now, 0.15);
        if (l.pan) l.pan.pan.setTargetAtTime(pan, now, 0.15);
      }
    }
  }

  endLoop(id, l) {
    l.alive = false;
    this.loops.delete(id);
    if (!l.src) return;
    const now = this.ctx.currentTime, t = Math.max(0.05, l.fadeOut);
    l.gain.gain.cancelScheduledValues(now);
    l.gain.gain.setTargetAtTime(0, now, t / 4);
    l.src.stop(now + t);
    l.src.onended = () => l.out.disconnect();
  }

  stopLoops() { for (const [id, l] of [...this.loops]) this.endLoop(id, l); }

  playFor(player, name) { if (player && player === this.human) return this.play(name); return false; }

  playAt(player, name, x, y) {
    const ev = name && db.sfx.get(String(name).trim().toUpperCase());
    if (!ev) return false;
    if (ev.bool('Is_Unit_Response_VO') || ev.bool('Is_HUD_VO') || ev.bool('Is_Ambient_VO') || ev.bool('Localize')) return this.playFor(player, name);
    return this.play(name, x, y);
  }

  setPlaylist(files, fade = false, once = false) {
    this.musicMode = -1; this.musicEvent = null; this.musicGain = 1; this.fadeIn = this.fadeOut = 0;
    this.playlist = files.slice();
    this.once = once;
    this.playIndex = Math.floor(Math.random() * Math.max(1, files.length));
    this.nextTrack(fade);
  }

  playMusicEvent(event, mode = -1) {
    if (!event) return false;
    const name = event.name || event.str?.('Name') || '', files = event.list('Files');
    if (!files.length) return false;
    if (this.musicEvent === name && this.music) { this.musicMode = mode; return false; }
    let at = 0;
    try { at = +(sessionStorage.getItem('swr.music.' + name) || 0) || 0; } catch { }
    this.playlist = files.slice(); this.playIndex = at % files.length; this.once = !event.bool('Loop', false);
    this.musicMode = mode; this.musicEvent = name;
    this.musicGain = Math.max(0, Math.min(1, event.num('Volume_Percent', 100) / 100));
    this.fadeIn = Math.max(0, event.num('Fade_In_Seconds', 0)); this.fadeOut = Math.max(0, event.num('Fade_Out_Previous_Seconds', 0));
    this.nextTrack(this.fadeOut > 0);
    return true;
  }
  advanceMusicPlace() {
    if (!this.musicEvent) return;
    try { sessionStorage.setItem('swr.music.' + this.musicEvent, String(this.playIndex % Math.max(1, this.playlist.length))); } catch { }
  }
  musicLevel() { return this.musicVolume * this.masterVolume * this.musicGain; }

  nextTrack(fade = false) {
    const missing = this.missingMusic || (this.missingMusic = new Set());
    if (!this.playlist.some(f => !missing.has(f.toUpperCase()))) {
      if (this.music) { this.music.onended = this.music.onerror = null; release(this.music); this.music = null; }
      return;
    }
    let file;
    do file = this.playlist[this.playIndex++ % this.playlist.length]; while (missing.has(file.toUpperCase()));
    this.advanceMusicPlace();
    const old = this.music;
    if (old) {
      old.onended = old.onerror = null;
      if (fade && this.musicEvent && this.fadeOut > 0) {
        const from = old.volume, start = performance.now(), span = this.fadeOut * 1000;
        const step = () => { const k = Math.min(1, (performance.now() - start) / span); old.volume = from * (1 - k); if (k < 1) setTimeout(step, 50); else { release(old); } };
        step();
      } else if (fade) {
        const step = () => { old.volume = Math.max(0, old.volume - 0.04 * Math.max(0.2, this.musicVolume)); if (old.volume > 0.01) setTimeout(step, 80); else { release(old); } };
        step();
      } else { release(old); }
    }
    const el = new window.Audio();
    if (this.ctx) { try { el.node = this.ctx.createMediaElementSource(el); el.node.connect(this.ctx.destination); } catch { el.node = null; } }
    el.volume = this.musicLevel();
    if (this.musicEvent && this.fadeIn > 0) {
      const start = performance.now(), span = this.fadeIn * 1000; el.volume = 0;
      const step = () => { if (this.music !== el) return; const k = Math.min(1, (performance.now() - start) / span); el.volume = this.musicLevel() * k; if (k < 1) setTimeout(step, 50); };
      el.addEventListener('playing', step, { once: true });
    }
    el.onended = () => { if (this.once) { if (this.music === el) { this.music = null; this.musicEvent = null; this.musicMode = -1; } this.playlist = []; } else this.nextTrack(); };
    el.onerror = () => { if (this.music !== el) return; missing.add(file.toUpperCase()); this.nextTrack(); };
    this.music = el;
    mediaUrl('Data/Audio/Music/' + file).then(src => { if (this.music !== el) return; el.src = src; el.play().catch(() => {}); });
  }

  setMusicVolume(v) { this.musicVolume = v; if (this.music) this.music.volume = this.musicLevel(); }
  setMasterVolume(v) { this.masterVolume = v; if (this.master) this.master.gain.value = v; if (this.music) this.music.volume = this.musicLevel(); }
  stopMusic() { if (this.music) { this.music.pause(); this.music.node?.disconnect(); this.music = null; } this.playlist = []; this.musicMode = -1; this.musicEvent = null; }
}
