const SPILL = 180;

export function isLua50Chunk(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return (
    b.length > 22 &&
    b[0] === 0x1b &&
    b[1] === 0x4c &&
    b[2] === 0x75 &&
    (b[4] === 0x50 || b[4] === 0x51) &&
    b[6] === 4 &&
    b[7] === 4 &&
    b[8] === 4
  );
}

function parse(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[5] !== 1) throw new Error('big-endian Lua chunk');
  const numberSize = b[13];
  let p = 14 + numberSize;
  const extra = b[3] === 0x70;
  const int = () => {
    const v = dv.getInt32(p, true);
    p += 4;
    return v;
  };
  const byte = () => b[p++];
  const str = () => {
    const n = int();
    if (!n) return null;
    const s = b.subarray(p, p + n - 1);
    p += n;
    return s;
  };
  const num = () => {
    const v = numberSize === 8 ? dv.getFloat64(p, true) : dv.getFloat32(p, true);
    p += numberSize;
    return v;
  };
  const fn = () => {
    str();
    int();
    if (extra) int();
    const f = { nups: byte(), params: byte(), vararg: byte(), stack: byte() };
    const lineCount = int();
    p += 4 * lineCount;
    for (let i = 0, n = int(); i < n; i++) {
      str();
      int();
      int();
    }
    for (let i = 0, n = int(); i < n; i++) str();
    f.k = [];
    for (let i = 0, n = int(); i < n; i++) {
      const t = byte();
      if (t === 3) f.k.push({ n: num() });
      else if (t === 4) f.k.push({ s: str() || new Uint8Array(0) });
      else if (t === 1) f.k.push({ b: !!byte() });
      else if (t === 0) f.k.push({ nil: true });
      else throw new Error('unknown constant type ' + t);
    }
    f.p = [];
    for (let i = 0, n = int(); i < n; i++) f.p.push(fn());
    f.code = [];
    for (let i = 0, n = int(); i < n; i++) {
      f.code.push(dv.getUint32(p, true));
      p += 4;
    }
    return f;
  };
  const main = fn();
  if (p !== b.length) throw new Error('trailing bytes in Lua chunk');
  return main;
}

function quote(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === 34) out += '\\"';
    else if (c === 92) out += '\\\\';
    else if (c >= 32 && c < 127) out += String.fromCharCode(c);
    else out += '\\' + String(c).padStart(3, '0');
  }
  return out + '"';
}

function number(n) {
  if (Number.isNaN(n)) return '(0/0)';
  if (n === Infinity) return '(1/0)';
  if (n === -Infinity) return '(-1/0)';
  if (Object.is(n, -0)) return '(-0.0)';
  if (Number.isInteger(n) && Math.abs(n) < 2 ** 53) return String(n);
  const t = String(n);
  return t;
}

function constant(k) {
  if (k.nil) return 'nil';
  if (k.b !== undefined) return k.b ? 'true' : 'false';
  if (k.n !== undefined) return number(k.n);
  return quote(k.s);
}

const op = i => i & 63,
  argA = i => (i >>> 24) & 255,
  argB = i => (i >>> 15) & 511,
  argC = i => (i >>> 6) & 511,
  argBx = i => (i >>> 6) & 0x3ffff,
  argSBx = i => ((i >>> 6) & 0x3ffff) - 131071;

const KEYWORDS = new Set(
  'and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(' ')
);
const isName = s => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !KEYWORDS.has(s);
const text = s => String.fromCharCode(...s);

