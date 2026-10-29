import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';

const archive = openGame(fileURLToPath(new URL('../../Star Wars Empire at War', import.meta.url)));
const overrides = new Map(),
  gates = new Map(),
  audio = [];
globalThis.fetch = async input => {
  const name = decodeURIComponent(
    String(input)
      .replace(/^asset\//, '')
      .split('?')[0]
  )
    .replace(/\\/g, '/')
    .toUpperCase();
  if (gates.has(name)) await gates.get(name);
  const key = archive.resolve(name),
    bytes = overrides.has(name) ? overrides.get(name) : key && archive.read(key);
  return new Response(bytes || null, { status: bytes ? 200 : 404 });
};
const hold = name => {
  let release;
  gates.set(
    name.toUpperCase(),
    new Promise(resolve => {
      release = resolve;
    })
  );
  return release;
};
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
};
const canvases = [];
globalThis.document = {
  createElement: tag => {
    assert.equal(tag, 'canvas');
    const canvas = {
      style: {},
      dataset: {},
      hidden: false,
      width: 0,
      height: 0,
      removed: false,
      remove() {
        this.removed = true;
      },
      getContext: () => ({ clearRect() {}, putImageData() {} })
    };
    canvases.push(canvas);
    return canvas;
  },
  body: { appendChild() {} }
};
globalThis.ImageData = class {
  constructor(data, width, height) {
    Object.assign(this, { data, width, height });
  }
};
globalThis.Worker = class {
  constructor() {
    this.dead = false;
    this.messages = [];
  }
  postMessage(message) {
    this.messages.push(message);
    if (message.type === 'open') {
      this.id = message.id;
      queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', id: message.id } }));
    } else if (message.type === 'decode')
      queueMicrotask(() => {
        for (let index = message.start; index < message.start + message.count; index++)
          this.onmessage?.({ data: { type: 'frame', id: message.id, index, pixels: new Uint8Array([255, 255, 255, 255]).buffer } });
        this.onmessage?.({ data: { type: 'done', id: message.id, start: message.start } });
      });
  }
  terminate() {
    this.dead = true;
  }
};
const { movieDefinitions } = await import('../public/js/game/galacticmovies.js');
const { TacticalMovies } = await import('../public/js/game/tacticalmovies.js');
const { parseXML } = await import('../public/js/xml.js');
const { binkHeader } = await import('../public/js/binkdata.js');
const { db } = await import('../public/js/gamedata.js');
const definitions = await movieDefinitions();
const intro = definitions.get('STAR_WARS_INTRO'),
  short = definitions.get('STAR_WARS_INTRO_SHORT');
assert(intro && short, 'Use original installed movie definitions');
assert.equal(intro.val('Pause_Game_While_Playing').toUpperCase(), 'TRUE');
assert.equal(intro.val('Text_Crawl_Name'), 'A_Long_Time_Ago');
const moviePath = node => node.val('Movie_File').replace(/\\/g, '/').toUpperCase();
for (const movie of [intro, short]) {
  const data = archive.read(archive.resolve(moviePath(movie)));
  assert(data?.length > 44);
  overrides.set(moviePath(movie), data.subarray(0, 44));
}
const game = {
  paused: false,
  audio: {
    stopMusic: () => audio.push(['stop']),
    play: name => audio.push(['sfx', name]),
    speech: { replace: name => audio.push(['speech', name]) },
    setPlaylist: files => audio.push(['music', files])
  }
};
const crawls = [],
  crawlGates = new Map();
const createCrawl = async name => {
  if (name === 'Rejected_Crawl') throw Error('Expected crawl asset failure');
  const crawl = {
    name,
    frames: [],
    disposed: 0,
    update(frame) {
      this.frames.push(frame);
    },
    dispose() {
      this.disposed++;
    }
  };
  crawls.push(crawl);
  if (crawlGates.has(name)) await crawlGates.get(name);
  return crawl;
};
const scripts = { missing: new Map() },
  movies = new TacticalMovies(game, scripts, { createCrawl });
