import { db, factionColor } from '../gamedata.js';
import { iconUrl } from '../icons.js';
import { loadMap, mapTitle, mapHeader, loadMapPreview } from '../ted.js';
import { PALETTE } from './slotrows.js';
import { DYNAMIC_SIZES, isDynamic, dynamicSize, resizeDynamic, seedBar } from './dynamicmap.js';
import {
  INSTANT_MAX_PLAYERS,
  INSTANT_MAX_TEAMS,
  INSTANT_BUDGET,
  INSTANT_BUDGET_MIN,
  INSTANT_BUDGET_MAX,
  CLASS_GROUPS,
  instantRoster,
  armyCost,
  canAdd,
  randomArmy,
  entryPoints
} from './instantbattle.js';

const KEY = 'swr-instant-setup';
const AI_KINDS = [
  ['easy', 'Easy AI'],
  ['medium', 'Medium AI'],
  ['hard', 'Hard AI']
];
const OPEN = ['open', 'Open'];
const FILTERS = [{ key: 'all', label: 'All' }, ...CLASS_GROUPS, { key: 'hero', label: 'Heroes' }];

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const money = n => '$' + Math.round(n).toLocaleString();
const clampBudget = n => Math.max(INSTANT_BUDGET_MIN, Math.min(INSTANT_BUDGET_MAX, Math.round(+n || 0)));
const sound = name => window.game?.audio?.play(name);
const isAI = k => AI_KINDS.some(a => a[0] === k);

const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
};
const store = v => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {}
};

