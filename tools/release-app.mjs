import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = process.env.GITHUB_REPOSITORY || 'Glenn332/Empire-At-War-Browser-Edition';
const ASSET = 'EmpireAtWarBrowserEdition-setup.exe';
// each system's build: what it bundles, the release files made from the bundles, and the updater
// platforms each signed file serves (a universal macOS app serves both processor kinds)
const MAC_TARGET = 'universal-apple-darwin';
const BUILDS = {
  win32: {
    name: 'windows',
    bundleDir: path.join('target', 'release', 'bundle'),
    tauriArgs: [],
    files: [{ kind: 'nsis', ending: '-setup.exe', asset: ASSET, updater: ['windows-x86_64'] }]
  },
  darwin: {
    name: 'macos',
    bundleDir: path.join('target', MAC_TARGET, 'release', 'bundle'),
    tauriArgs: ['--target', MAC_TARGET],
    files: [
      { kind: 'dmg', ending: '.dmg', asset: 'EmpireAtWarBrowserEdition-macos.dmg' },
      {
        kind: 'macos',
        ending: '.app.tar.gz',
        asset: 'EmpireAtWarBrowserEdition-macos.app.tar.gz',
        updater: ['darwin-aarch64', 'darwin-x86_64']
      }
    ]
  },
  linux: {
    name: 'linux',
    bundleDir: path.join('target', 'release', 'bundle'),
    tauriArgs: [],
    files: [
      {
        kind: 'appimage',
        ending: '.AppImage',
        asset: 'EmpireAtWarBrowserEdition-linux-x86_64.AppImage',
        updater: ['linux-x86_64', 'linux-x86_64-appimage']
      },
      { kind: 'deb', ending: '.deb', asset: 'EmpireAtWarBrowserEdition-linux-amd64.deb', updater: ['linux-x86_64-deb'] }
    ]
  }
};
const FEED_PART = /^feed-.+\.json$/;

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(web, 'dist-release');
const confFile = path.join(web, 'src-tauri', 'tauri.conf.json'),
  cargoFile = path.join(web, 'src-tauri', 'Cargo.toml'),
  lockFile = path.join(web, 'src-tauri', 'Cargo.lock');

const [command, ...rest] = process.argv.slice(2);
const arg = name => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : null;
};
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: web, encoding: 'utf8', ...opts });
const git = (...args) => run('git', args).trim();
const fail = message => {
  console.error(message);
  process.exit(1);
};

