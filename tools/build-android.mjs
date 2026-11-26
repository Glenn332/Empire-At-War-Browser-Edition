// Builds the Android app (an APK for 64-bit ARM phones and tablets).
//   node tools/build-android.mjs                release APK (unsigned)
//   node tools/build-android.mjs --debug        debug APK, installable for testing
//   node tools/build-android.mjs --emulator     for the x86-64 Android emulator instead of phones
//   node tools/build-android.mjs --tester       release APK signed with the SDK's debug key, to share
//                                               with testers (not for a store: updates need one key)
//   node tools/build-android.mjs --release-key  release APK signed with the app's own release key:
//                                               ANDROID_KEYSTORE (the keystore file),
//                                               ANDROID_KEYSTORE_PASSWORD and ANDROID_KEY_ALIAS
// Needs JAVA_HOME (JDK 17), ANDROID_HOME and NDK_HOME set. tauri android build links the Rust
// library into the Gradle project with a symbolic link, which Windows only allows in Developer
// Mode, so on Windows the library is copied in here and Gradle runs without its own Rust step.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LIBRARY = 'libempire_at_war_browser_edition_lib.so';
// each processor kind: tauri's name for it, Rust's target, Android's ABI folder and the Gradle flavour
const PROCESSORS = {
  arm64: { tauri: 'aarch64', rust: 'aarch64-linux-android', abi: 'arm64-v8a', flavour: 'Arm64', apkFolder: 'arm64' },
  x86_64: { tauri: 'x86_64', rust: 'x86_64-linux-android', abi: 'x86_64', flavour: 'X86_64', apkFolder: 'x86_64' }
};
// the file name each kind of signed APK gets, next to Gradle's unsigned one
export const SIGNED_ENDINGS = { tester: '-tester.apk', release: '-signed.apk' };

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = path.join(web, 'src-tauri');
const androidDir = path.join(tauriDir, 'gen', 'android');
const windows = process.platform === 'win32';

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: web, stdio: 'inherit', shell: windows, ...options });
// Windows runs these through its shell, which needs paths with spaces quoted; elsewhere the
// arguments go to the program as they are
const quoted = value => (windows ? JSON.stringify(value) : value);
const fail = message => {
  console.error(message);
  process.exit(1);
};

/** Builds the APK and returns its path: the signed one when a signing option is given. */
export function buildAndroid({ debug = false, emulator = false, signing = null } = {}) {
  for (const name of ['JAVA_HOME', 'ANDROID_HOME', 'NDK_HOME']) if (!process.env[name]) fail(`${name} is not set`);
  const processor = PROCESSORS[emulator ? 'x86_64' : 'arm64'];
  const profile = debug ? 'debug' : 'release';
  const variant = processor.flavour + (debug ? 'Debug' : 'Release');

  run('node', ['tools/build-app.mjs', '--stage']);
  // the library build itself succeeds; only its link into the Gradle project can fail on Windows
  try {
    run('npx', ['tauri', 'android', 'build', '--apk', '--target', processor.tauri, ...(debug ? ['--debug'] : [])]);
  } catch {
    console.log('tauri could not link the library into the Android project: copying it in');
  }
  copyLibraryIn(processor, profile);
  run(quoted(path.join(androidDir, windows ? 'gradlew.bat' : 'gradlew')), [`assemble${variant}`, '-x', `rustBuild${variant}`], {
    cwd: androidDir
  });

  const apkFolder = path.join(androidDir, 'app', 'build', 'outputs', 'apk', processor.apkFolder, profile);
  const apks = readdirSync(apkFolder).filter(name => name.endsWith('.apk'));
  if (debug || !signing) return path.join(apkFolder, apks[0]);
  return sign(apkFolder, signing === 'tester' ? debugKey() : releaseKey(), SIGNED_ENDINGS[signing]);
}

// where tauri made its link the library is already in place; elsewhere it is copied over
function copyLibraryIn(processor, profile) {
  const targetDir = JSON.parse(
    execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], { cwd: tauriDir, encoding: 'utf8', shell: windows })
  ).target_directory;
  const built = path.join(targetDir, processor.rust, profile, LIBRARY);
  const jniLibs = path.join(androidDir, 'app', 'src', 'main', 'jniLibs', processor.abi);
  const placed = path.join(jniLibs, LIBRARY);
  mkdirSync(jniLibs, { recursive: true });
  if (existsSync(placed) && lstatSync(placed).isSymbolicLink()) rmSync(placed);
  copyFileSync(built, placed);
}

// the SDK's own debug keystore, with its fixed, published passwords
function debugKey() {
  const keystore = [process.env.ANDROID_USER_HOME, path.join(os.homedir(), '.android')]
    .filter(Boolean)
    .map(folder => path.join(folder, 'debug.keystore'))
    .find(existsSync);
  if (!keystore) fail('no debug.keystore found: build a --debug APK once, which makes it');
  return { keystore, alias: 'androiddebugkey', passwordArgument: 'pass:android' };
}

// the app's release key; apksigner reads its password from the environment, never the command line
function releaseKey() {
  const keystore = process.env.ANDROID_KEYSTORE;
  if (!keystore || !existsSync(keystore)) fail('ANDROID_KEYSTORE does not name the release keystore file');
  if (!process.env.ANDROID_KEYSTORE_PASSWORD) fail('ANDROID_KEYSTORE_PASSWORD is not set');
  return { keystore, alias: process.env.ANDROID_KEY_ALIAS || 'playeaw', passwordArgument: 'env:ANDROID_KEYSTORE_PASSWORD' };
}

// the release APK comes out unsigned; Android installs it only once it is aligned and signed
function sign(folder, key, ending) {
  const unsigned = readdirSync(folder).find(name => name.endsWith('-unsigned.apk'));
  if (!unsigned) fail(`no unsigned release APK in ${folder}`);
  const buildTools = path.join(process.env.ANDROID_HOME, 'build-tools');
  const newest = readdirSync(buildTools)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1);
  const tool = name => quoted(path.join(buildTools, newest, windows && name === 'apksigner' ? 'apksigner.bat' : name));
  const aligned = path.join(folder, unsigned.replace('-unsigned.apk', '-aligned.apk'));
  const signed = path.join(folder, unsigned.replace('-unsigned.apk', ending));
  run(tool('zipalign'), ['-p', '-f', '4', quoted(path.join(folder, unsigned)), quoted(aligned)]);
  run(tool('apksigner'), [
    'sign',
    '--ks', quoted(key.keystore),
    '--ks-key-alias', key.alias,
    '--ks-pass', key.passwordArgument,
    '--key-pass', key.passwordArgument,
    '--out', quoted(signed),
    quoted(aligned)
  ]);
  run(tool('apksigner'), ['verify', quoted(signed)]);
  return signed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = name => process.argv.includes(name);
  const signing = argument('--release-key') ? 'release' : argument('--tester') ? 'tester' : null;
  console.log(buildAndroid({ debug: argument('--debug'), emulator: argument('--emulator'), signing }));
}
