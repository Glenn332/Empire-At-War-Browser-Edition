export class XNode {
  constructor(tag, attrs) {
    this.tag = tag;
    this.attrs = attrs;
    this.children = [];
    this.text = '';
  }
  child(tag) {
    const t = tag.toLowerCase();
    return this.children.find(c => c.tag.toLowerCase() === t);
  }
  all(tag) {
    const t = tag.toLowerCase();
    return this.children.filter(c => c.tag.toLowerCase() === t);
  }
  val(tag, def = '') {
    const c = this.child(tag);
    return c ? c.text.trim() : def;
  }
  num(tag, def = 0) {
    const v = parseFloat(this.val(tag));
    return Number.isFinite(v) ? v : def;
  }
}

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/\s*([^\s>]+)\s*>|<([^\s>\/!?]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXML(src) {
  const root = new XNode('#root', {});
  const stack = [root];
  let last = 0,
    m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.text += src.slice(last, m.index);
    last = TOKEN.lastIndex;
    if (m[1]) {
      const name = m[1].toLowerCase();
      let i = stack.length - 1;
      while (i > 0 && stack[i].tag.toLowerCase() !== name) i--;
      if (i > 0) stack.length = i;
      else if (stack.length > 1 && !top.children.length) stack.pop();
    } else if (m[2]) {
      const attrs = {};
      let a;
      ATTR.lastIndex = 0;
      while ((a = ATTR.exec(m[3]))) attrs[a[1]] = a[2] ?? a[3];
      const node = new XNode(m[2], attrs);
      top.children.push(node);
      if (!m[4]) stack.push(node);
    }
  }
  return root;
}
