(() => {
  if (typeof window === 'undefined' || window.swrConsoleLog) return;
  const MAX_ENTRIES = 3000;
  const MAX_TEXT = 6000;
  const MAX_DEPTH = 3;
  const started = performance.now();
  const entries = [];
  const counts = { log: 0, info: 0, warn: 0, error: 0, debug: 0 };
  let dropped = 0;

  const describeError = error => {
    const head = `${error.name || 'Error'}: ${error.message || ''}`;
    const stack = typeof error.stack === 'string' ? error.stack : '';
    return stack.includes(error.message || head) ? stack : head + (stack ? '\n' + stack : '');
  };

  const describeValue = (value, depth, seen) => {
    if (value === null || value === undefined) return String(value);
    const kind = typeof value;
    if (kind === 'string') return value;
    if (kind === 'number' || kind === 'boolean' || kind === 'bigint' || kind === 'symbol') return String(value);
    if (kind === 'function') return `[function ${value.name || 'anonymous'}]`;
    if (value instanceof Error) return describeError(value);
    if (typeof Element !== 'undefined' && value instanceof Element)
      return `<${value.tagName.toLowerCase()}${value.id ? '#' + value.id : ''}${value.className && typeof value.className === 'string' ? '.' + value.className.trim().split(/\s+/).join('.') : ''}>`;
    if (seen.has(value)) return '[circular]';
    if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[array of ${value.length}]` : '{...}';
    seen.add(value);
    try {
      if (ArrayBuffer.isView(value)) return `[${value.constructor.name} of ${value.length}]`;
      if (value instanceof Map) return `Map(${value.size}) ` + describeValue(Object.fromEntries([...value].slice(0, 40)), depth + 1, seen);
      if (value instanceof Set) return `Set(${value.size}) ` + describeValue([...value].slice(0, 40), depth + 1, seen);
      if (Array.isArray(value)) {
        const shown = value.slice(0, 60).map(item => describeValue(item, depth + 1, seen));
        return '[' + shown.join(', ') + (value.length > 60 ? `, ... ${value.length - 60} more` : '') + ']';
      }
      const keys = Object.keys(value);
      const shown = keys.slice(0, 40).map(key => {
        let item;
        try {
          item = value[key];
        } catch {
          item = '[unreadable]';
        }
        return `${key}: ${typeof item === 'string' ? JSON.stringify(item) : describeValue(item, depth + 1, seen)}`;
      });
      const name = value.constructor && value.constructor !== Object ? value.constructor.name + ' ' : '';
      return name + '{' + shown.join(', ') + (keys.length > 40 ? `, ... ${keys.length - 40} more` : '') + '}';
    } catch {
      return '[unreadable]';
    } finally {
      seen.delete(value);
    }
  };

  const formatArguments = args => {
    let text = '';
    for (let i = 0; i < args.length; i++) {
      if (i) text += ' ';
      text += describeValue(args[i], 0, new Set());
      if (text.length > MAX_TEXT) break;
    }
    if (typeof args[0] === 'string' && args[0].includes('%c')) text = text.replace(/%c/g, '');
    return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + ` ... (${text.length - MAX_TEXT} more characters)` : text;
  };

  const record = (level, text) => {
    counts[level] = (counts[level] || 0) + 1;
    const last = entries[entries.length - 1];
    if (last && last.level === level && last.text === text) {
      last.repeats++;
      return;
    }
    entries.push({ at: performance.now() - started, time: Date.now(), level, text, repeats: 1 });
    if (entries.length > MAX_ENTRIES) {
      dropped += entries.length - MAX_ENTRIES;
      entries.splice(0, entries.length - MAX_ENTRIES);
    }
  };

  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    console[level] = function (...args) {
      try {
        record(level, formatArguments(args));
      } catch {}
      return original.apply(this, args);
    };
  }

  addEventListener(
    'error',
    event => {
      const target = event.target;
      if (target && target !== window && target.tagName) {
        record('error', `[resource] failed to load <${target.tagName.toLowerCase()}> ${target.src || target.href || ''}`);
        return;
      }
      const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : '';
      record('error', '[uncaught] ' + (event.error ? describeError(event.error) : (event.message || 'error') + where));
    },
    true
  );

  addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    record('error', '[unhandled rejection] ' + (reason instanceof Error ? describeError(reason) : describeValue(reason, 0, new Set())));
  });

  window.swrConsoleLog = {
    started,
    entries,
    counts,
    get dropped() {
      return dropped;
    },
    record
  };
})();
