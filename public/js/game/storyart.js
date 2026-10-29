import { parseXML } from '../xml.js';
import { fetchText, findFiles } from '../vfs.js';
import { db } from '../gamedata.js';

const xmlPath = s => /^DATA\//i.test(String(s).replace(/\\/g, '/')) ? String(s).replace(/\\/g, '/') : 'Data/XML/' + String(s).replace(/\\/g, '/');
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function storyTypes(names) {
  const texts = [], seenPlots = new Set(), scripts = new Set();
  const read = async name => {
    const k = String(name || '').toUpperCase();
    if (!k || seenPlots.has(k)) return;
    seenPlots.add(k);
    const src = await fetchText(xmlPath(name)).catch(() => null);
    if (!src) return;
    texts.push(src);
    const children = [];
    for (const root of parseXML(src).children) for (const node of root.children) {
      if (/^Lua_Script$/i.test(node.tag) && node.text.trim()) scripts.add(node.text.trim());
      else if (/^Active_Plot$/i.test(node.tag)) children.push(node.text.trim());
    }
    await Promise.all(children.map(read));
  };
  await Promise.all(names.map(read));
  await Promise.all([...scripts].map(async s => {
    const file = (await findFiles(`SCRIPTS\\\\(.*\\\\)?${esc(s.toUpperCase())}\\.LUA$`).catch(() => []))[0];
    const text = file && await fetchText(file.replace(/\\/g, '/')).catch(() => null);
    if (text) texts.push(text);
  }));
  const out = new Set();
  for (const text of texts) for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const t = db.type(m[0]);
    if (t && (t.str('Space_Model_Name') || t.list('Squadron_Units').length || t.list('Company_Units').length)) out.add(t);
  }
  return out;
}
