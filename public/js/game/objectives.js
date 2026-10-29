import { db } from '../gamedata.js';

export const OBJECTIVE_ACTIVE = 0,
  OBJECTIVE_COMPLETE = 1,
  OBJECTIVE_FAILED = 2;

export class ObjectiveList {
  constructor(onChange = () => {}) {
    this.items = [];
    this.serial = 0;
    this.display = true;
    this.onChange = onChange;
  }

  text(id) {
    return db.t(id);
  }
  find(id) {
    return this.items.findIndex(o => o.id === String(id));
  }
  changed(sound = false) {
    try {
      this.onChange(this, sound);
    } catch (error) {
      console.warn('Objectives', error);
    }
  }

  add(id, flag = false, custom = null, at = -1) {
    id = String(id ?? '');
    const item = {
      id,
      text: custom ?? this.text(id),
      state: OBJECTIVE_ACTIVE,
      flag: !!flag,
      serial: ++this.serial,
      custom: custom != null
    };
    if (at >= 0 && at <= this.items.length) this.items.splice(at, 0, item);
    else this.items.push(item);
    this.changed(false);
    return item;
  }
  remove(id) {
    const i = this.find(id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    this.changed(false);
    return true;
  }
  removeAll() {
    if (!this.items.length) return;
    this.items.length = 0;
    this.changed(false);
  }
  setState(id, state) {
    const item = this.items[this.find(id)];
    if (!item) return false;
    item.state = state;
    this.changed(true);
    return true;
  }
  complete(id) {
    return this.setState(id, OBJECTIVE_COMPLETE);
  }
  fail(id) {
    return this.setState(id, OBJECTIVE_FAILED);
  }
  replace(oldId, newId) {
    const item = this.items[this.find(oldId)];
    if (!item) return false;
    item.id = String(newId ?? '');
    item.text = this.text(item.id);
    item.custom = false;
    item.state = OBJECTIVE_ACTIVE;
    this.changed(false);
    return true;
  }
  setDisplay(on) {
    this.display = !!on;
    this.changed(false);
  }
  refreshText() {
    for (const item of this.items) if (!item.custom) item.text = this.text(item.id);
    this.changed(false);
  }

  snapshot() {
    return { items: this.items.map(o => ({ ...o })), serial: this.serial, display: this.display };
  }
  restore(saved) {
    if (!saved) return;
    this.items = (saved.items || []).map(o => ({
      id: String(o.id),
      text: o.custom ? o.text : this.text(o.id),
      state: o.state | 0,
      flag: !!o.flag,
      serial: o.serial | 0,
      custom: !!o.custom
    }));
    this.serial = saved.serial | 0;
    this.display = saved.display !== false;
    if (this.items.length) this.changed(false);
  }
}

export function objectiveReward(list, reward, p) {
  switch (reward) {
    case 'ADD_OBJECTIVE':
      if (p[0]) list.add(p[0], false);
      return true;
    case 'REMOVE_OBJECTIVE':
      if (p[0]) list.remove(p[0]);
      return true;
    case 'OBJECTIVE_COMPLETE':
      if (p[0]) list.complete(p[0]);
      return true;
    case 'OBJECTIVE_FAILED':
      if (p[0]) list.fail(p[0]);
      return true;
    case 'REMOVE_ALL_OBJECTIVES':
      list.removeAll();
      return true;
    case 'ENABLE_OBJECTIVE_DISPLAY':
      list.setDisplay(p[0] === undefined || p[0] === '' || (parseInt(p[0], 10) || 0) !== 0);
      return true;
    case 'UPDATE_OBJECTIVE':
    case 'REPLACE_OBJECTIVE':
      if (p[0]) list.replace(p[0], p[1]);
      return true;
    default:
      return false;
  }
}
