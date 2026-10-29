import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'node_modules', 'three');
const dst = path.join(here, '..', 'public', 'vendor', 'three');
for (const f of ['build/three.module.js', 'examples/jsm/controls/OrbitControls.js', 'LICENSE']) {
  fs.mkdirSync(path.dirname(path.join(dst, f)), { recursive: true });
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
  console.log('vendored', f);
}

{
  const from=path.join(here,'..','node_modules','@ffmpeg','core','dist','esm'),to=path.join(here,'..','public','vendor','ffmpeg');
  fs.mkdirSync(to,{recursive:true});
  for(const name of ['ffmpeg-core.js','ffmpeg-core.wasm'])fs.copyFileSync(path.join(from,name),path.join(to,name));
  console.log('vendored @ffmpeg/core 0.12.10');
}

{
  const from = path.join(here, '..', 'node_modules', 'fengari-web'), to = path.join(here, '..', 'public', 'vendor', 'fengari');
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(path.join(from, 'dist', 'fengari-web.js'), path.join(to, 'fengari-web.js'));
  fs.copyFileSync(path.join(from, 'LICENSE'), path.join(to, 'LICENSE'));
  console.log('vendored fengari-web.js');
}
