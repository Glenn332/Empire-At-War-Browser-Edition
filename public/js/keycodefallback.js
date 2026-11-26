// Fills in KeyboardEvent.code when the system leaves it empty. The game's hotkeys read the
// physical key (code), and some keyboards hand the page keys without one: Android input
// methods, some Bluetooth keyboards, and keys sent by tools. The code is worked out from
// keyCode, or from key when there is no keyCode, the way a US layout would place the key.
// A classic script loaded first in <head>, so this listener runs before every other one.
(() => {
  const NAMED_BY_KEY_CODE = {
    8: 'Backspace',
    9: 'Tab',
    12: 'NumpadEqual',
    13: 'Enter',
    16: 'Shift',
    17: 'Control',
    18: 'Alt',
    19: 'Pause',
    20: 'CapsLock',
    27: 'Escape',
    32: 'Space',
    33: 'PageUp',
    34: 'PageDown',
    35: 'End',
    36: 'Home',
    37: 'ArrowLeft',
    38: 'ArrowUp',
    39: 'ArrowRight',
    40: 'ArrowDown',
    44: 'PrintScreen',
    45: 'Insert',
    46: 'Delete',
    91: 'MetaLeft',
    92: 'MetaRight',
    93: 'ContextMenu',
    106: 'NumpadMultiply',
    107: 'NumpadAdd',
    109: 'NumpadSubtract',
    110: 'NumpadDecimal',
    111: 'NumpadDivide',
    144: 'NumLock',
    145: 'ScrollLock',
    186: 'Semicolon',
    187: 'Equal',
    188: 'Comma',
    189: 'Minus',
    190: 'Period',
    191: 'Slash',
    192: 'Backquote',
    219: 'BracketLeft',
    220: 'Backslash',
    221: 'BracketRight',
    222: 'Quote'
  };
  const SIDED = new Set(['Shift', 'Control', 'Alt']);
  const NAMED_BY_KEY = {
    ' ': 'Space',
    ';': 'Semicolon',
    '=': 'Equal',
    ',': 'Comma',
    '-': 'Minus',
    '.': 'Period',
    '/': 'Slash',
    '`': 'Backquote',
    '[': 'BracketLeft',
    '\\': 'Backslash',
    ']': 'BracketRight',
    "'": 'Quote'
  };
  const LOCATION_RIGHT = 2,
    LOCATION_NUMPAD = 3;
  // keys whose name is already their code (Escape, Enter, Tab, the arrows, F1 to F24...)
  const KEY_IS_CODE = /^(Escape|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right)|F\d{1,2}|CapsLock|Pause|ContextMenu)$/;

  function codeFromKeyCode(event) {
    const keyCode = event.keyCode;
    if (keyCode >= 65 && keyCode <= 90) return 'Key' + String.fromCharCode(keyCode);
    if (keyCode >= 48 && keyCode <= 57) return 'Digit' + (keyCode - 48);
    if (keyCode >= 96 && keyCode <= 105) return 'Numpad' + (keyCode - 96);
    if (keyCode >= 112 && keyCode <= 135) return 'F' + (keyCode - 111);
    if (keyCode === 13 && event.location === LOCATION_NUMPAD) return 'NumpadEnter';
    const named = NAMED_BY_KEY_CODE[keyCode];
    if (!named) return '';
    if (SIDED.has(named)) return named + (event.location === LOCATION_RIGHT ? 'Right' : 'Left');
    return named;
  }

  function codeFromKey(event) {
    const key = event.key || '';
    if (/^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase();
    if (/^[0-9]$/.test(key)) return (event.location === LOCATION_NUMPAD ? 'Numpad' : 'Digit') + key;
    if (NAMED_BY_KEY[key]) return NAMED_BY_KEY[key];
    if (SIDED.has(key)) return key + (event.location === LOCATION_RIGHT ? 'Right' : 'Left');
    if (key === 'Meta') return 'MetaLeft';
    if (KEY_IS_CODE.test(key)) return key;
    return '';
  }

  // 229 is the keyCode of a key an input method is still composing: it names no key yet
  const COMPOSING = 229;

  function fillCode(event) {
    if (event.code || event.keyCode === COMPOSING || event.isComposing) return;
    const code = codeFromKeyCode(event) || codeFromKey(event);
    if (code) Object.defineProperty(event, 'code', { value: code, configurable: true });
  }

  for (const type of ['keydown', 'keyup']) addEventListener(type, fillCode, { capture: true });
})();