const release = hold(moviePath(intro));
const first = movies.play('Star_Wars_Intro');
assert(!first.IsFinished(), 'The global handle is active before asynchronous definition and asset loading completes');
await settle();
assert(movies.active && movies.pausesMode);
assert(movies.canvas.hidden);
assert.equal(game.paused, false, 'Definition pause is independent of the player pause flag');
assert.equal(scripts.missing.get('Movie.Text_Crawl'), undefined, 'Authored text crawls use the native crawl renderer');
assert.equal(crawls[0].name, intro.val('Text_Crawl_Name'));
const second = movies.play('Star_Wars_Intro_Short');
await settle();
assert.equal(movies.movie, short);
assert(!first.IsFinished() && !second.IsFinished());
assert(!movies.canvas.hidden);
assert.equal(movies.player.alpha, true);
assert.equal(movies.canvas.style.cssText.includes('width:100vw;height:100vh'), true);
assert.equal(crawls[0].disposed, 1, 'Replacing a movie disposes its crawl');
assert.equal(crawls.at(-1).name, short.val('Text_Crawl_Name'));
movies.update(0, false);
assert.equal(
  crawls.at(-1).frames.at(-1),
  movies.player.frame + 1 - short.num('Text_Crawl_Start_Frame', 0),
  'The native one-based movie frame is offset by Text_Crawl_Start_Frame, including negative pre-start frames'
);
release();
await settle();
assert.equal(movies.movie, short, 'Stale asynchronous opens cannot replace the newer movie');
movies.stop();
assert(first.IsFinished() && second.IsFinished());
assert(!movies.pausesMode && movies.canvas.hidden);
assert.equal(crawls.at(-1).disposed, 1, 'Stop disposes the current crawl');
const missing = movies.play('Not_A_Movie_Definition');
assert(!missing.IsFinished());
await settle();
assert(missing.IsFinished());
const filename = movies.play(intro.val('Movie_File'));
await settle();
assert(filename.IsFinished());