const conf = () => JSON.parse(readFileSync(confFile, 'utf8'));
const tagOf = version => 'v' + version;
const newer = (a, b) => {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
const notesOf = version => {
  const hit = git('log', '-1', '--format=%H', `--grep=^Release ${version.replace(/\./g, '\\.')}$`);
  return hit ? { commit: hit, notes: git('log', '-1', '--format=%b', hit) } : null;
};
const onGitHub = tag => !!git('ls-remote', '--tags', 'origin', 'refs/tags/' + tag);

function bump() {
  const version = rest.find(a => /^\d+\.\d+\.\d+$/.test(a)),
    notes = arg('--notes');
  if (!version || !notes) fail('usage: npm run app:bump -- <major.minor.patch> --notes "what changed"');
  const current = conf().version;
  if (!newer(version, current)) fail(`${version} is not newer than the current app version ${current}`);
  if (onGitHub(tagOf(version))) fail(`${tagOf(version)} is already on GitHub`);

  const text = readFileSync(confFile, 'utf8');
  writeFileSync(confFile, text.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`));
  writeFileSync(cargoFile, readFileSync(cargoFile, 'utf8').replace(/^version = "[^"]*"/m, `version = "${version}"`));
  writeFileSync(
    lockFile,
    readFileSync(lockFile, 'utf8').replace(/(name = "empire-at-war-browser-edition"\r?\nversion = )"[^"]*"/, `$1"${version}"`)
  );
  git('commit', '-m', `Release ${version}`, '-m', notes, '--', confFile, cargoFile, lockFile);
  console.log(`app ${version} is ready: npm run deploy:prod builds and publishes it`);
}

function tag() {
  const { version } = conf(),
    name = tagOf(version);
  if (onGitHub(name)) return console.log(`app ${version} is already released; npm run app:bump -- <version> --notes "..." ships a new one`);
  const release = notesOf(version);
  if (!release)
    return console.log(`app ${version} has no Release ${version} commit; npm run app:bump -- <version> --notes "..." ships a new one`);
  if (git('status', '--porcelain', '--', 'public', 'src-tauri', 'tools', 'package.json', 'package-lock.json'))
    fail(
      `app ${version} not released: commit or stash the changes in public/, src-tauri/ or tools/ first, so the release matches a commit`
    );
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main')
    fail(`app ${version} not released: switch to main first, releases are tagged on main`);
  git('tag', '-f', '-a', name, '-m', `Release ${version}\n\n${release.notes}`);
  git('push', '--atomic', 'origin', 'refs/heads/main', 'refs/tags/' + name);
  console.log(`app ${version} is building: https://github.com/${REPO}/actions/workflows/release.yml`);
}

// the one bundle of a kind this version built, whatever name the bundler gave it (the macOS
// updater archive is the only one named without the version)
function bundled(bundleRoot, kind, ending, version) {
  const folder = path.join(bundleRoot, kind);
  const matching = existsSync(folder) ? readdirSync(folder).filter(name => name.endsWith(ending)) : [];
  const ofThisVersion = matching.filter(name => name.includes(version));
  const names = ofThisVersion.length ? ofThisVersion : matching;
  if (names.length !== 1) fail(`expected one ${ending} for ${version} in ${folder}, found ${names.length ? names.join(', ') : 'none'}`);
  return path.join(folder, names[0]);
}

// builds this system's app into dist-release/: its release files and feed-<system>.json, the
// part of the updater feed it signs; publish merges the parts of every system into latest.json
function build() {
  const { version } = conf();
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== tagOf(version))
    fail(`tag ${process.env.GITHUB_REF_NAME} does not match the app version ${version}`);
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) fail('TAURI_SIGNING_PRIVATE_KEY is not set: add it as a repository secret');
  const system = BUILDS[process.platform];
  if (!system) fail(`no app build for ${process.platform}`);
  run('node', ['tools/build-app.mjs', '--', ...system.tauriArgs], {
    stdio: 'inherit',
    encoding: undefined,
    env: { TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '', ...process.env }
  });

  const bundleRoot = path.join(web, 'src-tauri', system.bundleDir);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const platforms = {};
  for (const file of system.files) {
    const built = bundled(bundleRoot, file.kind, file.ending, version);
    copyFileSync(built, path.join(out, file.asset));
    if (!file.updater) continue;
    const signatureFile = built + '.sig';
    // a bundle the updater cannot install (no updater signature was made for it) stays a plain download
    if (!existsSync(signatureFile)) {
      console.log(`${path.basename(built)} has no updater signature: shipped as a download only`);
      continue;
    }
    const signature = readFileSync(signatureFile, 'utf8').trim();
    for (const platform of file.updater)
      platforms[platform] = { signature, url: `https://github.com/${REPO}/releases/download/${tagOf(version)}/${file.asset}` };
  }
  writeFileSync(path.join(out, `feed-${system.name}.json`), JSON.stringify({ version, platforms }, null, 2) + '\n');
  console.log(`${system.name} release ${version} in dist-release/`);
}

// latest.json from the feed parts the system builds left in dist-release/
function mergeFeed(version) {
  const parts = readdirSync(out).filter(name => FEED_PART.test(name));
  if (!parts.includes('feed-windows.json')) fail(`dist-release/ holds no Windows build of ${version}`);
  const platforms = {};
  for (const name of parts) {
    const part = JSON.parse(readFileSync(path.join(out, name), 'utf8'));
    if (part.version !== version) fail(`dist-release/${name} is for ${part.version}, not ${version}`);
    Object.assign(platforms, part.platforms);
  }
  const release = notesOf(version);
  const feed = { version, notes: release ? release.notes : '', pub_date: new Date().toISOString(), platforms };
  writeFileSync(path.join(out, 'latest.json'), JSON.stringify(feed, null, 2) + '\n');
  console.log(`latest.json serves ${Object.keys(platforms).join(', ')}`);
  return feed;
}

function publish() {
  const { version } = conf(),
    name = tagOf(version);
  const feed = mergeFeed(version);
  const gh = (...args) => run('gh', [...args, '--repo', REPO], { stdio: 'inherit', encoding: undefined });
  const assets = Object.values(BUILDS)
    .flatMap(system => system.files.map(file => file.asset))
    .filter(asset => existsSync(path.join(out, asset)));
  const files = [...assets, 'latest.json'].map(name => path.join(out, name));

  let existing = null;
  try {
    existing = JSON.parse(
      run('gh', ['release', 'view', name, '--json', 'isDraft', '--repo', REPO], { stdio: ['ignore', 'pipe', 'ignore'] })
    );
  } catch {}
  if (existing && !existing.isDraft) fail(`${name} is already published`);
  if (existing) gh('release', 'upload', name, ...files, '--clobber');
  else {
    const notesFile = path.join(out, 'notes.md');
    writeFileSync(notesFile, feed.notes || `Version ${version}.`);
    gh(
      'release',
      'create',
      name,
      ...files,
      '--draft',
      '--verify-tag',
      '--title',
      `Empire at War Browser Edition ${version}`,
      '--notes-file',
      notesFile
    );
  }
  gh('release', 'edit', name, '--draft=false', '--latest');
  console.log(`published https://github.com/${REPO}/releases/tag/${name}`);
}

const commands = { bump, tag, build, publish };
if (!commands[command]) fail('usage: node tools/release-app.mjs bump|tag|build|publish');
commands[command]();
