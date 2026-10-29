import { cpSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LOBBY = 'https://lobby.playeaw.com';
const FFMPEG = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(web, 'public'),
  dist = path.join(web, 'dist');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: web, encoding: 'utf8', shell: process.platform === 'win32' }).trim();
const esbuild = args => run('npx', ['--yes', 'esbuild@0.25.10', '--minify', '--allow-overwrite', '--log-level=error', ...args]);

const commit = run('git', ['rev-parse', '--short', 'HEAD']);
const build = commit + (run('git', ['status', '--porcelain', '--', 'public']) ? '-dirty' : '');

const skip = new Set([path.join('vendor', 'ffmpeg')]);
rmSync(dist, { recursive: true, force: true });
cpSync(pub, dist, { recursive: true, filter: src => !skip.has(path.relative(pub, src)) });

writeFileSync(path.join(dist, 'js', 'build.js'), `export const BUILD = '${build}';\n`);
writeFileSync(path.join(dist, 'build.json'), JSON.stringify({ build }) + '\n');
writeFileSync(
  path.join(dist, 'js', 'deploy.js'),
  `export const LOBBY = ${JSON.stringify(LOBBY)};\nexport const FFMPEG = ${JSON.stringify(FFMPEG)};\n`
);
writeFileSync(path.join(dist, '_headers'), '/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n');
writeFileSync(path.join(dist, '404.html'), '<!doctype html><meta charset="utf-8"><title>Not found</title><p>Not found.</p>\n');

esbuild(['dist/js/**/*.js', '--format=esm', '--outdir=dist/js', '--outbase=dist/js']);
esbuild(['dist/vendor/three/**/*.js', 'dist/test/**/*.js', '--keep-names', '--outdir=dist', '--outbase=dist']);
esbuild(['dist/vendor/fengari/**/*.js', '--outdir=dist', '--outbase=dist']);
esbuild(['dist/sw.js', '--format=iife', '--outfile=dist/sw.js']);
esbuild(['dist/style.css', '--outfile=dist/style.css']);
run('node', [
  'tools/minify-html.mjs',
  ...readdirSync(dist)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join('dist', f))
]);

console.log(`built dist/ (${build})`);