const define = (name, file, body = '') => {
  const node = parseXML(`<Movies><Movie Name="${name}"><Movie_File>${file}</Movie_File>${body}</Movie></Movies>`).children[0].children[0];
  definitions.set(name.toUpperCase(), node);
  return node;
};
const installedHeader = overrides.get(moviePath(intro));
const header = Buffer.from(installedHeader);
header.writeUInt32LE(120, 8);
header.writeUInt32LE(12, 28);
header.writeUInt32LE(1, 32);
overrides.set('DATA/ART/MOVIES/STOP_PENDING_TEST.BIK', header);
define('Stop_Pending_Test', 'Data/Art/Movies/Stop_Pending_Test.bik', '<Pause_Game_While_Playing>True</Pause_Game_While_Playing>');
const releaseStopped = hold('DATA/ART/MOVIES/STOP_PENDING_TEST.BIK');
const stopped = movies.play('Stop_Pending_Test');
await settle();
assert(movies.pausesMode);
movies.stop();
releaseStopped();
await settle();
assert(stopped.IsFinished());
assert(movies.canvas.hidden && !movies.pausesMode && !movies.player.playing, 'Stop cancels an asynchronous asset open');
overrides.set('DATA/ART/MOVIES/CLOCK_TEST.BIK', header);
define(
  'Clock_Test',
  'Data/Art/Movies/Clock_Test.bik',
  '<Text_Crawl_Name>Clock_Crawl</Text_Crawl_Name><Text_Crawl_Start_Frame>4</Text_Crawl_Start_Frame><Movie_Start_Frame>2</Movie_Start_Frame><Pause_Game_While_Playing>Yes</Pause_Game_While_Playing><Halt_Game_Music>Yes</Halt_Game_Music><SFXEvent_Frame>SFX_First,3</SFXEvent_Frame><SFXEvent_Frame>SFX_Second,4</SFXEvent_Frame><SFXEvent_Frame>SFX_Later,7</SFXEvent_Frame><SpeechEvent_Frame>Speech_First,3</SpeechEvent_Frame><MusicEvent_Frame>Music_First,3</MusicEvent_Frame>'
);
db.music.set('MUSIC_FIRST', { list: () => ['Original_Track.mp3'] });
audio.length = 0;
const clock = movies.play('Clock_Test');
await settle();
assert(movies.active && movies.pausesMode);
assert.equal(movies.player.startFrame, 2);
assert.equal(movies.player.frame, 2);
assert.equal(movies.player.alpha, false, 'Native Alpha defaults false');
assert.equal(movies.player.header.fps, 12, 'The test header advertises a deliberately different rate');
const clockCrawl = crawls.at(-1);
movies.update(0.1, false);
assert.equal(movies.player.frame, 5, 'Playback advances three frames in .1 seconds at the native forced 30 FPS');
assert.equal(clockCrawl.frames.at(-1), 2, 'Crawl animation follows the authored movie frame offset');
assert.deepEqual(
  audio,
  [['stop'], ['sfx', 'SFX_First'], ['speech', 'Speech_First'], ['music', ['Original_Track.mp3']]],
  'Emit only the first XML entry per category crossed by one frame service'
);
movies.update(1 / 30, false);
assert.deepEqual(audio.at(-1), ['sfx', 'SFX_Later']);
const before = movies.player.frame;
movies.update(2, true);
assert.equal(movies.player.frame, before, 'Focus/menu pause freezes movie time');
movies.update(2, false);
assert.equal(movies.player.frame, before, 'Resuming discards elapsed paused wall time');
movies.update(1 / 30, false);
assert.equal(movies.player.frame, before + 1);
movies.update(100, false);
assert(clock.IsFinished());
assert(!movies.pausesMode && movies.canvas.hidden, 'Natural completion releases the mode-pause request');
assert.equal(clockCrawl.disposed, 1, 'Natural movie completion disposes its crawl');
define('Missing_File', 'Data/Art/Movies/Missing_Test.bik', '<Pause_Game_While_Playing>True</Pause_Game_While_Playing>');
const unavailable = movies.play('Missing_File');
await settle();
assert(unavailable.IsFinished() && !movies.pausesMode);
const previousWarn = console.warn;
console.warn = () => {};
const bad = Buffer.from(header);
bad.write('NOPE', 0);
overrides.set('DATA/ART/MOVIES/BAD_TEST.BIK', bad);
define(
  'Bad_File',
  'Data/Art/Movies/Bad_Test.bik',
  '<Text_Crawl_Name>Bad_Crawl</Text_Crawl_Name><Pause_Game_While_Playing>True</Pause_Game_While_Playing>'
);
const invalid = movies.play('Bad_File');
await settle();
console.warn = previousWarn;
assert(invalid.IsFinished() && !movies.pausesMode);
assert.equal(crawls.at(-1).name, 'Bad_Crawl');
assert.equal(crawls.at(-1).disposed, 1, 'Movie open failure disposes its crawl');
define(
  'Rejected_Crawl_Test',
  'Data/Art/Movies/Clock_Test.bik',
  '<Text_Crawl_Name>Rejected_Crawl</Text_Crawl_Name><Pause_Game_While_Playing>True</Pause_Game_While_Playing>'
);
console.warn = () => {};
const rejected = movies.play('Rejected_Crawl_Test');
await settle();
console.warn = previousWarn;
assert(!rejected.IsFinished() && movies.crawl === null, 'Crawl creation failure leaves the movie playing without its crawl');
movies.stop();
assert(
  rejected.IsFinished() && !movies.pausesMode && movies.canvas.hidden,
  'Stopping it then completes the global block and releases mode pause'
);
let releaseCrawl;
crawlGates.set(
  'Pending_Crawl',
  new Promise(resolve => {
    releaseCrawl = resolve;
  })
);
overrides.set('DATA/ART/MOVIES/PENDING_CRAWL_TEST.BIK', header);
define('Pending_Crawl_Test', 'Data/Art/Movies/Pending_Crawl_Test.bik', '<Text_Crawl_Name>Pending_Crawl</Text_Crawl_Name>');
const pendingCrawlMovie = movies.play('Pending_Crawl_Test');
await settle();
const pendingCrawl = crawls.at(-1);
assert.equal(pendingCrawl.name, 'Pending_Crawl');
movies.play('Clock_Test');
await settle();
const replacementCrawl = crawls.at(-1);
releaseCrawl();
await settle();
assert.equal(pendingCrawl.disposed, 1, 'Late crawl creation is disposed after a generation change');
assert.equal(movies.crawl, replacementCrawl);
assert(!pendingCrawlMovie.IsFinished(), 'The old global movie block still tracks the replacement');
const final = movies.play('Clock_Test');
await settle();
const worker = movies.player.worker,
  id = movies.player.id;
movies.stop();
worker.onmessage({ data: { type: 'frame', id, index: 0, pixels: new Uint8Array(4).buffer } });
assert(final.IsFinished());
assert.equal(movies.player.frame, -1);
assert(movies.canvas.hidden);
movies.dispose();
assert(canvases[0].removed && worker.dead);
assert(
  crawls.every(crawl => crawl.disposed === 1),
  'Every created crawl is disposed exactly once, including abandoned asynchronous opens'
);
assert(binkHeader(header.buffer.slice(header.byteOffset, header.byteOffset + header.byteLength)).frames === 120);
console.log(
  JSON.stringify({
    checks:
      'original movie XML and Bink headers, async replacement/stop/failure handles, native crawl frame offsets and async cleanup, independent mode-pause request, native 30 FPS and frame events, focus pause, disposal'
  })
);
