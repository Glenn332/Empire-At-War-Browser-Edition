import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = process.env.GITHUB_REPOSITORY || 'Glenn332/Empire-At-War-Browser-Edition';
const ASSET = 'EmpireAtWarBrowserEdition-setup.exe';

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
  writeFileSync(lockFile, readFileSync(lockFile, 'utf8').replace(/(name = "sw-revival"\r?\nversion = )"[^"]*"/, `$1"${version}"`));
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
  if (!git('tag', '-l', name)) git('tag', '-a', name, '-m', `Release ${version}\n\n${release.notes}`);
  git('push', 'origin', 'refs/tags/' + name);
  console.log(`app ${version} is building: https://github.com/${REPO}/actions/workflows/release.yml`);
}

function build() {
  const { version, productName } = conf();
  if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== tagOf(version))
    fail(`tag ${process.env.GITHUB_REF_NAME} does not match the app version ${version}`);
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) fail('TAURI_SIGNING_PRIVATE_KEY is not set: add it as a repository secret');
  run('node', ['tools/build-app.mjs'], {
    stdio: 'inherit',
    encoding: undefined,
    env: { TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '', ...process.env }
  });

  const built = path.join(web, 'src-tauri', 'target', 'release', 'bundle', 'nsis', `${productName}_${version}_x64-setup.exe`);
  const release = notesOf(version);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  copyFileSync(built, path.join(out, ASSET));
  const feed = {
    version,
    notes: release ? release.notes : '',
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature: readFileSync(built + '.sig', 'utf8').trim(),
        url: `https://github.com/${REPO}/releases/download/${tagOf(version)}/${ASSET}`
      }
    }
  };
  writeFileSync(path.join(out, 'latest.json'), JSON.stringify(feed, null, 2) + '\n');
  console.log(`release ${version} in dist-release/`);
}

function publish() {
  const { version } = conf(),
    name = tagOf(version);
  const feed = JSON.parse(readFileSync(path.join(out, 'latest.json'), 'utf8'));
  if (feed.version !== version) fail(`dist-release/ holds no release ${version}`);
  const gh = (...args) => run('gh', [...args, '--repo', REPO], { stdio: 'inherit', encoding: undefined });
  const files = [path.join(out, ASSET), path.join(out, 'latest.json')];

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
