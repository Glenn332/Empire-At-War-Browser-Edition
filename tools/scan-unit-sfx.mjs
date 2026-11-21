import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame } from './megfs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argument = name => {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : process.argv[at + 1];
};
function findInstall() {
  for (let directory = path.resolve(HERE, '..', '..'); ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'Star Wars Empire at War');
    if (fs.existsSync(candidate) || path.dirname(directory) === directory) return candidate;
  }
}
const installPath = argument('--game') || process.env.SWR_GAME || findInstall();
const modPath = argument('--mod') || process.env.SWR_TEST_MOD || null;
const verbose = process.argv.includes('--list');
const archive = openGame(installPath, modPath ? [modPath] : []);

globalThis.fetch = async input => {
  const request = String(input);
  if (request.startsWith('api/find?q=')) {
    const pattern = new RegExp(decodeURIComponent(request.slice(11)), 'i');
    return new Response(JSON.stringify([...archive.index.keys()].filter(name => pattern.test(name))));
  }
  const key = archive.resolve(decodeURIComponent(request.replace(/^asset\//, '').split('?')[0])),
    data = key && archive.read(key);
  return new Response(data ? new Uint8Array(data) : null, { status: data ? 200 : 404 });
};
const { db, loadGameData } = await import('../public/js/gamedata.js');
const { playableWave } = await import('../public/js/wavadpcm.js');
const { weaponFireSound } = await import('../public/js/game/weaponswap.js');
const { localizedAudioFile } = await import('../public/js/localizedmedia.js');
await loadGameData();

const BROWSER_WAVE_FORMATS = new Set([1, 3, 6, 7, 0xfffe]);

function sourceTagNames() {
  const names = new Set(),
    prefixes = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.js'))
        for (const match of fs.readFileSync(file, 'utf8').matchAll(/['"`]([A-Za-z_]*SFX[A-Za-z_]*)['"`$]/g)) {
          if (match[1].endsWith('_')) prefixes.push(match[1].toUpperCase());
          else names.add(match[1].toUpperCase());
        }
    }
  };
  walk(path.join(HERE, '..', 'public', 'js'));
  return { has: tag => names.has(tag.toUpperCase()) || prefixes.some(prefix => tag.toUpperCase().startsWith(prefix)) };
}

function waveProblem(bytes) {
  if (!bytes || !bytes.length) return 'empty file';
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const head = Buffer.from(bytes.subarray(0, 4)).toString('latin1');
  if (head === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return null;
  if (head !== 'RIFF') return 'not a RIFF or MP3 file';
  const playable = new DataView(playableWave(buffer));
  let position = 12,
    format = null,
    hasData = false;
  while (position + 8 <= playable.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(playable.buffer, position, 4)),
      size = playable.getUint32(position + 4, true);
    if (id === 'fmt ')
      format = {
        tag: playable.getUint16(position + 8, true),
        channels: playable.getUint16(position + 10, true),
        rate: playable.getUint32(position + 12, true),
        bits: playable.getUint16(position + 22, true)
      };
    if (id === 'data') hasData = size > 0;
    position += 8 + size + (size & 1);
  }
  if (!format) return 'no fmt chunk';
  if (!hasData) return 'no data';
  if (!BROWSER_WAVE_FORMATS.has(format.tag)) return 'wave format ' + format.tag + ' not decoded';
  if (format.rate < 3000 || format.rate > 768000) return 'sample rate ' + format.rate;
  if (format.channels < 1 || format.channels > 32) return format.channels + ' channels';
  return null;
}

const fileProblems = new Map();
function sampleProblem(sample, localized) {
  const file = localized ? localizedAudioFile(sample, 0) : sample,
    key = archive.resolve(file);
  if (!key) return 'file not found: ' + file;
  if (!fileProblems.has(key)) fileProblems.set(key, waveProblem(archive.read(key)));
  return fileProblems.get(key);
}

function eventProblems(name) {
  const event = db.sfx.get(name.trim().toUpperCase());
  if (!event) return ['event not defined'];
  const samples = event.list('Samples');
  if (!samples.length) return event.list('Pre_Samples').length || event.list('Post_Samples').length ? ['only pre or post samples'] : ['no samples'];
  const problems = [];
  for (const sample of samples) {
    const problem = sampleProblem(sample, event.bool('Localize'));
    if (problem) problems.push(sample + ': ' + problem);
  }
  return problems.length === samples.length ? problems : problems.map(problem => 'one of ' + samples.length + ' samples, ' + problem);
}

const played = sourceTagNames();
const isEventTag = key => /sfx/i.test(key) && !/seconds|delay|distance|chance|range/i.test(key);

function referencesOf(object) {
  const references = [];
  for (const [key, values] of object.props) {
    if (!isEventTag(key)) continue;
    for (const value of values) {
      const name = String(value).split(',').pop().trim();
      if (name && !/^(none|null|0|yes|no|true|false)$/i.test(name)) references.push({ tag: key, event: name });
    }
  }
  return references;
}

const findings = [];
const add = (owner, tag, event, reason) => findings.push({ owner, tag, event, reason });

for (const type of db.types.values()) {
  for (const { tag, event } of referencesOf(type)) {
    if (!played.has(tag)) add(type.name, tag, event, 'tag never played');
    for (const problem of eventProblems(event)) add(type.name, tag, event, problem);
  }
  const ownFire = type.str('SFXEvent_Fire').trim();
  for (const hardpointName of type.list('HardPoints')) {
    const hardpoint = db.hardpoint(hardpointName),
      projectile = hardpoint && db.type(hardpoint.str('Fire_Projectile_Type'));
    if (!projectile) continue;
    const gun = { fireSfx: hardpoint.str('Fire_SFXEvent').trim(), proj: projectile },
      engine = gun.fireSfx || ownFire,
      ours = String(weaponFireSound(type, gun) || '').trim();
    if (engine.toUpperCase() === ours.toUpperCase()) continue;
    const tag = 'HardPoints/' + hardpointName;
    if (!ours) add(type.name, tag, engine, 'hardpoint shot silent');
    else add(type.name, tag, engine, 'hardpoint shot plays ' + (engine ? 'another event' : 'an event the engine does not'));
  }
}
for (const hardpoint of db.hardpoints.values())
  for (const { tag, event } of referencesOf(hardpoint)) {
    if (!played.has(tag)) add('HardPoint ' + hardpoint.name, tag, event, 'tag never played');
    for (const problem of eventProblems(event)) add('HardPoint ' + hardpoint.name, tag, event, problem);
  }

const byReason = new Map();
for (const finding of findings) {
  const reason = finding.reason.replace(/^((?:one of \d+ samples, )?)[^:]*: (file not found)[^]*$/, '$1$2').replace(/^((?:one of \d+ samples, )?)[^:]+\.(wav|mp3): /i, '$1').replace(/^one of \d+ samples/, 'some samples');
  const group = byReason.get(reason) || byReason.set(reason, { count: 0, tags: new Map(), examples: [] }).get(reason);
  group.count++;
  group.tags.set(finding.tag, (group.tags.get(finding.tag) || 0) + 1);
  if (group.examples.length < 4) group.examples.push(`${finding.owner} ${finding.tag}=${finding.event}`);
}
console.log(`${modPath ? 'mod ' + path.basename(modPath) : 'base game'}: ${db.types.size} types, ${db.hardpoints.size} hardpoints, ${db.sfx.size} sound events, ${findings.length} findings`);
for (const [reason, group] of [...byReason].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`\n${group.count}  ${reason}`);
  console.log('   tags: ' + [...group.tags].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, count]) => `${tag} ${count}`).join(', '));
  for (const example of group.examples) console.log('   e.g. ' + example);
}
if (verbose) for (const finding of findings) console.log([finding.owner, finding.tag, finding.event, finding.reason].join('\t'));
archive.close();
