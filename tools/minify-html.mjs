import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const esbuild = (code, args) =>
  execFileSync('npx', ['--yes', 'esbuild@0.25.10', '--minify', '--log-level=error', ...args], {
    input: code,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  }).trim();

function minifyBlock(tag, attrs, body) {
  if (!body.trim()) return body;
  if (tag === 'style') return esbuild(body, ['--loader=css']);
  const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
  if (type === 'importmap' || type?.endsWith('json')) return JSON.stringify(JSON.parse(body));
  if (type === 'module') return esbuild(body, ['--loader=js', '--format=esm']);
  if (!type || type.endsWith('javascript')) return esbuild(body, ['--loader=js']);
  return body;
}

for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, 'utf8');
  let out = '',
    at = 0;
  const blocks = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  const stripComments = html => html.replace(/<!--[\s\S]*?-->/g, '');
  for (let m; (m = blocks.exec(src)); ) {
    out += stripComments(src.slice(at, m.index));
    out += `<${m[1]}${m[2]}>${minifyBlock(m[1].toLowerCase(), m[2], m[3])}</${m[1]}>`;
    at = blocks.lastIndex;
  }
  out += stripComments(src.slice(at));
  out = out.replace(/\n[ \t]*(?=\n)/g, '').replace(/\n{2,}/g, '\n');
  writeFileSync(file, out);
}
