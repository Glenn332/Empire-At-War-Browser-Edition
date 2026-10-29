import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const BUCKET = 'playeaw-downloads';
const HOST = 'https://downloads.playeaw.com';
const KEY = path.join(os.homedir(), '.tauri', 'swr-updater.key');

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [version] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const arg = name => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const notes = arg('--notes') || '',
  upload = process.argv.includes('--upload');
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('usage: node tools/release-app.mjs <major.minor.patch> [--notes "..."] [--upload]');
  process.exit(1);
}
try {
  statSync(KEY);
} catch {
  console.error('no release key at ' + KEY + ' (tauri signer generate)');
  process.exit(1);
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: web, stdio: 'inherit', shell: process.platform === 'win32', ...opts });

const confFile = path.join(web, 'src-tauri', 'tauri.conf.json'),
  conf = JSON.parse(readFileSync(confFile, 'utf8'));
conf.version = version;
writeFileSync(confFile, JSON.stringify(conf, null, 2) + '\n');
const cargoFile = path.join(web, 'src-tauri', 'Cargo.toml');
writeFileSync(cargoFile, readFileSync(cargoFile, 'utf8').replace(/^version = "[^"]*"/m, `version = "${version}"`));

const name = `EmpireAtWarBrowserEdition_${version}_x64-setup.exe`;
const out = path.join(web, 'dist-release'),
  dir = path.join(out, 'v' + version);
if (!process.argv.includes('--no-build')) {
  run('node', ['tools/build-app.mjs'], { env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' } });
  const built = path.join(web, 'src-tauri', 'target', 'release', 'bundle', 'nsis', `${conf.productName}_${version}_x64-setup.exe`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  copyFileSync(built, path.join(dir, name));
  copyFileSync(built, path.join(out, 'EmpireAtWarBrowserEdition-setup.exe'));
  const signature = readFileSync(built + '.sig', 'utf8').trim();
  const feed = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    size: statSync(built).size,
    download: `${HOST}/EmpireAtWarBrowserEdition-setup.exe`,
    platforms: { 'windows-x86_64': { signature, url: `${HOST}/v${version}/${name}` } }
  };
  writeFileSync(path.join(out, 'latest.json'), JSON.stringify(feed, null, 2) + '\n');
  console.log(`release ${version} in dist-release/ (${(feed.size / 1048576).toFixed(1)} MB)`);
} else if (JSON.parse(readFileSync(path.join(out, 'latest.json'), 'utf8')).version !== version) {
  console.error(`dist-release/ holds no release ${version}`);
  process.exit(1);
}

if (upload) {
  const put = (key, file, type, cache) =>
    run('npx', [
      '--yes',
      'wrangler@4.151.2',
      'r2',
      'object',
      'put',
      `${BUCKET}/${key}`,
      '--file',
      file,
      '--content-type',
      type,
      '--cache-control',
      cache,
      '--remote'
    ]);
  put(`v${version}/${name}`, path.join(dir, name), 'application/vnd.microsoft.portable-executable', 'public,max-age=31536000,immutable');
  put(
    'EmpireAtWarBrowserEdition-setup.exe',
    path.join(out, 'EmpireAtWarBrowserEdition-setup.exe'),
    'application/vnd.microsoft.portable-executable',
    'public,max-age=300'
  );
  put('latest.json', path.join(out, 'latest.json'), 'application/json', 'no-cache');
  console.log(`uploaded: ${HOST}/latest.json`);
}
