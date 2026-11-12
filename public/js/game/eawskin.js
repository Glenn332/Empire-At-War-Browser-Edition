import { skinImage } from './dialogs.js';

const PIECES = [
  'Top_Left',
  'Top',
  'Top_Right',
  'Right',
  'Bottom_Right',
  'Bottom',
  'Bottom_Left',
  'Left',
  'Background',
  'Top_Transition_Left',
  'Top_Transition_Right',
  'Bottom_Transition_Left',
  'Bottom_Transition_Right',
  'Left_Transition_Top',
  'Left_Transition_Bottom',
  'Right_Transition_Top',
  'Right_Transition_Bottom'
];

const FONT = {
  medium: '"EmpireAtWar-Medium", "Eurostile", "Bank Gothic", "Segoe UI", Arial, sans-serif',
  bold: '"EmpireAtWar-Bold", "Eurostile", "Bank Gothic", "Segoe UI", Arial, sans-serif',
  list: '"Arial Unicode MS", Arial, Helvetica, sans-serif'
};

export const EAW = {
  gold: 'rgb(195,171,2)',
  cream: 'rgb(253,248,212)',
  dim: 'rgb(170,160,120)',
  white: '#fff',
  font: FONT
};

const CSS = `
:root { --eaw-k: 1; --eaw-gold: ${EAW.gold}; --eaw-cream: ${EAW.cream}; --eaw-dim: ${EAW.dim}; --eaw-font: ${FONT.medium}; --eaw-bold: ${FONT.bold}; --eaw-list: ${FONT.list}; }
.eaw-frame, .eaw-frame-s { border-style: solid; border-color: rgba(195,171,2,.75); background-clip: padding-box; box-sizing: border-box; }
.eaw-frame { border-width: calc(var(--eaw-ft, 24px) * var(--eaw-k)) calc(var(--eaw-fr, 24px) * var(--eaw-k)) calc(var(--eaw-fb, 24px) * var(--eaw-k)) calc(var(--eaw-fl, 24px) * var(--eaw-k)); background-color: rgba(60,52,8,.55); }
.eaw-frame-s { border-width: calc(var(--eaw-st, 6px) * var(--eaw-k)) calc(var(--eaw-sr, 6px) * var(--eaw-k)) calc(var(--eaw-sb, 6px) * var(--eaw-k)) calc(var(--eaw-sl, 6px) * var(--eaw-k)); background-color: rgba(10,10,6,.6); }
.eaw-skin .eaw-frame { border-image: var(--eaw-frame) var(--eaw-ft-n) var(--eaw-fr-n) var(--eaw-fb-n) var(--eaw-fl-n) fill stretch; background-color: transparent; }
.eaw-skin .eaw-frame-s { border-image: var(--eaw-frame-s) var(--eaw-st-n) var(--eaw-sr-n) var(--eaw-sb-n) var(--eaw-sl-n) fill stretch; background-color: transparent; }
.eaw-title { font: 400 calc(22px * var(--eaw-k)) var(--eaw-bold); color: var(--eaw-gold); letter-spacing: .02em; text-shadow: 1px 1px 0 rgba(0,0,0,.6); }
.eaw-caption { font: 400 calc(13px * var(--eaw-k)) var(--eaw-bold); color: var(--eaw-gold); letter-spacing: .03em; }
.eaw-text { font: 400 calc(12px * var(--eaw-k)) var(--eaw-font); color: var(--eaw-cream); letter-spacing: .08em; }
.eaw-list { font: 400 calc(12px * var(--eaw-k)) var(--eaw-list); color: #fff; }
.eaw-btn { appearance: none; border: 0; box-sizing: border-box; height: calc(var(--eaw-bh, 26px) * var(--eaw-k)); min-width: calc(120px * var(--eaw-k)); padding: 0 calc(var(--eaw-bw, 12px) * var(--eaw-k) + 10px); cursor: pointer; font: 400 calc(13px * var(--eaw-k)) var(--eaw-bold); color: var(--eaw-cream); text-shadow: 1px 1px 0 rgba(0,0,0,.85); letter-spacing: .04em; background-color: rgba(30,30,30,.9); outline: 1px solid rgba(195,171,2,.8); }
.eaw-skin .eaw-btn { outline: 0; background-color: transparent; background-image: var(--eaw-bl), var(--eaw-br), var(--eaw-bm); background-position: left center, right center, center; background-size: auto 100%, auto 100%, calc(100% - 2 * var(--eaw-bw, 12px) * var(--eaw-k)) 100%; background-repeat: no-repeat; }
.eaw-skin .eaw-btn:hover:not(:disabled) { background-image: var(--eaw-bl-o), var(--eaw-br-o), var(--eaw-bm-o); }
.eaw-skin .eaw-btn:active:not(:disabled) { background-image: var(--eaw-bl-p), var(--eaw-br-p), var(--eaw-bm-p); }
.eaw-btn:disabled { cursor: default; color: var(--eaw-dim); }
.eaw-skin .eaw-btn:disabled { background-image: var(--eaw-bl-d), var(--eaw-br-d), var(--eaw-bm-d); }
.eaw-check { appearance: none; margin: 0; width: calc(var(--eaw-cw, 16px) * var(--eaw-k)); height: calc(var(--eaw-ch, 16px) * var(--eaw-k)); cursor: pointer; border: 1px solid rgba(195,171,2,.8); background: rgba(0,0,0,.5); }
.eaw-check:checked { background: rgba(195,171,2,.8); }
.eaw-skin .eaw-check { border: 0; background: var(--eaw-check-off) center / 100% 100% no-repeat; }
.eaw-skin .eaw-check:checked { background-image: var(--eaw-check-on); }
.eaw-range { appearance: none; -webkit-appearance: none; margin: 0; height: calc(var(--eaw-dh, 14px) * var(--eaw-k)); background: rgba(0,0,0,.5); cursor: pointer; }
.eaw-skin .eaw-range { background: var(--eaw-dial-l) left center / auto 100% no-repeat, var(--eaw-dial-r) right center / auto 100% no-repeat, var(--eaw-dial-m) center / calc(100% - 2 * var(--eaw-dw, 6px) * var(--eaw-k)) 100% no-repeat; }
.eaw-range::-webkit-slider-thumb { -webkit-appearance: none; width: calc(var(--eaw-tw, 10px) * var(--eaw-k)); height: calc(var(--eaw-th, 18px) * var(--eaw-k)); background: var(--eaw-gold); border: 0; }
.eaw-range::-moz-range-thumb { width: calc(var(--eaw-tw, 10px) * var(--eaw-k)); height: calc(var(--eaw-th, 18px) * var(--eaw-k)); background: var(--eaw-gold); border: 0; border-radius: 0; }
.eaw-skin .eaw-range::-webkit-slider-thumb { background: var(--eaw-dial-tab) center / 100% 100% no-repeat; }
.eaw-skin .eaw-range::-moz-range-thumb { background: var(--eaw-dial-tab) center / 100% 100% no-repeat; }
.eaw-select { appearance: none; -webkit-appearance: none; height: calc(var(--eaw-xh, 20px) * var(--eaw-k)); padding: 0 calc(var(--eaw-xb, 18px) * var(--eaw-k) + 6px) 0 calc(var(--eaw-xl, 6px) * var(--eaw-k) + 6px); font: 400 calc(12px * var(--eaw-k)) var(--eaw-list); color: #fff; border: 1px solid rgba(195,171,2,.7); background-color: rgba(0,0,0,.6); cursor: pointer; }
.eaw-skin .eaw-select { border: 0; background: var(--eaw-combo-l) left center / auto 100% no-repeat, var(--eaw-combo-b) right center / auto 100% no-repeat, var(--eaw-combo-m) center / 100% 100% no-repeat; }
.eaw-select option { background: #111; color: #fff; }
.eaw-bar { position: relative; height: calc(var(--eaw-ph, 10px) * var(--eaw-k)); background: rgba(0,0,0,.55); border: 1px solid rgba(195,171,2,.5); box-sizing: border-box; }
.eaw-skin .eaw-bar { border: 0; background: var(--eaw-prog-l) left center / auto 100% no-repeat, var(--eaw-prog-r) right center / auto 100% no-repeat, var(--eaw-prog-off) center / calc(100% - 2 * var(--eaw-pw, 3px) * var(--eaw-k)) 100% no-repeat; }
.eaw-bar > i { position: absolute; left: calc(var(--eaw-pw, 3px) * var(--eaw-k)); top: 0; bottom: 0; display: block; max-width: calc(100% - 2 * var(--eaw-pw, 3px) * var(--eaw-k)); background: var(--eaw-gold); }
.eaw-skin .eaw-bar > i { background: var(--eaw-prog-on) left center / auto 100% repeat-x; }
.eaw-scan { background-image: var(--eaw-scan); background-repeat: repeat; }
.eaw-key { display: inline-block; min-width: 1.4em; margin: 0 .35em 0 0; padding: 0 .35em; box-sizing: border-box; font: 400 1em var(--eaw-bold); color: var(--eaw-cream); text-align: center; border: 1px solid rgba(195,171,2,.85); background: rgba(0,0,0,.55); }
`;

