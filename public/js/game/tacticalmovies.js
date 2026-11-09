import { db } from '../gamedata.js';
import { fetchBinary } from '../vfs.js';
import { BinkPlayer } from '../bink.js';
import { TacticalCrawl } from './tacticalcrawl.js';
import { movieDefinitions } from './galacticmovies.js';
import { CreditsRoll } from './creditsroll.js';
import { movieSubtitles } from './subtitles.js';
import { fontFamily } from '../fonts.js';
const yes = value => /^(yes|true|1)$/i.test(value || '');
export class TacticalMovies {
  constructor(game, scripts, { createCrawl = name => TacticalCrawl.create(name) } = {}) {
    this.createCrawl = createCrawl;
    this.crawl = null;
    this.credits = null;
    this.game = game;
    this.scripts = scripts;
    this.active = false;
    this.pausesMode = false;
    this.onFinish = null;
    this.afterCredits = null;
    this.generation = 0;
    this.movie = null;
    this.frame = 0;
    this.canvas = document.createElement('canvas');
    this.canvas.hidden = true;
    this.canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9';
    document.body.appendChild(this.canvas);
    this.player = new BinkPlayer(this.canvas, {
      audio: () => {
        const audio = this.game.audio;
        return audio?.ctx ? { context: audio.ctx, destination: audio.master, volume: audio.musicVolume } : null;
      },
      onEnd: () => this.finish(),
      onError: error => {
        console.warn('Tactical movie', error);
        this.finish();
      }
    });
  }
  play(name, { loop = false, skippable = false } = {}) {
    this.stop();
    const generation = this.generation;
    this.active = true;
    this.skippable = skippable;
    if (skippable && !this.skipKey) {
      this.skipKey = e => {
        if (!this.active || !this.skippable || (e.code !== 'Escape' && e.code !== 'Space')) return;
        if (yes(this.movie?.val('Cannot_Skip'))) return;
        e.preventDefault();
        e.stopPropagation();
        this.stop();
      };
      addEventListener('keydown', this.skipKey, true);
    }
    this.open(name, generation, loop);
    return { __wrap: true, __name: 'BinkMovieBlockStatus', Is_Valid: () => true, IsFinished: () => !this.active, Result: () => true };
  }
  async open(name, generation, loop = false) {
    try {
      const movie = (await movieDefinitions()).get(String(name || '').toUpperCase());
      if (generation !== this.generation) return;
      if (!movie) {
        this.finish();
        return;
      }
      this.movie = movie;
      this.pausesMode = yes(movie.val('Pause_Game_While_Playing'));
      if (yes(movie.val('Halt_Game_Music'))) this.game.audio?.stopMusic();
      if (movie.val('Text_Crawl_Name')) {
        const crawl = await this.createCrawl(movie.val('Text_Crawl_Name')).catch(error => {
          console.warn('Text crawl', error);
          return null;
        });
        if (generation !== this.generation) {
          crawl?.dispose();
          return;
        }
        this.crawl = crawl;
        if (crawl?.canvas) crawl.canvas.style.zIndex = String((+this.canvas.style.zIndex || 9) + 1);
      }
      if (yes(movie.val('Has_Credits'))) {
        const credits = await CreditsRoll.create(this.game, { zIndex: (+this.canvas.style.zIndex || 9) + 1 }).catch(error => {
          console.warn('Credits', error);
          return null;
        });
        if (generation !== this.generation) {
          credits?.dispose();
          return;
        }
        this.credits = credits;
      }
      const buffer = await fetchBinary(movie.val('Movie_File'));
      if (generation !== this.generation) return;
      if (!buffer) {
        this.finish();
        return;
      }
      await this.player.play(buffer, { loop, alpha: yes(movie.val('Alpha')), startFrame: movie.num('Movie_Start_Frame', 0) });
      if (generation !== this.generation) return;
      this.frame = 0;
      this.canvas.hidden = false;
    } catch (error) {
      if (generation === this.generation) {
        console.warn('Tactical movie', error);
        this.finish();
      }
    }
  }
  update(dt, paused) {
    if (!this.active) return;
    this.player.setPaused(paused);
    this.player.update(dt);
    if (this.credits) {
      this.credits.update(dt, paused);
      if (this.credits.done) {
        const after = this.afterCredits;
        this.afterCredits = null;
        this.stop();
        after?.();
        return;
      }
    }
    if (!this.active || this.player.frame < 0) return;
    const crawlEnd = this.movie.num('Text_Crawl_End_Frame', 0);
    if (this.crawl && crawlEnd > 0 && this.player.frame + 1 > crawlEnd) {
      this.crawl.dispose();
      this.crawl = null;
    }
    this.crawl?.update(this.player.frame + 1 - this.movie.num('Text_Crawl_Start_Frame', 0));
    const frame = this.player.frame + 1,
      old = this.frame;
    this.frame = frame;
    for (const [tag, emit] of [
      ['SFXEvent_Frame', name => this.game.audio?.play(name)],
      ['SpeechEvent_Frame', name => this.game.audio?.speech?.replace(name)],
      [
        'MusicEvent_Frame',
        name => {
          const event = db.music.get(name.toUpperCase());
          const a = this.game.audio;
          if (!event) return;
          if (a?.playMusicEvent) a.playMusicEvent(event, 12);
          else a?.setPlaylist(event.list('Files'), false, true);
        }
      ]
    ]) {
      const entry = this.movie
        .all(tag)
        .map(node => node.text.trim().split(/[\s,]+/))
        .find(([name, at]) => name && old < +at && +at <= frame);
      if (entry) emit(entry[0]);
    }
    this.captions(old, frame);
  }
  captions(old, frame) {
    if (this.caption && frame >= this.caption.until) {
      this.caption.el.remove();
      this.caption = null;
    }
    if (!movieSubtitles() || typeof document === 'undefined') return;
    const pairs = tag =>
      this.movie
        .all(tag)
        .map(node => node.text.trim().split(/[\s,]+/))
        .filter(([id, n]) => id && Number.isFinite(+n));
    const start = pairs('Caption_Frame').find(([, at]) => old < +at && +at <= frame);
    if (!start) return;
    const id = start[0].toUpperCase(),
      length = +(pairs('Caption_Duration').find(([n]) => n.toUpperCase() === id)?.[1] ?? 150);
    this.caption?.el.remove();
    const el = document.createElement('div'),
      rect = this.canvas.getBoundingClientRect(),
      size = db.constants.num('Bink_Player_Caption_Font_Size', 10);
    el.className = 'movie-caption';
    el.textContent = db.t(id) || id;
    Object.assign(el.style, {
      position: 'fixed',
      left: rect.left + 'px',
      width: Math.max(200, rect.width) + 'px',
      top: rect.bottom + 4 + 'px',
      textAlign: 'center',
      color: '#fff',
      font: `${size * 1.6}px ${fontFamily(db.constants.str('Bink_Player_Caption_Font_Name') || 'EmpireAtWar-Medium')}`,
      textShadow: '0 0 2px #000, 0 0 2px #000',
      pointerEvents: 'none',
      zIndex: String((+this.canvas.style.zIndex || 9) + 1)
    });
    document.body.appendChild(el);
    this.caption = { el, until: +start[1] + length };
  }
  finish() {
    this.caption?.el.remove();
    this.caption = null;
    const done = this.onFinish;
    this.onFinish = null;
    this.crawl?.dispose();
    this.crawl = null;
    this.credits?.dispose();
    this.credits = null;
    this.active = false;
    this.skippable = false;
    this.pausesMode = false;
    this.movie = null;
    this.canvas.hidden = true;
    done?.();
  }
  stop() {
    this.generation++;
    this.player.stop();
    this.finish();
  }
  dispose() {
    if (this.skipKey) removeEventListener('keydown', this.skipKey, true);
    this.skipKey = null;
    this.stop();
    this.player.dispose();
    this.canvas.remove();
  }
}
