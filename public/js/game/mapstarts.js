import { db } from '../gamedata.js';
import { loadMap } from '../ted.js';
import { iconUrl } from '../icons.js';

const START = /^TEAM_(\d\d)_(SPACE_STATION|BASE_POSITION_MARKER)$/;
const SIZE = 26;

export function startMarks(dlg, label = team => `Team ${team + 1}`) {
  const starts = new Map(),
    marks = [];
  let wanted = null;
  const clear = () => {
    for (const e of marks.splice(0)) e.remove();
  };
  const show = async (map, key, opts, factionOf) => {
    wanted = key;
    if (!starts.has(key))
      starts.set(
        key,
        loadMap(map, opts)
          .then(m => {
            const at = [];
            for (const o of m.objects) {
              const t = START.exec(o.role ? `TEAM_${String(o.team).padStart(2, '0')}_${o.role}` : o.type.name.toUpperCase());
              if (t) at[+t[1]] = o.pos;
            }
            return { at, min: m.min, max: m.max };
          })
          .catch(() => null)
      );
    const info = await starts.get(key);
    if (wanted !== key) return;
    clear();
    if (!info) return;
    const box = dlg.ctl('IDC_IMAGE');
    if (!box) return;
    const W = parseFloat(box.style.width),
      H = parseFloat(box.style.height);
    info.at.forEach((p, team) => {
      const f = factionOf(team);
      if (!p || !f) return;
      const icon = iconUrl(db.faction(f)?.str('Multiplayer_Map_Preview_Icon'));
      if (!icon) return;
      const u = (p[0] - info.min[0]) / (info.max[0] - info.min[0]),
        v = 1 - (p[1] - info.min[1]) / (info.max[1] - info.min[1]);
      const e = document.createElement('div');
      e.className = 'dlg-mark';
      e.style.cssText = `position:absolute;left:${u * W - SIZE / 2}px;top:${v * H - SIZE / 2}px;width:${SIZE}px;height:${SIZE}px;background:url(${icon}) center / 100% 100% no-repeat`;
      e.title = label(team);
      box.appendChild(e);
      marks.push(e);
    });
  };
  return {
    show,
    clear: () => {
      wanted = null;
      clear();
    }
  };
}
