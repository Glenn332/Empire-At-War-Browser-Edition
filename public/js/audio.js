import { diag } from './diag.js';
import { playableWave } from './wavadpcm.js';
import { db } from './gamedata.js';
import { fetchBinary, fetchText, mediaUrl } from './vfs.js';
import { SpeechPlayer } from './speech.js';
import { activeLanguage } from './language.js';
import { localizedAudioFile } from './localizedmedia.js';

const POSITIONAL_VOICES = 32;
const FLAT_VOICES = 24;
const STOLEN_FADE_SECONDS = 0.03;
const MAX_HEARING_DISTANCE = 15000;
const HEADPHONES_KEY = 'swr-audio-headphones';

const storedHeadphones = () => {
  try {
    return localStorage.getItem(HEADPHONES_KEY) !== '0';
  } catch {
    return true;
  }
};

const release = el => {
  el.pause();
  el.src = '';
  el.node?.disconnect();
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.instances = new Map();
    this.positional = new Set();
    this.listener = { x: 0, y: 0, dist: 1500 };
    this.falloff = 1;
    this.forceNext = false;
    this.boostNext = 0;
    this.sfxVolume = 0.7;
    this.musicVolume = 0.45;
    this.voiceVolume = 0.9;
    this.masterVolume = 1;
    this.music = null;
    this.playlist = [];
    this.playIndex = 0;
    this.once = false;
    this.musicMode = -1;
    this.musicEvent = null;
    this.musicGain = 1;
    this.fadeIn = 0;
    this.fadeOut = 0;
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
    this.spatial = null;
    this.ear = { x: 0, y: 0, z: 0, rightX: 1, rightY: 0, rightZ: 0, placed: false };
    this.heightAt = null;
    this.headphones = storedHeadphones();
  }

  setHeadphones(on) {
    this.headphones = !!on;
    try {
      localStorage.setItem(HEADPHONES_KEY, on ? '1' : '0');
    } catch {}
  }

  listenFrom(camera) {
    const M = this.space3D;
    if (!M || !camera?.matrixWorld) return;
    const m = camera.matrixWorld.elements,
      eyeX = m[12],
      eyeY = m[13],
      eyeZ = m[14];
    let forwardX = -m[8],
      forwardY = -m[9],
      forwardZ = -m[10];
    const length = Math.hypot(forwardX, forwardY, forwardZ) || 1;
    forwardX /= length;
    forwardY /= length;
    forwardZ /= length;
    const reach = Math.abs(eyeZ - M.pull),
      ear = this.ear;
    ear.x = eyeX + forwardX * reach;
    ear.y = eyeY + forwardY * reach;
    ear.z = eyeZ + forwardZ * reach;
    ear.rightX = m[0];
    ear.rightY = m[1];
    ear.rightZ = m[2];
    ear.placed = true;
    const listener = this.ctx?.listener;
    if (!listener || this.spatial) return;
    if (listener.positionX) {
      listener.positionX.value = ear.x;
      listener.positionY.value = ear.y;
      listener.positionZ.value = ear.z;
      listener.forwardX.value = forwardX;
      listener.forwardY.value = forwardY;
      listener.forwardZ.value = forwardZ;
      listener.upX.value = m[4];
      listener.upY.value = m[5];
      listener.upZ.value = m[6];
    } else {
      listener.setPosition(ear.x, ear.y, ear.z);
      listener.setOrientation(forwardX, forwardY, forwardZ, m[4], m[5], m[6]);
    }
  }

  soundHeight(x, y) {
    return this.heightAt ? this.heightAt(x, y) || 0 : 0;
  }

  placedPanner(saturation, x, y) {
    const M = this.space3D;
    if (!M || !this.ear.placed || !this.ctx.createPanner) return null;
    const panner = this.ctx.createPanner();
    panner.panningModel = this.headphones ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = Math.max(1, saturation * M.sat);
    panner.rolloffFactor = M.roll;
    panner.maxDistance = MAX_HEARING_DISTANCE;
    this.placePanner(panner, x, y);
    return panner;
  }

  placePanner(panner, x, y) {
    const z = this.soundHeight(x, y);
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    } else panner.setPosition(x, y, z);
  }

  async useAudioMode(prefix) {
    const xml = await this.audioXml();
    const num = (tag, d) => {
      const m = xml && new RegExp('<' + tag + '>\\s*([-\\d.]+)', 'i').exec(xml);
      return m ? parseFloat(m[1]) : d;
    };
    this.space3D = {
      sat: num(`Audio_${prefix}_3D_Saturation_Distance_Mod`, 1),
      roll: num(`Audio_${prefix}_3D_Rolloff_Distance_Mod`, 1),
      pull: num(`Audio_${prefix}_3D_Listener_Z_Pullback_Dist`, 0)
    };
  }

  reset() {
    this.stopLoops();
    this.stopMusic();
    this.speech?.clear(false);
    if (this.speech) this.speech.suspended = 0;
    this.hud = [];
    this.hudUntil = 0;
    this.voiceUntil = 0;
    this.human = null;
    this.menuOnly = false;
    this.movieUp = false;
    this.space3D = null;
    this.spatial = null;
    this.heightAt = null;
    this.ear.placed = false;
  }

  audioXml() {
    return (this._audioXml ||= fetchText('Data/XML/Audio.xml').catch(() => null));
  }

  async playAudioEvent(tag) {
    const xml = await this.audioXml(),
      m = xml && new RegExp('<' + tag + '>\\s*([^<\\s]+)', 'i').exec(xml);
    if (m) this.play(m[1]);
  }

  ducked(v) {
    const r = this.speech?.queue?.[0];
    return r && r.state === 'playing' && !this.movieUp ? Math.min(v, 0.3) : v;
  }

  get voiceVolume() {
    return this._voiceVolume;
  }
  set voiceVolume(value) {
    this._voiceVolume = value;
    this.speech?.setVolume();
  }

  unlock() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.master.gain.value = this.masterVolume;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  async buffer(file, language = activeLanguage) {
    const key = file.toUpperCase() + '|language=' + language;
    let p = this.buffers.get(key);
    if (!p) {
      p = fetchBinary(file, { language, keep: false })
        .then(buf => (buf ? diag.task('sound ' + file.split('/').pop(), () => this.ctx.decodeAudioData(playableWave(buf.slice(0)))) : null))
        .catch(() => null);
      this.buffers.set(key, p);
    }
    return p;
  }

  loopable(buf) {
    const rate = buf.sampleRate,
      over = n => (n / rate) * rate > n;
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
    if (M && this.ear.placed) {
      const ear = this.ear,
        dx = x - ear.x,
        dy = y - ear.y,
        dz = this.soundHeight(x, y) - ear.z,
        d = Math.hypot(dx, dy, dz),
        s = Math.max(1, sat * M.sat),
        held = Math.min(d, MAX_HEARING_DISTANCE);
      const gain = held <= s ? 1 : s / (s + M.roll * (held - s));
      const across = d > 0 ? (dx * ear.rightX + dy * ear.rightY + dz * ear.rightZ) / d : 0;
      return { gain, pan: Math.max(-1, Math.min(1, across)) };
    }
    if (M) {
      const dx = x - this.listener.x,
        dy = y - this.listener.y,
        d = Math.hypot(dx, dy, M.pull),
        s = Math.max(1, sat * M.sat);
      const gain = d <= s ? 1 : d >= MAX_HEARING_DISTANCE ? 0 : s / (s + M.roll * (d - s));
      return { gain, pan: this.panOf(dx, dy, d) };
    }
    const L = this.listener,
      EAR = 0.35;
    const cx = L.cx ?? L.x,
      cy = L.cy ?? L.y,
      cz = L.cz ?? L.dist;
    const ex = L.x + (cx - L.x) * EAR,
      ey = L.y + (cy - L.y) * EAR,
      ez = cz * EAR;
    const dx = x - ex,
      dy = y - ey,
      d = Math.hypot(dx, dy, ez);
    const gain = sat > 0 && d > sat ? (sat / d) ** this.falloff : 1;
    let fx = L.x - cx,
      fy = L.y - cy;
    const fl = Math.hypot(fx, fy);
    if (fl > 1) {
      fx /= fl;
      fy /= fl;
    } else {
      fx = 0;
      fy = 1;
    }
    const pan = Math.max(-0.9, Math.min(0.9, (dx * fy - dy * fx) / Math.max(d, 1)));
    return { gain, pan };
  }
  panOf(dx, dy, d) {
    const L = this.listener,
      cx = L.cx ?? L.x,
      cy = L.cy ?? L.y;
    let fx = L.x - cx,
      fy = L.y - cy;
    const fl = Math.hypot(fx, fy);
    if (fl > 1) {
      fx /= fl;
      fy /= fl;
    } else {
      fx = 0;
      fy = 1;
    }
    return Math.max(-0.9, Math.min(0.9, (dx * fy - dy * fx) / Math.max(d, 1)));
  }

  play(name, x, y, language = activeLanguage) {
    if (!name || !this.ctx) return false;
    if (this.menuOnly && !/^GUI_/i.test(name.trim())) return false;
    const ev = db.sfx.get(name.trim().toUpperCase());
    if (!ev) return false;
    const samples = ev.list('Samples');
    if (!samples.length) return true;
    const key = ev.name,
      now = this.ctx.currentTime,
      force = this.forceNext,
      boost = this.boostNext || 1;
    this.forceNext = false;
    this.boostNext = 0;
    if (this.ambientVOOff && ev.bool('Is_Ambient_VO')) return true;
    if (this.hudVOOff && ev.bool('Is_HUD_VO')) return true;
    if (this.unitResponseOff && ev.bool('Is_Unit_Response_VO')) return true;
    if (this.localizedOff && ev.bool('Localize')) return true;
    const prob = ev.num('Probability', 100);
    if (prob < 100 && Math.random() * 100 > prob) return true;
    const reply = ev.bool('Is_Unit_Response_VO'),
      hud = ev.bool('Is_HUD_VO');
    const voice = reply || hud || ev.bool('Is_Ambient_VO') || ev.bool('Localize');
    const group = ev.str('Overlap_Test').toUpperCase();
    if (voice && group && now < (this.groups.get(group) || 0)) return true;
    if (hud && now < this.hudUntil) {
      if (this.hud.length < 4 && !this.hud.some(h => h.name === name)) this.hud.push({ name, at: now, language });
      return true;
    }
    const priority = ev.num('Priority', 3),
      positional = x !== undefined && !voice && ev.bool('Is_3D', !ev.bool('Is_2D')),
      distance = positional ? this.listenerDistance(x, y) : 0,
      instances = this.instances.get(key) || this.instances.set(key, new Set()).get(key);
    let replaced = null,
      displaced = null;
    if (!force) {
      const limit = ev.num('Max_Instances', 1);
      if (limit <= 0) return true;
      if (instances.size >= limit) {
        replaced = positional ? this.farthestOf(instances) : null;
        if (!replaced || distance > this.listenerDistance(replaced.x, replaced.y)) return true;
      }
      if (positional && this.positional.size - (replaced ? 1 : 0) + this.loops.size >= POSITIONAL_VOICES) {
        displaced = this.leastImportantOf(this.positional, replaced);
        if (!displaced || priority > displaced.priority || distance >= this.listenerDistance(displaced.x, displaced.y)) return true;
      }
      if (!voice && !positional && this.total - this.positional.size >= FLAT_VOICES) return true;
    }

    let gain = (ev.num('Min_Volume', 80) + Math.random() * (ev.num('Max_Volume', 80) - ev.num('Min_Volume', 80))) / 100;
    const saturation = ev.num('Volume_Saturation_Distance', 400),
      placed = positional && !this.spatial && !!this.space3D && this.ear.placed && !!this.ctx.createPanner;
    let pan = 0,
      far = 1;
    if (positional) {
      const h = this.hear(saturation, x, y);
      far = h.gain;
      pan = h.pan;
      if (gain * far < 0.02) return true;
    }
    gain = (voice ? gain * this.voiceVolume : this.ducked(gain * this.sfxVolume)) * (placed ? 1 : far) * boost;
    let file;
    if (ev.bool('Play_Sequentially')) {
      const i = this.seq.get(key) || 0;
      file = samples[i % samples.length];
      this.seq.set(key, i + 1);
    } else file = samples[Math.floor(Math.random() * samples.length)];
    if (ev.bool('Localize')) file = localizedAudioFile(file, language);
    if (replaced) this.stopInstance(replaced);
    if (displaced) this.stopInstance(displaced);
    const instance = { x, y, priority, source: null, gain: null, stopped: false, release: null };
    instances.add(instance);
    if (positional) this.positional.add(instance);
    this.total++;
    const delay = (ev.num('Min_Predelay', 0) + Math.random() * Math.max(0, ev.num('Max_Predelay', 0) - ev.num('Min_Predelay', 0))) / 1000;
    if (voice && group) this.groups.set(group, now + delay + 1.2);
    if (hud) this.hudUntil = now + delay + 1.2;
    if (reply) this.voiceUntil = now + delay + 1.2;
    const done = (instance.release = () => {
      if (!instances.delete(instance)) return;
      this.positional.delete(instance);
      this.total = Math.max(0, this.total - 1);
    });
    this.buffer(file, language).then(buf => {
      if (!buf || instance.stopped) {
        done();
        return;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const lo = ev.num('Min_Pitch', 100),
        hi = ev.num('Max_Pitch', 100);
      const rate = (src.playbackRate.value = (lo + Math.random() * (hi - lo)) / 100);
      const g = this.ctx.createGain();
      g.gain.value = gain;
      instance.source = src;
      instance.gain = g;
      let node = g;
      const S = positional ? this.spatial : null,
        panner = placed ? this.placedPanner(saturation, x, y) : null;
      if (panner) {
        g.connect(panner);
        node = panner;
      } else if (!S && positional && this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner();
        p.pan.value = pan;
        g.connect(p);
        node = p;
      }
      src.connect(g);
      if (S) S.route(g, x, y);
      else node.connect(this.master);
      const at = this.ctx.currentTime + delay,
        end = at + buf.duration / rate;
      if (voice && group) this.groups.set(group, end);
      if (hud) this.hudUntil = end + 0.15;
      if (reply) this.voiceUntil = Math.max(this.voiceUntil, end);
      const playing = (this.playing ||= new Map()),
        tag = key.toUpperCase();
      (playing.get(tag) || playing.set(tag, new Set()).get(tag)).add(src);
      src.onended = () => {
        playing.get(tag)?.delete(src);
        done();
        if (src.stopped) return;
        const next = ev.str('Chained_SFXEvent');
        if (next) this.play(next, x, y);
        if (hud) this.nextHud();
      };
      src.start(at);
    });
    return true;
  }

  listenerDistance(x, y) {
    if (this.space3D && this.ear.placed) return Math.hypot(x - this.ear.x, y - this.ear.y, this.soundHeight(x, y) - this.ear.z);
    return Math.hypot(x - this.listener.x, y - this.listener.y);
  }

  farthestOf(instances) {
    let farthest = null,
      farthestDistance = -1;
    for (const instance of instances) {
      if (instance.x === undefined) continue;
      const distance = this.listenerDistance(instance.x, instance.y);
      if (distance > farthestDistance) {
        farthest = instance;
        farthestDistance = distance;
      }
    }
    return farthest;
  }

  leastImportantOf(instances, skipped) {
    let least = null,
      leastDistance = -1;
    for (const instance of instances) {
      if (instance === skipped) continue;
      const distance = this.listenerDistance(instance.x, instance.y);
      if (!least || instance.priority > least.priority || (instance.priority === least.priority && distance > leastDistance)) {
        least = instance;
        leastDistance = distance;
      }
    }
    return least;
  }

  stopInstance(instance) {
    instance.stopped = true;
    instance.release();
    const source = instance.source;
    if (!source) return;
    source.stopped = true;
    const now = this.ctx.currentTime;
    instance.gain.gain.cancelScheduledValues(now);
    instance.gain.gain.setTargetAtTime(0, now, STOLEN_FADE_SECONDS / 4);
    try {
      source.stop(now + STOLEN_FADE_SECONDS);
    } catch {}
  }

  nextHud() {
    const now = this.ctx.currentTime;
    while (this.hud.length) {
      const h = this.hud.shift();
      if (now - h.at > 8) continue;
      this.hudUntil = 0;
      this.play(h.name, undefined, undefined, h.language);
      return;
    }
  }

  setLoops(cands) {
    if (!this.ctx) return;
    if (this.menuOnly) cands = [];
    const MAX = 10,
      now = this.ctx.currentTime;
    const scored = [];
    for (const c of cands) {
      const ev = c.event && db.sfx.get(c.event.toUpperCase());
      if (!ev) continue;
      const h = this.hear(ev.num('Volume_Saturation_Distance', 400), c.x, c.y);
      const level = this.ducked((ev.num('Max_Volume', 80) / 100) * this.sfxVolume) * 0.55,
        gain = level * h.gain;
      if (gain > 0.012) scored.push({ c, ev, gain, level, pan: h.pan });
    }
    scored.sort((a, b) => b.gain - a.gain);
    const keep = new Map(),
      perEvent = new Map();
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
    const placed = !this.spatial && !!this.space3D && this.ear.placed && !!this.ctx.createPanner;
    for (const [id, { c, ev, gain: heard, level, pan }] of keep) {
      const gain = placed ? level : heard;
      let l = this.loops.get(id);
      if (!l) {
        const samples = ev.list('Samples');
        if (!samples.length) continue;
        l = {
          event: ev.name,
          language: activeLanguage,
          gain: null,
          pan: null,
          panner: null,
          x: c.x,
          y: c.y,
          src: null,
          alive: true,
          fadeOut: ev.num('Loop_Fade_Out_Seconds', 1)
        };
        this.loops.set(id, l);
        const fadeIn = ev.num('Loop_Fade_In_Seconds', 0.5),
          target = gain,
          at = pan;
        const sample = samples[Math.floor(Math.random() * samples.length)];
        this.buffer(ev.bool('Localize') ? localizedAudioFile(sample, l.language) : sample, l.language).then(buf => {
          if (!buf || !l.alive) {
            if (this.loops.get(id) === l) this.loops.delete(id);
            return;
          }
          const src = this.ctx.createBufferSource();
          src.buffer = this.loopable(buf);
          src.loop = true;
          const g = this.ctx.createGain();
          g.gain.value = 0;
          g.gain.linearRampToValueAtTime(target, this.ctx.currentTime + Math.max(0.05, fadeIn));
          src.connect(g);
          let out = g;
          l.panner = placed ? this.placedPanner(ev.num('Volume_Saturation_Distance', 400), l.x, l.y) : null;
          if (l.panner) {
            g.connect(l.panner);
            out = l.panner;
          } else if (this.ctx.createStereoPanner) {
            l.pan = this.ctx.createStereoPanner();
            l.pan.pan.value = at;
            g.connect(l.pan);
            out = l.pan;
          }
          out.connect(this.master);
          src.start(0, Math.random() * buf.duration);
          l.src = src;
          l.gain = g;
          l.out = out;
        });
      } else {
        l.x = c.x;
        l.y = c.y;
        if (l.gain) l.gain.gain.setTargetAtTime(gain, now, 0.15);
        if (l.pan) l.pan.pan.setTargetAtTime(pan, now, 0.15);
        if (l.panner) this.placePanner(l.panner, c.x, c.y);
      }
    }
  }

  endLoop(id, l) {
    l.alive = false;
    this.loops.delete(id);
    if (!l.src) return;
    const now = this.ctx.currentTime,
      t = Math.max(0.05, l.fadeOut);
    l.gain.gain.cancelScheduledValues(now);
    l.gain.gain.setTargetAtTime(0, now, t / 4);
    l.src.stop(now + t);
    l.src.onended = () => l.out.disconnect();
  }

  stopLoops() {
    for (const [id, l] of [...this.loops]) this.endLoop(id, l);
  }

  playFor(player, name) {
    if (player && player === this.human) return this.play(name);
    return false;
  }

  isVoice(name) {
    const ev = name && db.sfx.get(String(name).trim().toUpperCase());
    return !!ev && (ev.bool('Is_Unit_Response_VO') || ev.bool('Is_HUD_VO') || ev.bool('Is_Ambient_VO') || ev.bool('Localize'));
  }

  playAt(player, name, x, y) {
    if (!(name && db.sfx.get(String(name).trim().toUpperCase()))) return false;
    if (this.isVoice(name)) return this.playFor(player, name);
    return this.play(name, x, y);
  }

  setPlaylist(files, fade = false, once = false) {
    this.musicMode = -1;
    this.musicEvent = null;
    this.musicGain = 1;
    this.fadeIn = this.fadeOut = 0;
    this.playlist = files.slice();
    this.once = once;
    this.playIndex = Math.floor(Math.random() * Math.max(1, files.length));
    this.nextTrack(fade);
  }

  playMusicEvent(event, mode = -1) {
    if (!event) return false;
    const name = event.name || event.str?.('Name') || '',
      files = event.list('Files');
    if (!files.length) return false;
    if (this.musicEvent === name && this.music) {
      this.musicMode = mode;
      return false;
    }
    let at = 0;
    try {
      at = +(sessionStorage.getItem('swr.music.' + name) || 0) || 0;
    } catch {}
    this.playlist = files.slice();
    this.playIndex = at % files.length;
    this.once = !event.bool('Loop', false);
    this.musicMode = mode;
    this.musicEvent = name;
    this.musicGain = Math.max(0, Math.min(1, event.num('Volume_Percent', 100) / 100));
    this.fadeIn = Math.max(0, event.num('Fade_In_Seconds', 0));
    this.fadeOut = Math.max(0, event.num('Fade_Out_Previous_Seconds', 0));
    this.nextTrack(this.fadeOut > 0);
    return true;
  }
  advanceMusicPlace() {
    if (!this.musicEvent) return;
    try {
      sessionStorage.setItem('swr.music.' + this.musicEvent, String(this.playIndex % Math.max(1, this.playlist.length)));
    } catch {}
  }
  musicLevel() {
    return this.musicVolume * this.masterVolume * this.musicGain;
  }

  nextTrack(fade = false) {
    const missing = this.missingMusic || (this.missingMusic = new Set());
    if (!this.playlist.some(f => !missing.has(f.toUpperCase()))) {
      if (this.music) {
        this.music.onended = this.music.onerror = null;
        release(this.music);
        this.music = null;
      }
      return;
    }
    let file;
    do file = this.playlist[this.playIndex++ % this.playlist.length];
    while (missing.has(file.toUpperCase()));
    this.advanceMusicPlace();
    const old = this.music;
    if (old) {
      old.onended = old.onerror = null;
      if (fade && this.musicEvent && this.fadeOut > 0) {
        const from = old.volume,
          start = performance.now(),
          span = this.fadeOut * 1000;
        const step = () => {
          const k = Math.min(1, (performance.now() - start) / span);
          old.volume = from * (1 - k);
          if (k < 1) setTimeout(step, 50);
          else {
            release(old);
          }
        };
        step();
      } else if (fade) {
        const step = () => {
          old.volume = Math.max(0, old.volume - 0.04 * Math.max(0.2, this.musicVolume));
          if (old.volume > 0.01) setTimeout(step, 80);
          else {
            release(old);
          }
        };
        step();
      } else {
        release(old);
      }
    }
    const el = new window.Audio();
    if (this.ctx) {
      try {
        el.node = this.ctx.createMediaElementSource(el);
        el.node.connect(this.ctx.destination);
      } catch {
        el.node = null;
      }
    }
    el.volume = this.musicLevel();
    if (this.musicEvent && this.fadeIn > 0) {
      const start = performance.now(),
        span = this.fadeIn * 1000;
      el.volume = 0;
      const step = () => {
        if (this.music !== el) return;
        const k = Math.min(1, (performance.now() - start) / span);
        el.volume = this.musicLevel() * k;
        if (k < 1) setTimeout(step, 50);
      };
      el.addEventListener('playing', step, { once: true });
    }
    el.onended = () => {
      if (this.once) {
        if (this.music === el) {
          this.music = null;
          this.musicEvent = null;
          this.musicMode = -1;
        }
        this.playlist = [];
      } else this.nextTrack();
    };
    el.onerror = () => {
      if (this.music !== el) return;
      missing.add(file.toUpperCase());
      this.nextTrack();
    };
    this.music = el;
    mediaUrl('Data/Audio/Music/' + file).then(src => {
      if (this.music !== el) return;
      el.src = src;
      el.play().catch(() => {});
    });
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.music) this.music.volume = this.musicLevel();
  }
  allowVO(kind, on = true) {
    this[kind] = !on;
  }
  allowAmbientVO(on = true) {
    this.ambientVOOff = !on;
  }
  stopEvent(name) {
    const set = this.playing?.get(String(name || '').trim().toUpperCase());
    if (!set) return;
    for (const src of [...set]) {
      src.stopped = true;
      try {
        src.stop();
      } catch {}
    }
  }
  restoreMaster() {
    if (this.savedMaster == null) return;
    this.setMasterVolume(this.savedMaster);
    this.savedMaster = null;
  }
  setMasterVolume(v) {
    this.masterVolume = v;
    if (this.master) this.master.gain.value = v;
    if (this.music) this.music.volume = this.musicLevel();
  }
  stopMusic() {
    if (this.music) {
      this.music.pause();
      this.music.node?.disconnect();
      this.music = null;
    }
    this.playlist = [];
    this.musicMode = -1;
    this.musicEvent = null;
  }
}
