import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LOBBY = 'https://lobby.playeaw.com';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(web, 'public'),
  dist = path.join(web, 'dist-app');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: web, encoding: 'utf8', shell: process.platform === 'win32', ...opts });

const commit = run('git', ['rev-parse', '--short', 'HEAD']).trim();
const build = commit + (run('git', ['status', '--porcelain', '--', 'public']).trim() ? '-dirty' : '');

const skip = new Set(['sw.js', 'test', 'game.tar.gz', 'game.tar']);
rmSync(dist, { recursive: true, force: true });
cpSync(pub, dist, { recursive: true, filter: src => !skip.has(path.relative(pub, src)) });
writeFileSync(path.join(dist, 'js', 'build.js'), `export const BUILD = '${build}';\n`);
writeFileSync(
  path.join(dist, 'js', 'deploy.js'),
  `export const LOBBY = ${JSON.stringify(LOBBY)};\nexport const SITE = 'https://playeaw.com';\nexport const FFMPEG = new URL('../vendor/ffmpeg/ffmpeg-core.js', import.meta.url).href;\n`
);
console.log(`staged dist-app/ (${build})`);

// arguments after -- go to tauri build (the release build passes the macOS universal target)
const separator = process.argv.indexOf('--'),
  tauriArgs = separator >= 0 ? process.argv.slice(separator + 1) : [];
if (!process.argv.includes('--stage')) {
  const env = { ...process.env };
  if (process.platform === 'linux') {
    // linuxdeploy otherwise picks Fedora's 32-bit /usr/lib on a multilib build host.
    const elfClass = process.arch === 'ia32' ? 1 : 2;
    const matchesArchitecture = file => existsSync(file) && readFileSync(file)[4] === elfClass;
    const libdir =
      process.env.GSTREAMER_PLUGINS_DIR ||
      [
        `/usr/lib/${process.arch === 'x64' ? 'x86_64' : process.arch}-linux-gnu/gstreamer-1.0`,
        '/usr/lib64/gstreamer-1.0',
        '/usr/lib/gstreamer-1.0'
      ].find(dir => matchesArchitecture(path.join(dir, 'libgstcoreelements.so')));
    const helpers =
      process.env.GSTREAMER_HELPERS_DIR ||
      [
        `/usr/lib/${process.arch === 'x64' ? 'x86_64' : process.arch}-linux-gnu/gstreamer1.0/gstreamer-1.0`,
        '/usr/libexec/gstreamer-1.0'
      ].find(dir => matchesArchitecture(path.join(dir, 'gst-plugin-scanner')));
    if (!libdir || !['libgstapp.so', 'libgstautodetect.so'].every(plugin => matchesArchitecture(path.join(libdir, plugin))))
      throw new Error('GStreamer plugins matching the app architecture (including libgstapp.so and libgstautodetect.so) are required');
    if (!helpers) throw new Error('A GStreamer plugin scanner matching the app architecture is required');
    env.GSTREAMER_PLUGINS_DIR = libdir;
    env.GSTREAMER_HELPERS_DIR = helpers;
  }
  run('npx', ['tauri', 'build', ...tauriArgs], { stdio: 'inherit', encoding: undefined, env });
}
