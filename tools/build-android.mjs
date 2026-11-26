// Builds the Android app (an APK for 64-bit ARM phones and tablets).
//   node tools/build-android.mjs              release APK (unsigned)
//   node tools/build-android.mjs --debug      debug APK, installable for testing
//   node tools/build-android.mjs --emulator   for the x86-64 Android emulator instead of phones
// Needs JAVA_HOME (JDK 17), ANDROID_HOME and NDK_HOME set. tauri android build links the Rust
// library into the Gradle project with a symbolic link, which Windows only allows in Developer
// Mode, so the library is built and copied in here and Gradle runs without its own Rust step.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LIBRARY = 'libempire_at_war_browser_edition_lib.so';
// each processor kind: tauri's name for it, Rust's target, Android's ABI folder and the Gradle flavour
const PROCESSORS = {
  arm64: { tauri: 'aarch64', rust: 'aarch64-linux-android', abi: 'arm64-v8a', flavour: 'Arm64', apkFolder: 'arm64' },
  x86_64: { tauri: 'x86_64', rust: 'x86_64-linux-android', abi: 'x86_64', flavour: 'X86_64', apkFolder: 'x86_64' }
};

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = path.join(web, 'src-tauri');
const androidDir = path.join(tauriDir, 'gen', 'android');
const debug = process.argv.includes('--debug');
const processor = PROCESSORS[process.argv.includes('--emulator') ? 'x86_64' : 'arm64'];
const profile = debug ? 'debug' : 'release';
const variant = processor.flavour + (debug ? 'Debug' : 'Release');
const windows = process.platform === 'win32';

const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { cwd: web, stdio: 'inherit', shell: windows, ...options });
const fail = message => {
  console.error(message);
  process.exit(1);
};

for (const name of ['JAVA_HOME', 'ANDROID_HOME', 'NDK_HOME']) if (!process.env[name]) fail(`${name} is not set`);

run('node', ['tools/build-app.mjs', '--stage']);

// the library build itself succeeds; only its link into the Gradle project can fail on Windows
try {
  run('npx', ['tauri', 'android', 'build', '--apk', '--target', processor.tauri, ...(debug ? ['--debug'] : [])]);
} catch {
  console.log('tauri could not link the library into the Android project: copying it in');
}

const targetDir = JSON.parse(
  execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], { cwd: tauriDir, encoding: 'utf8', shell: windows })
).target_directory;
const built = path.join(targetDir, processor.rust, profile, LIBRARY);
const jniLibs = path.join(androidDir, 'app', 'src', 'main', 'jniLibs', processor.abi);
mkdirSync(jniLibs, { recursive: true });
copyFileSync(built, path.join(jniLibs, LIBRARY));

run(JSON.stringify(path.join(androidDir, windows ? 'gradlew.bat' : 'gradlew')), [`assemble${variant}`, '-x', `rustBuild${variant}`], { cwd: androidDir });

const apkFolder = path.join(androidDir, 'app', 'build', 'outputs', 'apk', processor.apkFolder, profile);
for (const name of readdirSync(apkFolder).filter(name => name.endsWith('.apk'))) console.log(path.join(apkFolder, name));