export async function openInstantBattle({ maps, factions, audio, cancel, start, mp = null }) {
  if (!maps.length || !factions.length) return false;
  const net = mp?.session || null,
    host = !mp || mp.host,
    myId = () => (net ? net.id : null);
  const fLabel = f => db.t(db.faction(f)?.str('Text_ID')) || f;
  const saved = load() || {};
  const st = {
    mapFile: maps.includes(saved.mapFile) || isDynamic(saved.mapFile) ? saved.mapFile : maps.find(m => /KUAT/i.test(m)) || maps[0],
    fog: typeof saved.fog === 'boolean' ? saved.fog : false,
    budget: Number.isFinite(saved.budget) ? clampBudget(saved.budget) : INSTANT_BUDGET,
    turn: Number.isFinite(saved.turn) ? saved.turn : Math.random() * Math.PI * 2
  };
  const view = { filter: 'all', sel: 0 };
  const fresh = (kind, team, faction, extra = {}) => ({
    kind,
    team,
    faction,
    budget: st.budget,
    army: [],
    color: null,
    ...extra
  });
  const rosterOf = p => instantRoster(p.faction);
  const mine = p => (net ? p.kind === 'human' && p.peer === myId() : p.kind === 'you');
  const canEdit = p => (!net ? true : host ? mine(p) || p.kind !== 'human' : mine(p));
  const prune = p => {
    const roster = rosterOf(p),
      names = new Set(roster.map(r => r.name)),
      seen = new Set();
    p.army = p.army.filter(n => typeof n === 'string' && names.has(n));
    p.army = p.army.filter(n => {
      if (!roster.find(x => x.name === n)?.hero) return true;
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    while (armyCost(roster, p.army) > p.budget) p.army.pop();
  };

  let players = [];
  const foes = () => {
    const me = factions.find(f => /^EMPIRE$/i.test(f)) || factions[0];
    return [me, factions.find(f => /^REBEL$/i.test(f) && f !== me) || factions.find(f => f !== me) || me];
  };
  if (mp && !host) {
    st.mapFile = mp.initial.st.mapFile;
    Object.assign(st, mp.initial.st);
    players = mp.initial.players;
  } else if (mp) {
    const [me, foe] = foes();
    players = [fresh('human', 0, me, { peer: 0, name: mp.name, ready: true }), fresh('open', 1, foe, { ready: false })];
    players[0].army = randomArmy(instantRoster(me), st.budget);
  } else {
    if (Array.isArray(saved.players) && saved.players.length && saved.players[0]?.kind === 'you')
      players = saved.players.slice(0, INSTANT_MAX_PLAYERS).map((p, i) => ({
        kind: i === 0 ? 'you' : isAI(p.kind) ? p.kind : 'medium',
        team: Math.max(0, Math.min(INSTANT_MAX_TEAMS - 1, p.team | 0)),
        faction: factions.includes(p.faction) ? p.faction : factions[0],
        budget: clampBudget(p.budget ?? st.budget),
        army: Array.isArray(p.army) ? p.army.filter(n => typeof n === 'string') : [],
        color: typeof p.color === 'string' ? p.color : null
      }));
    if (players.length < 2) {
      const [me, foe] = foes();
      players = [fresh('you', 0, me), fresh('medium', 1, foe)];
      for (const p of players) p.army = randomArmy(instantRoster(p.faction), p.budget);
    }
  }
  const setTeam = (p, team) => {
    p.team = team;
    const mate = players.find(q => q !== p && q.team === p.team);
    if (mate && mate.faction !== p.faction) {
      p.faction = mate.faction;
      prune(p);
    }
  };
  const unify = (from, faction) => {
    for (const p of players)
      if (p.team === from.team && p.faction !== faction) {
        p.faction = faction;
        prune(p);
      }
    from.faction = faction;
    prune(from);
  };
  if (host)
    for (const p of players) {
      const mate = players.find(q => q.team === p.team);
      if (mate !== p) p.faction = mate.faction;
      prune(p);
    }
  view.sel = Math.max(0, players.findIndex(mine));

  const rgb = c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
  const near = (a, b) => {
    const x = rgb(a),
      y = rgb(b);
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 90;
  };
  const colors = () => {
    const used = players.filter(q => q.color).map(q => q.color.toLowerCase());
    const free = c => !used.some(u => near(u, c));
    return players.map(p => {
      if (p.color) return p.color;
      const own = factionColor(p.faction);
      const c = (own && free(own) ? own : PALETTE.find(free) || PALETTE.find(x => !used.includes(x)) || PALETTE[0]).toLowerCase();
      used.push(c);
      return c;
    });
  };
  const colorOf = (p, i) => colors()[i];
  const remember = () => {
    if (mp) return;
    store({
      mapFile: st.mapFile,
      fog: st.fog,
      budget: st.budget,
      turn: st.turn,
      players: players.map(({ kind, team, faction, budget, army, color }) => ({ kind, team, faction, budget, army, color }))
    });
  };

  const humans = () => players.filter(p => p.kind === 'human');
  const listing = () => {
    if (!net || !host || mp.kind === 'lan') return;
    net.setListing({
      name: mp.gameName,
      host: mp.name,
      map: st.mapFile,
      mode: 'instant',
      locked: !!mp.password,
      players: humans().length,
      slots: players.filter(p => p.kind === 'human' || p.kind === 'open').length,
      version: mp.version,
      mod: mp.data
    });
  };
  const publish = () => {
    if (!net || !host) return;
    net.broadcast({ k: 'state', ib: { st: { ...st }, players } });
    listing();
  };
  const unreadyAll = () => {
    for (const p of players) if (p.kind === 'human' && p.peer !== 0) p.ready = false;
  };
  const changed = (p = null, shared = false) => {
    if (net && host) {
      if (shared) unreadyAll();
      else if (p && p.kind === 'human' && p.peer !== 0) p.ready = false;
      publish();
    } else if (net && p && mine(p)) {
      p.ready = false;
      net.send(0, { k: 'fleet', fleet: { faction: p.faction, team: p.team, color: p.color, army: p.army } });
    }
    draw();
  };

  const root = el('div');
  root.id = 'instantBattle';
  const panel = el('div', 'ib-panel');
  root.appendChild(panel);

  const button = (label, fn, cls = '') => {
    const b = el('button', 'ib-btn ' + cls, label);
    b.type = 'button';
    b.addEventListener('mouseenter', () => sound('GUI_Highlight_Mouse_Over'));
    b.onclick = e => {
      e.stopPropagation();
      if (b.disabled) return;
      sound('GUI_Button_Press_2_SFX');
      fn(e);
    };
    return b;
  };
  const select = (options, value, fn, cls = '') => {
    const s = el('select', 'ib-select ' + cls);
    for (const [v, text] of options) {
      const o = el('option', '', text);
      o.value = v;
      s.appendChild(o);
    }
    s.value = value;
    s.onclick = e => e.stopPropagation();
    s.onchange = () => {
      sound('GUI_Button_Press_2_SFX');
      fn(s.value);
    };
    return s;
  };

  const head = el('div', 'ib-head');
  const titleBox = el('div', 'ib-title');
  titleBox.append(
    el('h1', '', net ? 'Instant Battle · Multiplayer' : 'Instant Battle'),
    el(
      'p',
      '',
      net
        ? mp.gameName || 'Pick your fleet and wait for the host to start.'
        : 'Pick your fleets, choose the field and fight to the last ship.'
    )
  );
  const budgetBox = el('label', 'ib-budget');
  budgetBox.append(el('span', '', 'Starting budget'));
  const budgetIn = el('input', 'ib-num');
  budgetIn.type = 'number';
  budgetIn.min = INSTANT_BUDGET_MIN;
  budgetIn.max = INSTANT_BUDGET_MAX;
  budgetIn.step = 500;
  budgetIn.value = st.budget;
  const applyAll = button('Apply to all', () => {
    st.budget = clampBudget(budgetIn.value);
    budgetIn.value = st.budget;
    for (const p of players) {
      p.budget = st.budget;
      prune(p);
    }
    changed(null, true);
  });
  budgetIn.onchange = () => {
    st.budget = clampBudget(budgetIn.value);
    budgetIn.value = st.budget;
  };
  budgetBox.append(budgetIn, applyAll);
  head.append(titleBox, budgetBox);

  const body = el('div', 'ib-body');
  const fleetsCol = el('section', 'ib-col ib-fleets');
  const armyCol = el('section', 'ib-col ib-army');
  const mapCol = el('section', 'ib-col ib-map');
  body.append(fleetsCol, armyCol, mapCol);

  const foot = el('div', 'ib-foot');
  const error = el('div', 'ib-error');
  const back = button('Back', () => close(false), 'ib-wide');
  const go = button(host ? 'Start Battle' : 'Ready', () => (host ? launch() : toggleReady()), 'ib-wide ib-go');
  foot.append(back, error, go);
  panel.append(head, body, foot);

  const fleetsHead = el('div', 'ib-colhead');
  fleetsHead.append(el('h2', '', 'Fleets'));
  const fleetTools = el('div', 'ib-tools');
  const addBtn = button('Add AI', () => {
    if (players.length >= INSTANT_MAX_PLAYERS) return;
    const taken = new Set(players.map(p => p.team));
    let team = 0;
    while (taken.has(team) && team < INSTANT_MAX_TEAMS - 1) team++;
    const others = factions.filter(f => !players.some(p => p.faction === f));
    const mate = players.find(p => p.team === team);
    const p = fresh('medium', team, mate ? mate.faction : others[0] || factions[players.length % factions.length]);
    p.army = randomArmy(rosterOf(p), p.budget);
    players.push(p);
    view.sel = players.length - 1;
    changed(null, true);
  });
  const rollAll = button('Randomize All', () => {
    for (const p of players) if (canEdit(p) && p.kind !== 'open') p.army = randomArmy(rosterOf(p), p.budget);
    changed(null, false);
  });
  fleetTools.append(addBtn, rollAll);
  fleetsHead.append(fleetTools);
  const fleetList = el('div', 'ib-list ib-fleetlist');
  const teamNote = el('div', 'ib-note');
  fleetsCol.append(fleetsHead, fleetList, teamNote);

  const chat = el('div', 'ib-chat');
  const chatLog = el('div', 'ib-chatlog');
  const chatIn = el('input', 'ib-num ib-chatin');
  chatIn.placeholder = 'Say something…';
  chatIn.maxLength = 200;
  chat.append(chatLog, chatIn);
  if (net) fleetsCol.append(chat);
  const say = (who, text, link = null) => {
    const line = el('div', 'ib-chatline' + (link ? ' link' : ''));
    if (who) line.append(el('b', '', who + ': '));
    line.append(document.createTextNode(text));
    if (link)
      line.onclick = () => {
        const done = ok => say('', ok ? 'Invite link copied.' : 'Copy the link by hand: ' + link);
        if (navigator.clipboard?.writeText)
          navigator.clipboard.writeText(link).then(
            () => done(true),
            () => done(false)
          );
        else done(false);
      };
    chatLog.appendChild(line);
    while (chatLog.childElementCount > 100) chatLog.firstChild.remove();
    chatLog.scrollTop = chatLog.scrollHeight;
  };
  chatIn.onkeydown = e => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const text = chatIn.value.trim();
    chatIn.value = '';
    if (!text) return;
    if (host) {
      say(mp.name, text);
      net.broadcast({ k: 'chat', name: mp.name, text });
    } else net.send(0, { k: 'chat', text });
  };

  const armyHead = el('div', 'ib-colhead');
  const armyTitle = el('h2');
  const armyTools = el('div', 'ib-tools');
  const rollOne = button('Random', () => {
    const p = players[view.sel];
    p.army = randomArmy(rosterOf(p), p.budget);
    changed(p);
  });
  const clearOne = button('Clear', () => {
    const p = players[view.sel];
    p.army = [];
    changed(p);
  });
  armyTools.append(rollOne, clearOne);
  armyHead.append(armyTitle, armyTools);
  const meter = el('div', 'ib-meter');
  const meterFill = el('div', 'ib-meter-fill');
  const meterText = el('div', 'ib-meter-text');
  meter.append(meterFill, meterText);
  const chips = el('div', 'ib-chips');
  const catalog = el('div', 'ib-list ib-catalog');
  armyCol.append(armyHead, meter, chips, catalog);

  const mapHead = el('div', 'ib-colhead');
  mapHead.append(el('h2', '', 'Battlefield'));
  const preview = el('div', 'ib-preview');
  const previewImg = el('div', 'ib-preview-img');
  const previewMarks = el('div', 'ib-preview-marks');
  preview.append(previewImg, previewMarks);
  const mapName = el('div', 'ib-mapname');
  const mapOpts = el('div', 'ib-tools ib-mapopts');
  const fogBtn = button('', () => {
    st.fog = !st.fog;
    drawOpts();
    changed(null, true);
  });
  const spinBtn = button('Shuffle Entry', () => {
    st.turn = Math.random() * Math.PI * 2;
    changed(null, true);
  });
  mapOpts.append(fogBtn, spinBtn);
  const dynOpts = el('div', 'ib-tools ib-mapopts ib-dynopts');
  const sizeBtns = DYNAMIC_SIZES.map(s =>
    button(s.label, () => {
      if (!isDynamic(st.mapFile) || dynamicSize(st.mapFile).key === s.key) return;
      st.mapFile = resizeDynamic(s.key);
      changed(null, true);
    })
  );
  const seeds = seedBar({
    get: () => st.mapFile,
    set: next => {
      st.mapFile = next;
      changed(null, true);
    },
    readonly: () => !host,
    sound: () => sound('GUI_Button_Press_2_SFX')
  });
  dynOpts.append(...sizeBtns);
  const mapList = el('div', 'ib-list ib-maplist');
  mapCol.append(mapHead, preview, mapName, mapOpts, dynOpts, seeds.el, mapList);
  const drawOpts = () => {
    fogBtn.textContent = st.fog ? 'Fog of War: On' : 'Fog of War: Off';
    fogBtn.classList.toggle('on', st.fog);
    const dyn = isDynamic(st.mapFile);
    dynOpts.classList.toggle('hidden', !dyn);
    seeds.update();
    sizeBtns.forEach((b, i) => b.classList.toggle('on', dyn && dynamicSize(st.mapFile).key === DYNAMIC_SIZES[i].key));
  };

  const filled = () => players.filter(p => p.kind !== 'open');
  const teamsUsed = () => [...new Set(filled().map(p => p.team))].sort((a, b) => a - b);
  const nameOf = (p, i) =>
    p.kind === 'you'
      ? 'Your fleet'
      : p.kind === 'human'
        ? mine(p)
          ? 'Your fleet'
          : `${p.name}'s fleet`
        : p.kind === 'open'
          ? 'Open slot'
          : `${AI_KINDS.find(k => k[0] === p.kind)[1]} ${i}`;

  const drawFleets = () => {
    fleetList.replaceChildren();
    players.forEach((p, i) => {
      const roster = rosterOf(p),
        spent = armyCost(roster, p.army),
        edit = canEdit(p);
      const row = el('div', 'ib-fleet' + (i === view.sel ? ' sel' : '') + (p.kind === 'open' ? ' open' : '') + (mine(p) ? ' mine' : ''));
      row.style.setProperty('--pc', colorOf(p, i));
      row.onclick = () => {
        if (view.sel !== i) {
          view.sel = i;
          sound('GUI_Button_Press_2_SFX');
          draw();
        }
      };
      const top = el('div', 'ib-fleet-top');
      const crest = el('div', 'ib-crest');
      const icon = iconUrl(db.faction(p.faction)?.str('Icon_Name'));
      if (icon) crest.style.backgroundImage = `url(${icon})`;
      let who;
      if (p.kind === 'you') who = el('div', 'ib-who', 'You');
      else if (p.kind === 'human') {
        who = el('div', 'ib-who' + (mine(p) ? '' : ' other'), p.name || 'Player');
        if (p.peer === 0) who.title = 'Host';
      } else if (host)
        who = select(net ? [OPEN, ...AI_KINDS] : AI_KINDS, p.kind, v => {
          p.kind = v;
          if (v === 'open') p.army = [];
          else if (!p.army.length) p.army = randomArmy(rosterOf(p), p.budget);
          changed(null, true);
        });
      else who = el('div', 'ib-who other', p.kind === 'open' ? 'Open' : AI_KINDS.find(k => k[0] === p.kind)[1]);
      const fac = select(
        factions.map(f => [f, fLabel(f)]),
        p.faction,
        v => {
          unify(p, v);
          changed(
            p,
            players.some(q => q !== p && q.team === p.team)
          );
        }
      );
      const team = select(
        Array.from({ length: INSTANT_MAX_TEAMS }, (_, t) => [t, `Team ${t + 1}`]),
        p.team,
        v => {
          setTeam(p, +v);
          changed(p);
        },
        'ib-team'
      );
      fac.disabled = team.disabled = !edit;
      const color = el('input', 'ib-color');
      color.type = 'color';
      color.value = colorOf(p, i);
      color.title = 'Fleet colour';
      color.disabled = !edit;
      color.onclick = e => e.stopPropagation();
      color.oninput = () => {
        p.color = color.value;
        row.style.setProperty('--pc', color.value);
      };
      color.onchange = () => changed(p);
      top.append(crest, who, fac, team, color);
      const bottom = el('div', 'ib-fleet-bottom');
      if (p.kind === 'open') {
        bottom.append(el('div', 'ib-sum', 'Waiting for a player to join'));
      } else {
        const bar = el('div', 'ib-bar');
        const fill = el('div', 'ib-bar-fill');
        fill.style.width = Math.min(100, (100 * spent) / Math.max(1, p.budget)) + '%';
        bar.append(fill);
        const sum = el(
          'div',
          'ib-sum',
          `${p.army.length} ${p.army.length === 1 ? 'unit' : 'units'} · ${money(spent)} / ${money(p.budget)}`
        );
        bottom.append(bar, sum);
        if (net && p.kind === 'human') {
          const ok = p.peer === 0 || p.ready;
          bottom.append(el('div', 'ib-ready' + (ok ? ' on' : ''), p.peer === 0 ? 'Host' : ok ? 'Ready' : 'Not ready'));
        }
      }
      const bud = el('input', 'ib-num ib-small');
      bud.type = 'number';
      bud.min = INSTANT_BUDGET_MIN;
      bud.max = INSTANT_BUDGET_MAX;
      bud.step = 500;
      bud.value = p.budget;
      bud.title = 'Budget for this fleet';
      bud.disabled = !host;
      bud.onclick = e => e.stopPropagation();
      bud.onchange = () => {
        p.budget = clampBudget(bud.value);
        prune(p);
        changed(p, p.kind === 'human' && !mine(p));
      };
      const dice = button(
        '🎲',
        () => {
          p.army = randomArmy(roster, p.budget);
          changed(p);
        },
        'ib-icon'
      );
      dice.title = 'Random fleet within the budget';
      dice.disabled = !edit || p.kind === 'open';
      const del = button(
        '✕',
        () => {
          if (net && p.kind === 'human') net.kick(p.peer);
          else {
            players.splice(i, 1);
            view.sel = Math.max(0, Math.min(view.sel, players.length - 1));
            changed(null, true);
          }
        },
        'ib-icon'
      );
      del.title = p.kind === 'human' ? 'Remove this player from the game' : 'Remove';
      if (p.kind === 'you' || !host || mine(p)) del.style.visibility = 'hidden';
      if (p.kind !== 'open') bottom.append(bud, dice, del);
      else bottom.append(del);
      row.append(top, bottom);
      fleetList.appendChild(row);
    });
    addBtn.disabled = !host || players.length >= INSTANT_MAX_PLAYERS;
    rollAll.disabled = !players.some(p => canEdit(p) && p.kind !== 'open');
    const used = teamsUsed();
    teamNote.textContent =
      used.length < 2
        ? 'Put at least two teams on the field.'
        : `${filled().length} ${filled().length === 1 ? 'fleet' : 'fleets'} on ${used.length} teams · players on one team share a faction`;
    teamNote.classList.toggle('bad', used.length < 2);
  };

  const drawArmy = () => {
    view.sel = Math.max(0, Math.min(view.sel, players.length - 1));
    const p = players[view.sel],
      i = view.sel,
      roster = rosterOf(p),
      spent = armyCost(roster, p.army),
      edit = canEdit(p) && p.kind !== 'open';
    armyCol.style.setProperty('--pc', colorOf(p, i));
    armyTitle.textContent = `${nameOf(p, i)} — ${fLabel(p.faction)}`;
    rollOne.disabled = clearOne.disabled = !edit;
    meterFill.style.width = Math.min(100, (100 * spent) / Math.max(1, p.budget)) + '%';
    meterText.textContent = `${money(spent)} of ${money(p.budget)} · ${money(p.budget - spent)} left`;
    chips.replaceChildren();
    for (const f of FILTERS) {
      const has = f.key === 'all' || roster.some(r => (f.key === 'hero' ? r.hero : !r.hero && f.of?.(r.cls)));
      if (!has) continue;
      const c = button(
        f.label,
        () => {
          view.filter = f.key;
          drawArmy();
        },
        'ib-chip' + (view.filter === f.key ? ' on' : '')
      );
      chips.appendChild(c);
    }
    const shown = roster.filter(r =>
      view.filter === 'all' ? true : view.filter === 'hero' ? r.hero : !r.hero && FILTERS.find(f => f.key === view.filter)?.of?.(r.cls)
    );
    const scroll = catalog.scrollTop;
    catalog.replaceChildren();
    if (!roster.length) catalog.appendChild(el('div', 'ib-empty', 'This faction has no space units to choose from.'));
    let group = null;
    for (const r of shown) {
      const g = r.hero ? 'Heroes' : CLASS_GROUPS.find(c => c.of(r.cls))?.label || 'Other';
      if (view.filter === 'all' && g !== group) {
        group = g;
        catalog.appendChild(el('div', 'ib-group', g));
      }
      const n = p.army.filter(x => x === r.name).length;
      const row = el('div', 'ib-unit' + (n ? ' has' : ''));
      const ic = el('div', 'ib-unit-icon');
      const url = iconUrl(r.icon);
      if (url) ic.style.backgroundImage = `url(${url})`;
      const info = el('div', 'ib-unit-info');
      info.append(
        el('div', 'ib-unit-name', r.label),
        el('div', 'ib-unit-meta', `${money(r.cost)}${r.pop ? ` · pop ${r.pop}` : ''}${r.hero ? ' · unique' : ''}`)
      );
      const count = el('div', 'ib-count', n ? String(n) : '');
      const remove = () => {
        const k = p.army.lastIndexOf(r.name);
        if (k < 0) return false;
        p.army.splice(k, 1);
        changed(p);
        return true;
      };
      const minus = button('−', remove, 'ib-icon');
      minus.disabled = !edit || !n;
      const plus = button('+', () => add(r), 'ib-icon');
      plus.disabled = !edit || !canAdd(roster, p.army, p.budget, r);
      row.title = !edit
        ? 'Only this fleet’s owner can change it'
        : plus.disabled
          ? r.hero && n
            ? 'Heroes are unique'
            : 'Not enough budget left'
          : 'Click to add · right-click to remove';
      row.onclick = () => {
        if (!plus.disabled) {
          sound('GUI_Button_Press_2_SFX');
          add(r);
        }
      };
      row.oncontextmenu = e => {
        e.preventDefault();
        if (edit && remove()) sound('GUI_Button_Press_2_SFX');
      };
      row.append(ic, info, minus, count, plus);
      catalog.appendChild(row);
    }
    catalog.scrollTop = scroll;
    function add(r) {
      if (!canAdd(roster, p.army, p.budget, r)) return;
      const order = new Map(roster.map((x, k) => [x.name, k]));
      p.army.push(r.name);
      p.army.sort((a, b) => order.get(a) - order.get(b));
      changed(p);
    }
  };

  const bounds = new Map();
  const previews = new Map();
  const boundsOf = m => {
    if (!bounds.has(m))
      bounds.set(
        m,
        loadMap(m)
          .then(map => ({ min: { x: map.min[0], y: map.min[1] }, max: { x: map.max[0], y: map.max[1] } }))
          .catch(() => null)
      );
    return bounds.get(m);
  };
  const drawMarks = async () => {
    const m = st.mapFile,
      b = await boundsOf(m);
    if (m !== st.mapFile) return;
    previewMarks.replaceChildren();
    if (!b) return;
    const used = teamsUsed(),
      pts = entryPoints(b.min, b.max, used.length, st.turn);
    const W = b.max.x - b.min.x,
      H = b.max.y - b.min.y;
    used.forEach((team, k) => {
      const at = pts[k],
        i = players.findIndex(p => p.team === team && p.kind !== 'open'),
        p = players[i];
      const mk = el('div', 'ib-mark');
      mk.style.left = `clamp(15px, ${((at.x - b.min.x) / W) * 100}%, calc(100% - 15px))`;
      mk.style.top = `clamp(15px, ${(1 - (at.y - b.min.y) / H) * 100}%, calc(100% - 15px))`;
      mk.style.setProperty('--pc', colorOf(p, i));
      mk.style.setProperty('--rot', -at.facing + 'rad');
      const arrow = el('div', 'ib-mark-arrow');
      const label = el('div', 'ib-mark-label', String(team + 1));
      mk.title = `Team ${team + 1} — ${fLabel(p.faction)}`;
      mk.append(arrow, label);
      previewMarks.appendChild(mk);
    });
  };
  let shownMap = null;
  const viewKey = () => (isDynamic(st.mapFile) ? `${st.mapFile}|${teamsUsed().length}|${st.turn}` : st.mapFile);
  const drawPreview = async () => {
    const m = st.mapFile,
      key = viewKey();
    shownMap = key;
    mapName.textContent = mapTitle(m);
    const n = mapHeader(m)?.players;
    if (isDynamic(m)) mapName.appendChild(el('span', '', ' · generated for every fleet'));
    else if (n) mapName.appendChild(el('span', '', ` · ${n} player map`));
    if (!previews.has(key))
      previews.set(
        key,
        loadMapPreview(m, { teams: Math.max(2, teamsUsed().length), turn: st.turn, instant: true })
          .then(cv => (cv ? cv.toDataURL() : ''))
          .catch(e => (console.warn('map preview', e), ''))
      );
    const url = await previews.get(key);
    if (key !== viewKey()) return;
    previewImg.style.backgroundImage = url ? `url(${url})` : '';
    previewImg.classList.toggle('none', !url);
    drawMarks();
  };
  const drawMaps = () => {
    mapList.replaceChildren();
    const rows = maps
      .filter(m => !isDynamic(m))
      .map(m => ({ m, name: mapTitle(m) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (maps.some(isDynamic)) rows.unshift({ m: null, name: 'Dynamic Map' });
    for (const { m, name } of rows) {
      const on = m ? m === st.mapFile : isDynamic(st.mapFile);
      const r = el('div', 'ib-maprow' + (m ? '' : ' ib-dynamic') + (on ? ' sel' : ''), name);
      if (!m) r.appendChild(el('span', 'ib-maptag', 'Generated'));
      if (!host) r.classList.add('locked');
      r.onclick = () => {
        const next = m || (isDynamic(st.mapFile) ? st.mapFile : resizeDynamic('medium'));
        if (!host || st.mapFile === next) return;
        st.mapFile = next;
        sound('GUI_Button_Press_2_SFX');
        for (const x of mapList.children) x.classList.toggle('sel', x === r);
        drawOpts();
        drawPreview();
        changed(null, true);
      };
      mapList.appendChild(r);
    }
    requestAnimationFrame(() => {
      const sel = mapList.querySelector('.sel');
      if (sel) mapList.scrollTop = sel.offsetTop - mapList.clientHeight / 2;
    });
  };

  const drawHost = () => {
    for (const b of [applyAll, fogBtn, spinBtn, ...sizeBtns]) b.disabled = !host;
    seeds.update();
    budgetIn.disabled = !host;
    budgetIn.value = st.budget;
    if (!host) {
      const me = players.find(mine);
      go.textContent = me?.ready ? 'Not Ready' : 'Ready';
      go.classList.toggle('on', !!me?.ready);
    }
  };
  const draw = () => {
    error.textContent = '';
    drawOpts();
    drawHost();
    drawFleets();
    drawArmy();
    if (shownMap !== viewKey()) {
      if (!shownMap || shownMap.split('|')[0] !== st.mapFile) drawMaps();
      drawPreview();
    } else drawMarks();
    remember();
  };

  let done,
    ended = false,
    beat = 0;
  const offs = [];
  const finished = new Promise(r => (done = r));
  const onKey = e => {
    if (e.code === 'Escape' && document.activeElement !== chatIn && !document.activeElement?.classList.contains('dyn-seed-input')) {
      e.stopPropagation();
      close(false);
    }
  };
  function close(started, why = null) {
    if (ended) return;
    ended = true;
    removeEventListener('keydown', onKey, true);
    clearInterval(beat);
    for (const off of offs) off();
    remember();
    root.remove();
    if (net && !started) {
      if (host) net.setListing(null);
      net.close();
      if (why) alert(why);
      mp.back?.();
    } else if (!started && cancel) cancel();
    done(started);
  }
  function toggleReady() {
    const me = players.find(mine);
    if (!me) return;
    if (!me.ready && !me.army.length) {
      error.textContent = 'Add some ships to your fleet first.';
      return;
    }
    me.ready = !me.ready;
    net.send(0, { k: 'ready', on: me.ready });
    draw();
  }
  function launch() {
    const used = teamsUsed();
    if (used.length < 2) {
      error.textContent = 'At least two teams are needed for a battle.';
      return;
    }
    const empty = players.findIndex(p => p.kind !== 'open' && !p.army.length);
    if (empty >= 0) {
      view.sel = empty;
      draw();
      error.textContent = `${nameOf(players[empty], empty)} has no ships yet — add some or press Random.`;
      return;
    }
    if (net && players.some(p => p.kind === 'human' && p.peer !== 0 && !p.ready)) {
      error.textContent = 'Waiting for every player to press Ready.';
      return;
    }
    const index = new Map(used.map((t, k) => [t, k]));
    const teamFactions = used.map(t => players.find(p => p.team === t && p.kind !== 'open').faction);
    const all = colors();
    const fleets = players.map((p, i) => ({ p, color: all[i] })).filter(({ p }) => p.kind !== 'open');
    const setup = {
      mode: 'space',
      type: 'instant',
      mapFile: st.mapFile,
      credits: 0,
      popCap: 0,
      fog: st.fog,
      teamFactions,
      players: fleets.map(({ p, color }) =>
        p.kind === 'you'
          ? { human: true, team: index.get(p.team), color, auto: false }
          : p.kind === 'human'
            ? { human: true, peer: p.peer, name: p.name, team: index.get(p.team), color, auto: false }
            : { human: false, team: index.get(p.team), difficulty: p.kind, color, auto: false }
      ),
      instant: { turn: st.turn, armies: fleets.map(({ p }) => p.army.slice()) }
    };
    if (net) {
      setup.seed = crypto.getRandomValues(new Uint32Array(1))[0];
      setup.spaceWorker = !new URLSearchParams(location.search).has('nospaceworker');
      net.setListing(null);
      net.broadcast({ k: 'start', setup });
    }
    close(true);
    audio?.unlock?.();
    start(setup);
  }

  if (net && host) {
    offs.push(
      net.on('message', (from, m) => {
        const i = players.findIndex(p => p.kind === 'human' && p.peer === from),
          s = players[i];
        if (m.k === 'hello') {
          if (m.version !== mp.version || m.data !== mp.data) {
            net.send(from, { k: 'refuse', why: "Your game version or game data differs from the host's." });
            setTimeout(() => net.kick(from), 300);
            return;
          }
          if (mp.password && m.password !== mp.password) {
            net.send(from, { k: 'password', wrong: m.password !== undefined });
            return;
          }
          if (s) return;
          const slot = players.find(p => p.kind === 'open');
          if (!slot) {
            net.send(from, { k: 'refuse', why: 'The game is full.' });
            setTimeout(() => net.kick(from), 300);
            return;
          }
          Object.assign(slot, { kind: 'human', peer: from, name: String(m.name || 'Player').slice(0, 24), ready: false });
          slot.army = randomArmy(rosterOf(slot), slot.budget);
          const text = `${slot.name} joined the game.`;
          say('', text);
          net.broadcast({ k: 'chat', name: '', text });
          publish();
          draw();
        } else if (!s) return;
        else if (m.k === 'fleet' && m.fleet) {
          const f = m.fleet;
          if (Number.isInteger(f.team) && f.team >= 0 && f.team < INSTANT_MAX_TEAMS && f.team !== s.team) setTeam(s, f.team);
          if (typeof f.faction === 'string' && factions.includes(f.faction) && f.faction !== s.faction) unify(s, f.faction);
          if (f.color === null || (typeof f.color === 'string' && /^#[0-9a-f]{6}$/i.test(f.color))) s.color = f.color;
          if (Array.isArray(f.army)) {
            s.army = f.army.slice(0, 4000);
            prune(s);
          }
          s.ready = false;
          publish();
          draw();
        } else if (m.k === 'ready') {
          s.ready = !!m.on && s.army.length > 0;
          publish();
          draw();
        } else if (m.k === 'chat') {
          const text = String(m.text || '').slice(0, 200);
          if (text) {
            say(s.name, text);
            net.broadcast({ k: 'chat', name: s.name, text });
          }
        }
      }),
      net.on('leave', peer => {
        const s = players.find(p => p.kind === 'human' && p.peer === peer);
        if (!s) return;
        const text = `${s.name} left the game.`;
        say('', text);
        net.broadcast({ k: 'chat', name: '', text });
        Object.assign(s, { kind: 'open', peer: undefined, name: '', ready: false, army: [] });
        publish();
        draw();
      }),
      net.on('closed', why => close(false, 'The connection to the game was lost (' + why + ').'))
    );
    if (mp.kind !== 'lan') beat = setInterval(listing, 30000);
  } else if (net) {
    offs.push(
      net.on('message', (from, m) => {
        if (m.k === 'state' && m.ib) {
          Object.assign(st, m.ib.st);
          players = m.ib.players;
          draw();
        } else if (m.k === 'chat') say(m.name, m.text);
        else if (m.k === 'refuse') close(false, m.why);
        else if (m.k === 'start' && m.setup) {
          close(true);
          audio?.unlock?.();
          start(m.setup);
        }
      }),
      net.on('closed', why =>
        close(false, why === 'host left' ? 'The host closed the game.' : 'The connection to the game was lost (' + why + ').')
      )
    );
  }

  addEventListener('keydown', onKey, true);
  document.body.appendChild(root);
  draw();
  if (net && host) {
    publish();
    if (mp.invite) say('', 'Invite link (click to copy, send it to whoever you want to play): ' + mp.invite, mp.invite);
  }
  if (net && !host) say('', 'You joined the game. Build your fleet and press Ready.');
  return true;
}