let ready = null;

const load = url =>
  new Promise(res => {
    if (!url) return res(null);
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
  });

async function pieces(prefix) {
  const out = {};
  await Promise.all(
    PIECES.map(async n => {
      const s = await skinImage(prefix + n);
      out[n] = s ? await load(s.url) : null;
    })
  );
  return out;
}

async function composite(prefix, mid) {
  const im = await pieces(prefix),
    s = n => (im[n] ? [im[n].width, im[n].height] : [0, 0]);
  if (!im.Top_Left || !im.Top || !im.Left) return null;
  const L = Math.max(s('Top_Left')[0] + s('Top_Transition_Left')[0], s('Bottom_Left')[0] + s('Bottom_Transition_Left')[0], s('Left')[0]),
    R = Math.max(s('Top_Right')[0] + s('Top_Transition_Right')[0], s('Bottom_Right')[0] + s('Bottom_Transition_Right')[0], s('Right')[0]),
    T = Math.max(s('Top_Left')[1] + s('Left_Transition_Top')[1], s('Top_Right')[1] + s('Right_Transition_Top')[1], s('Top')[1]),
    B = Math.max(s('Bottom_Left')[1] + s('Left_Transition_Bottom')[1], s('Bottom_Right')[1] + s('Right_Transition_Bottom')[1], s('Bottom')[1]),
    w = L + mid + R,
    h = T + mid + B,
    cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const x = cv.getContext('2d'),
    put = (n, px, py, pw, ph) => {
      if (im[n] && pw > 0 && ph > 0) x.drawImage(im[n], px, py, pw, ph);
    };
  const [tlw, tlh] = s('Top_Left'),
    [trw, trh] = s('Top_Right'),
    [blw, blh] = s('Bottom_Left'),
    [brw, brh] = s('Bottom_Right'),
    tt = s('Top_Transition_Left')[0],
    ttr = s('Top_Transition_Right')[0],
    bt = s('Bottom_Transition_Left')[0],
    btr = s('Bottom_Transition_Right')[0],
    lt = s('Left_Transition_Top')[1],
    ltb = s('Left_Transition_Bottom')[1],
    rt = s('Right_Transition_Top')[1],
    rtb = s('Right_Transition_Bottom')[1],
    el = s('Left')[0],
    er = s('Right')[0],
    et = s('Top')[1],
    eb = s('Bottom')[1];
  put('Background', el, et, w - el - er, h - et - eb);
  put('Top', tlw + tt, 0, w - tlw - trw - tt - ttr, et);
  put('Bottom', blw + bt, h - eb, w - blw - brw - bt - btr, eb);
  put('Left', 0, tlh + lt, el, h - tlh - blh - lt - ltb);
  put('Right', w - er, trh + rt, er, h - trh - brh - rt - rtb);
  put('Top_Transition_Left', tlw, 0, tt, s('Top_Transition_Left')[1]);
  put('Top_Transition_Right', w - trw - ttr, 0, ttr, s('Top_Transition_Right')[1]);
  put('Bottom_Transition_Left', blw, h - s('Bottom_Transition_Left')[1], bt, s('Bottom_Transition_Left')[1]);
  put('Bottom_Transition_Right', w - brw - btr, h - s('Bottom_Transition_Right')[1], btr, s('Bottom_Transition_Right')[1]);
  put('Left_Transition_Top', 0, tlh, s('Left_Transition_Top')[0], lt);
  put('Left_Transition_Bottom', 0, h - blh - ltb, s('Left_Transition_Bottom')[0], ltb);
  put('Right_Transition_Top', w - s('Right_Transition_Top')[0], trh, s('Right_Transition_Top')[0], rt);
  put('Right_Transition_Bottom', w - s('Right_Transition_Bottom')[0], h - brh - rtb, s('Right_Transition_Bottom')[0], rtb);
  put('Top_Left', 0, 0, tlw, tlh);
  put('Top_Right', w - trw, 0, trw, trh);
  put('Bottom_Left', 0, h - blh, blw, blh);
  put('Bottom_Right', w - brw, h - brh, brw, brh);
  return { url: cv.toDataURL(), T, R, B, L };
}