function translate(f, depth, ups) {
  const R = i => (i < SPILL ? `v${depth}_${i}` : `x${depth}[${i}]`);
  const K = i => constant(f.k[i]);
  const code = f.code,
    n = code.length,
    targets = new Set(),
    pseudo = new Set();
  for (let pc = 0; pc < n; pc++) {
    const i = code[pc],
      o = op(i);
    if (pseudo.has(pc)) continue;
    if (o === 20 || o === 28 || o === 30) targets.add(pc + 1 + argSBx(i));
    else if (o === 2 && argC(i)) targets.add(pc + 2);
    else if (o >= 21 && o <= 24) targets.add(pc + 2);
    else if (o === 29) targets.add(pc + 2);
    else if (o === 34) for (let u = 0, m = f.p[argBx(i)].nups; u < m; u++) pseudo.add(pc + 1 + u);
  }
  const L = pc => `l${pc}`;
  const lines = [];
  const params = [];
  for (let i = 0; i < f.params; i++) params.push(R(i));
  if (f.vararg) params.push('...');
  const locals = [];
  for (let i = f.params; i < Math.min(f.stack, SPILL); i++) locals.push(R(i));
  for (let i = 0; i < locals.length; i += 150) lines.push('local ' + locals.slice(i, i + 150).join(', '));
  if (f.stack > SPILL) lines.push(`local x${depth} = {}`);
  if (f.vararg) lines.push(`${R(f.params)} = { n = select("#", ...), ... }`);
  const held = new Map();
  const flush = () => {
    for (const [r, e] of held) lines.push(`${R(r)} = ${e.expr}`);
    held.clear();
  };
  const emit = line => {
    flush();
    lines.push(line);
  };
  const hold = (r, expr, kind) => {
    const old = held.get(r);
    if (old && old.kind === 'call') flush();
    if (kind === 'call' || (kind === 'name' && [...held.values()].some(e => e.kind === 'call'))) flush();
    held.delete(r);
    held.set(r, { expr, kind });
  };
  const get = r => {
    const e = held.get(r);
    if (!e) return R(r);
    held.delete(r);
    return e.expr;
  };
  const prefix = r => {
    const e = held.get(r);
    if (e && e.kind === 'value') flush();
    return get(r);
  };
  const RK = x => (x >= 250 ? K(x - 250) : get(x));
  const globalName = bx => {
    const k = f.k[bx];
    return k.s && isName(text(k.s)) ? text(k.s) : `_ENV[${K(bx)}]`;
  };
  const index = (obj, x) => {
    const k = x >= 250 ? f.k[x - 250] : null;
    return k && k.s && isName(text(k.s)) ? `${obj}.${text(k.s)}` : `${obj}[${RK(x)}]`;
  };
  const regs = (a, b) => {
    const out = [];
    for (let r = a; r <= b; r++) out.push(get(r));
    return out;
  };
  const names = (a, b) => {
    const out = [];
    for (let r = a; r <= b; r++) out.push(R(r));
    return out;
  };
  let open = null;
  const take = (from, pc) => {
    if (!open || open.pc !== pc - 1 || open.reg < from) throw new Error('open call result without a taker at ' + pc);
    const list = regs(from, open.reg - 1);
    list.push(open.expr);
    open = null;
    return list.join(', ');
  };
  for (let pc = 0; pc < n; pc++) {
    if (pseudo.has(pc)) continue;
    if (targets.has(pc)) {
      if (open) throw new Error('jump into an open call at ' + pc);
      flush();
      lines.push(`::${L(pc)}::`);
    }
    const i = code[pc],
      o = op(i),
      A = argA(i),
      B = argB(i),
      C = argC(i);
    if (open && open.pc !== pc - 1) throw new Error('open call result left at ' + open.pc);
    switch (o) {
      case 0:
        emit(`${R(A)} = ${get(B)}`);
        break;
      case 1:
        hold(A, K(argBx(i)), 'value');
        break;
      case 2:
        if (C) {
          emit(`${R(A)} = ${B ? 'true' : 'false'}`);
          lines.push(`goto ${L(pc + 2)}`);
        } else hold(A, B ? 'true' : 'false', 'value');
        break;
      case 3:
        for (let r = A; r <= B; r++) hold(r, 'nil', 'value');
        break;
      case 4:
        emit(`${R(A)} = ${ups[B]}`);
        break;
      case 5:
        hold(A, globalName(argBx(i)), 'name');
        break;
      case 6:
        emit(`${R(A)} = ${index(prefix(B), C)}`);
        break;
      case 7:
        emit(`${globalName(argBx(i))} = ${get(A)}`);
        break;
      case 8:
        emit(`${ups[B]} = ${get(A)}`);
        break;
      case 9: {
        const t = prefix(A),
          key = B >= 250 ? null : get(B);
        const target = key === null ? index(t, B) : `${t}[${key}]`;
        emit(`${target} = ${RK(C)}`);
        break;
      }
      case 10:
        emit(`${R(A)} = {}`);
        break;
      case 11:
        flush();
        emit(`${R(A + 1)}, ${R(A)} = ${R(B)}, ${index(R(B), C)}`);
        break;
      case 12:
      case 13:
      case 14:
      case 15:
      case 16: {
        const x = RK(B),
          y = RK(C);
        emit(`${R(A)} = ${x.startsWith('-') ? `(${x})` : x} ${'+-*/^'[o - 12]} ${y}`);
        break;
      }
      case 17:
        emit(`${R(A)} = -(${get(B)})`);
        break;
      case 18:
        emit(`${R(A)} = not ${get(B)}`);
        break;
      case 19:
        emit(`${R(A)} = ${regs(B, C).join(' .. ')}`);
        break;
      case 20:
        emit(`goto ${L(pc + 1 + argSBx(i))}`);
        break;
      case 21:
      case 22:
      case 23: {
        const x = RK(B),
          y = RK(C);
        if (o === 21) emit(`if ${x} ${A ? '~=' : '=='} ${y} then goto ${L(pc + 2)} end`);
        else {
          const test = `${x} ${o === 22 ? '<' : '<='} ${y}`;
          emit(A ? `if not (${test}) then goto ${L(pc + 2)} end` : `if ${test} then goto ${L(pc + 2)} end`);
        }
        break;
      }
      case 24:
        flush();
        lines.push(C ? `if not ${R(B)} then goto ${L(pc + 2)} end` : `if ${R(B)} then goto ${L(pc + 2)} end`);
        if (A !== B) lines.push(`${R(A)} = ${R(B)}`);
        break;
      case 25:
      case 26: {
        const callee = prefix(A);
        const args = B === 0 ? take(A + 1, pc) : regs(A + 1, A + B - 1).join(', ');
        const call = `${callee}(${args})`;
        if (o === 26) emit(`do return ${call} end`);
        else if (C === 0) open = { pc, reg: A, expr: call };
        else if (C === 1) emit(call);
        else if (C === 2) hold(A, call, 'call');
        else emit(`${names(A, A + C - 2).join(', ')} = ${call}`);
        break;
      }
      case 27:
        if (B === 0 && !open && pc > 0 && op(code[pc - 1]) === 26 && !targets.has(pc)) break;
        if (B === 1) emit('do return end');
        else emit(`do return ${B === 0 ? take(A, pc) : regs(A, A + B - 2).join(', ')} end`);
        break;
      case 28:
        flush();
        lines.push(`${R(A)} = ${R(A)} + ${R(A + 2)}`);
        lines.push(
          `if (${R(A + 2)} > 0 and ${R(A)} <= ${R(A + 1)}) or (${R(A + 2)} <= 0 and ${R(A)} >= ${R(A + 1)}) then goto ${L(pc + 1 + argSBx(i))} end`
        );
        break;
      case 29:
        flush();
        lines.push(`${names(A + 2, A + 2 + C).join(', ')} = ${R(A)}(${R(A + 1)}, ${R(A + 2)})`);
        lines.push(`if ${R(A + 2)} == nil then goto ${L(pc + 2)} end`);
        break;
      case 30:
        flush();
        lines.push(`${R(A)}, ${R(A + 1)}, ${R(A + 2)} = __iter(${R(A)}, ${R(A + 1)}, ${R(A + 2)})`);
        lines.push(`goto ${L(pc + 1 + argSBx(i))}`);
        break;
      case 31: {
        const Bx = argBx(i),
          base = Bx & ~31;
        for (let k = 1; k <= (Bx & 31) + 1; k++) emit(`${R(A)}[${base + k}] = ${get(A + k)}`);
        break;
      }
      case 32: {
        const base = argBx(i) & ~31;
        emit(`do local t__ = table.pack(${take(A + 1, pc)}) for i__ = 1, t__.n do ${R(A)}[${base} + i__] = t__[i__] end end`);
        break;
      }
      case 33:
        break;
      case 34: {
        flush();
        const child = f.p[argBx(i)],
          captured = [];
        for (let u = 0; u < child.nups; u++) {
          const pi = code[pc + 1 + u];
          captured.push(op(pi) === 0 ? R(argB(pi)) : ups[argB(pi)]);
        }
        lines.push(`${R(A)} = ${translate(child, depth + 1, captured)}`);
        break;
      }
      default:
        throw new Error('unknown Lua 5.0 instruction ' + o + ' at ' + pc);
    }
  }
  if (open) throw new Error('open call result at the end');
  flush();
  return `function(${params.join(', ')})\n${lines.join('\n')}\nend`;
}

export function lua50ToSource(bytes) {
  const main = parse(bytes);
  const body = translate(main, 0, []);
  return body.slice(body.indexOf('\n') + 1, body.lastIndexOf('\nend'));
}
