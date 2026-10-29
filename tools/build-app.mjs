import { cpSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LOBBY = 'https://lobby.playeaw.com';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(web, 'public'), dist = path.join(web, 'dist-app');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: web, encoding: 'utf8', shell: process.platform === 'win32', ...opts });

const commit = run('git', ['rev-parse', '--short', 'HEAD']).trim();
const build = commit + (run('git', ['status', '--porcelain', '--', 'public']).trim() ? '-dirty' : '');

const skip = new Set(['sw.js', 'test', 'game.tar.gz', 'game.tar']);
rmSync(dist, { recursive: true, force: true });
cpSync(pub, dist, { recursive: true, filter: src => !skip.has(path.relative(pub, src)) });
writeFileSync(path.join(dist, 'js', 'build.js'), `export const BUILD = '${build}';\n`);
writeFileSync(path.join(dist, 'js', 'deploy.js'),
  `export const LOBBY = ${JSON.stringify(LOBBY)};\nexport const FFMPEG = new URL('../vendor/ffmpeg/ffmpeg-core.js', import.meta.url).href;\n`);
console.log(`staged dist-app/ (${build})`);

if (!process.argv.includes('--stage')) run('npx', ['tauri', 'build'], { stdio: 'inherit', encoding: undefined });