const url = s => (s ? `url("${s.url}")` : 'none');

async function images(keys) {
  const out = {};
  await Promise.all(Object.entries(keys).map(async ([k, n]) => (out[k] = await skinImage(n))));
  return out;
}

function scale() {
  const k = Math.max(1, Math.min(1.45, Math.min(innerHeight / 860, innerWidth / 1400)));
  document.documentElement.style.setProperty('--eaw-k', k.toFixed(3));
}

export function eawSkin() {
  if (ready) return ready;
  if (!document.getElementById('eaw-skin-css')) {
    const st = document.createElement('style');
    st.id = 'eaw-skin-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  scale();
  addEventListener('resize', scale);
  ready = (async () => {
    const [big, small, I] = await Promise.all([
      composite('Frame_', 32),
      composite('Small_Frame_', 16),
      images({
        bl: 'Button_Left',
        bm: 'Button_Middle',
        br: 'Button_Right',
        blo: 'Button_Left_Mouse_Over',
        bmo: 'Button_Middle_Mouse_Over',
        bro: 'Button_Right_Mouse_Over',
        blp: 'Button_Left_Pressed',
        bmp: 'Button_Middle_Pressed',
        brp: 'Button_Right_Pressed',
        bld: 'Button_Left_Disabled',
        bmd: 'Button_Middle_Disabled',
        brd: 'Button_Right_Disabled',
        con: 'Check_On',
        coff: 'Check_Off',
        dl: 'Dial_Left',
        dm: 'Dial_Middle',
        dr: 'Dial_Right',
        dt: 'Dial_Tab',
        xl: 'Combo_Box_Left_Cap',
        xm: 'Combo_Box_Text_Box',
        xb: 'Combo_Box_Popdown_Button',
        pl: 'Progress_Bar_Left',
        poff: 'Progress_Bar_Middle_Off',
        pon: 'Progress_Bar_Middle_On',
        pr: 'Progress_Bar_Right',
        scan: 'Scanlines'
      })
    ]).catch(() => [null, null, {}]);
    if (!big || !small || !I.bl || !I.bm) return false;
    const R = document.documentElement.style,
      set = (k, v) => R.setProperty(k, v);
    set('--eaw-frame', `url("${big.url}")`);
    set('--eaw-ft', big.T + 'px');
    set('--eaw-fr', big.R + 'px');
    set('--eaw-fb', big.B + 'px');
    set('--eaw-fl', big.L + 'px');
    set('--eaw-ft-n', String(big.T));
    set('--eaw-fr-n', String(big.R));
    set('--eaw-fb-n', String(big.B));
    set('--eaw-fl-n', String(big.L));
    set('--eaw-frame-s', `url("${small.url}")`);
    set('--eaw-st', small.T + 'px');
    set('--eaw-sr', small.R + 'px');
    set('--eaw-sb', small.B + 'px');
    set('--eaw-sl', small.L + 'px');
    set('--eaw-st-n', String(small.T));
    set('--eaw-sr-n', String(small.R));
    set('--eaw-sb-n', String(small.B));
    set('--eaw-sl-n', String(small.L));
    for (const [k, v] of [
      ['bl', 'bl'],
      ['bm', 'bm'],
      ['br', 'br'],
      ['bl-o', 'blo'],
      ['bm-o', 'bmo'],
      ['br-o', 'bro'],
      ['bl-p', 'blp'],
      ['bm-p', 'bmp'],
      ['br-p', 'brp'],
      ['bl-d', 'bld'],
      ['bm-d', 'bmd'],
      ['br-d', 'brd'],
      ['check-on', 'con'],
      ['check-off', 'coff'],
      ['dial-l', 'dl'],
      ['dial-m', 'dm'],
      ['dial-r', 'dr'],
      ['dial-tab', 'dt'],
      ['combo-l', 'xl'],
      ['combo-m', 'xm'],
      ['combo-b', 'xb'],
      ['prog-l', 'pl'],
      ['prog-off', 'poff'],
      ['prog-on', 'pon'],
      ['prog-r', 'pr'],
      ['scan', 'scan']
    ])
      set('--eaw-' + k, url(I[v]));
    if (I.bl) {
      set('--eaw-bh', I.bl.h + 'px');
      set('--eaw-bw', I.bl.w + 'px');
    }
    if (I.coff) {
      set('--eaw-cw', I.coff.w + 'px');
      set('--eaw-ch', I.coff.h + 'px');
    }
    if (I.dm) set('--eaw-dh', I.dm.h + 'px');
    if (I.dl) set('--eaw-dw', I.dl.w + 'px');
    if (I.dt) {
      set('--eaw-tw', I.dt.w + 'px');
      set('--eaw-th', I.dt.h + 'px');
    }
    if (I.xm) set('--eaw-xh', I.xm.h + 'px');
    if (I.xl) set('--eaw-xl', I.xl.w + 'px');
    if (I.xb) set('--eaw-xb', I.xb.w + 'px');
    if (I.pon) set('--eaw-ph', I.pon.h + 'px');
    if (I.pl) set('--eaw-pw', I.pl.w + 'px');
    document.documentElement.classList.add('eaw-skin');
    return true;
  })();
  return ready;
}
