import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const js = path.join(root, 'js');
const rel = f => path.relative(root, f).replaceAll('\\', '/');

const importMap = (() => {
  const html = fs.readFileSync(path.join(root, 'play.html'), 'utf8'),
    m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(m, 'play.html has an import map');
  return JSON.parse(m[1]).imports;
})();

const sources = new Map();
const read = f => {
  if (!sources.has(f)) sources.set(f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
  return sources.get(f);
};

const names = list =>
  list
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const [a, b] = s.split(/\s+as\s+/);
      return { name: a.trim(), local: (b || a).trim() };
    });

const parse = src => {
  const statics = [],
    dynamics = [];
  for (const m of src.matchAll(/(?:^|[;}\n])\s*import\s+([\w$\s{},*]+?)\s+from\s*['"]([^'"]+)['"]/g)) {
    const clause = m[1].trim(),
      named = clause.match(/\{([^}]*)\}/);
    statics.push({ spec: m[2], wants: named ? names(named[1]).map(n => n.name) : [], def: /^[\w$]+\s*(,|$)/.test(clause) });
  }
  for (const m of src.matchAll(/(?:^|[;}\n])\s*import\s*['"]([^'"]+)['"]/g)) statics.push({ spec: m[1], wants: [] });
  for (const m of src.matchAll(/(?:^|[;}\n])\s*export\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g))
    statics.push({ spec: m[1], wants: [] });
  for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) dynamics.push(m[1]);
  return { statics, dynamics };
};

const exportCache = new Map();
const exportsOf = (file, seen = new Set()) => {
  if (exportCache.has(file)) return exportCache.get(file);
  if (seen.has(file)) return new Set();
  seen.add(file);
  const src = read(file) || '',
    out = new Set();
  for (const m of src.matchAll(/(?:^|\n)\s*export\s+(?:async\s+)?function\s*\*?\s*([\w$]+)/g)) out.add(m[1]);
  for (const m of src.matchAll(/(?:^|\n)\s*export\s+class\s+([\w$]+)/g)) out.add(m[1]);
  for (const m of src.matchAll(/(?:^|\n)\s*export\s+(?:const|let|var)\s+([\s\S]*?)(?:;|\n\s*\n|\n(?=\S))/g)) {
    let depth = 0,
      top = '';
    for (const ch of m[1]) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      else if (!depth) top += ch;
    }
    for (const d of top.split(',')) {
      const id = d.trim().match(/^([\w$]+)/);
      if (id) out.add(id[1]);
    }
    const destructure = m[1].match(/^\s*[{[]([^=]*)[}\]]\s*=/);
    if (destructure) for (const n of names(destructure[1])) out.add(n.local.replace(/[:=].*$/, '').trim());
  }
  for (const m of src.matchAll(/(?:^|\n)\s*export\s*\{([^}]*)\}/g)) for (const n of names(m[1])) out.add(n.local);
  if (/(?:^|\n)\s*export\s+default\b/.test(src)) out.add('default');
  for (const m of src.matchAll(/(?:^|\n)\s*export\s+\*\s+from\s*['"]([^'"]+)['"]/g)) {
    const t = resolve(file, m[1]);
    if (t) for (const n of exportsOf(t, seen)) if (n !== 'default') out.add(n);
  }
  exportCache.set(file, out);
  return out;
};

const resolve = (from, spec, mapped = null) => {
  if (spec.startsWith('.') || spec.startsWith('/'))
    return path.resolve(spec.startsWith('/') ? root : path.dirname(from), spec.replace(/^\//, ''));
  if (!mapped) return null;
  if (mapped[spec]) return path.resolve(root, mapped[spec]);
  const prefix = Object.keys(mapped).find(k => k.endsWith('/') && spec.startsWith(k));
  return prefix ? path.resolve(root, mapped[prefix] + spec.slice(prefix.length)) : null;
};

const walk = (entry, mapped, label) => {
  const problems = [],
    seen = new Set(),
    queue = [[entry, null]];
  while (queue.length) {
    const [file, parent] = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const src = read(file);
    if (src === null) {
      problems.push(`${label}: missing ${rel(file)} (imported by ${parent ? rel(parent) : 'entry'})`);
      continue;
    }
    if (file.includes(`${path.sep}vendor${path.sep}`)) continue;
    const { statics, dynamics } = parse(src);
    for (const s of statics) {
      const t = resolve(file, s.spec, mapped);
      if (!t) {
        problems.push(
          `${label}: ${rel(file)} imports '${s.spec}', which ${mapped ? 'the import map does not cover' : 'a worker cannot resolve (workers have no import map)'}`
        );
        continue;
      }
      if (read(t) !== null && !t.includes(`${path.sep}vendor${path.sep}`)) {
        const has = exportsOf(t);
        for (const n of s.wants)
          if (!has.has(n)) problems.push(`${label}: ${rel(file)} imports { ${n} } from ${rel(t)}, which does not export it`);
        if (s.def && !has.has('default')) problems.push(`${label}: ${rel(file)} imports a default from ${rel(t)}, which has none`);
      }
      queue.push([t, file]);
    }
    for (const spec of dynamics) {
      if (!spec.startsWith('.')) continue;
      const t = resolve(file, spec);
      if (read(t) === null) problems.push(`${label}: ${rel(file)} lazily imports missing ${rel(t)}`);
    }
  }
  return { problems, files: seen.size };
};

const workers = new Map();
const scan = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) scan(f);
    else if (e.name.endsWith('.js'))
      for (const m of read(f).matchAll(
        /new\s+(?:Shared)?Worker\(\s*new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)\s*,\s*\{[^}]*type:\s*['"]module['"]/g
      ))
        workers.set(path.resolve(path.dirname(f), m[1]), f);
  }
};
scan(js);

const required = ['spacebattleworker.js', 'jobworker.js', 'pathworker.js', 'collectworker.js', 'renderworker.js', 'particleworker.js'];
for (const name of required)
  assert.ok(
    [...workers.keys()].some(f => path.basename(f) === name),
    `${name} is still started as a module worker (update this test if it was renamed)`
  );

const problems = [];
const page = walk(path.join(js, 'main.js'), importMap, 'page');
problems.push(...page.problems);
const pageFiles = new Set(sources.keys());
for (const name of ['game/landgame.js', 'game/sim.js', 'game/spacemirror.js'])
  assert.ok(pageFiles.has(path.join(js, name)), `the page graph reaches js/${name} (space and land battles)`);

let workerFiles = 0;
for (const [entry, owner] of workers) {
  const r = walk(entry, null, `worker ${rel(entry)} (started by ${rel(owner)})`);
  problems.push(...r.problems);
  workerFiles += r.files;
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`module graph ok: page ${page.files} modules, ${workers.size} module workers (${workerFiles} modules)`);
