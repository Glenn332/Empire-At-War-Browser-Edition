const f = Math.fround,
  key = x => String(x || '').toUpperCase();
export class GalacticBudget {
  constructor() {
    this.categories = new Map();
    this.rows = new Set();
    this.initialized = false;
    this.duration = 0;
    this.dirty = false;
    this.spare = 0;
  }
  weights(values, credits, complete = true) {
    this.blocked = !complete;
    let sum = 0;
    const weights = new Map();
    for (const [name, value] of values) {
      const w = Math.max(0, Number.isFinite(value) ? value : 0);
      weights.set(key(name), w);
      sum += w;
    }
    for (const [name, w] of weights) {
      const weight = complete && weights.size ? (sum ? w / sum : 1 / weights.size) : 0;
      let c = this.categories.get(name);
      if (!c) {
        c = { name, weight, oldWeight: weight, cash: 0, income: 0, total: 0, totalIncome: 0, rows: new Set() };
        this.categories.set(name, c);
        this.dirty = true;
      }
      if (c.weight !== weight) this.dirty = true;
      c.weight = weight;
    }
    for (const c of this.categories.values())
      if (!weights.has(c.name) && c.weight) {
        c.weight = 0;
        this.dirty = true;
      }
    if (!this.initialized && complete) {
      for (const c of this.categories.values()) {
        c.oldWeight = c.weight;
        c.total = f(credits * c.weight);
      }
      this.initialized = true;
      this.dirty = false;
    }
    this.service();
  }
  category(name) {
    return this.categories.get(key(name));
  }
  horizon(value, limit = -1) {
    return limit === -1 ? value : Math.min(value, limit);
  }
  available(name, time = 0, limit = -1) {
    const c = this.category(name);
    return c ? Math.max(0, f(c.cash + Math.min(time, limit < 0 ? time : limit) * c.income)) : 0;
  }
  admits(name, cost, time = 0, limit = -1) {
    const c = this.category(name);
    return (
      !!c && (!this.blocked || cost === 0) && Math.max(0, f(c.cash + Math.max(this.horizon(time, limit), this.duration) * c.income)) >= cost
    );
  }
  reserve(name, cost, time = 0, limit = -1) {
    const c = this.category(name);
    if (!c || !this.admits(name, cost, time, limit)) return null;
    const r = {
      category: c,
      requested: f(cost),
      allocated: 0,
      horizon: this.horizon(time, limit),
      rate: 0,
      saved: 0,
      immediate: 0,
      minimum: 0,
      released: false
    };
    c.rows.add(r);
    this.rows.add(r);
    this.fund(r);
    return r;
  }
  service() {
    for (const c of this.categories.values()) {
      c.cash = c.total;
      c.income = c.totalIncome;
      for (const r of c.rows) {
        c.cash = f(c.cash - r.saved);
        r.immediate = 0;
      }
      for (const r of c.rows) this.fund(r);
    }
  }
  fund(r) {
    const c = r.category;
    let need = f(Math.max(0, r.requested) + r.allocated - r.saved);
    if (need < 0) {
      c.cash = f(c.cash - need);
      r.saved = f(r.saved + need);
      need = 0;
    }
    c.cash = f(c.cash - need);
    r.immediate = need;
    const unfunded = c.cash < 0 ? Math.min(-c.cash, need) : 0;
    c.cash = f(c.cash + unfunded);
    r.immediate = f(r.immediate - unfunded);
    const horizon = r.horizon > 0 ? r.horizon : this.duration;
    r.rate = horizon > 0 ? f(unfunded / horizon) : 0;
    c.income = f(c.income - r.rate);
    if (c.income < 0 && c.cash <= 0) {
      r.rate = Math.max(0, f(c.income + r.rate));
      const delta = f(c.income * horizon);
      c.cash = f(c.cash + delta);
      r.immediate = f(r.immediate - delta);
      c.income = 0;
    }
  }
  allocate(r, amount) {
    if (!r || r.released) return false;
    r.requested = f(r.requested - amount);
    r.allocated = f(r.allocated + amount);
    return true;
  }
  spendable(r) {
    return r && !r.released ? Math.max(0, Math.min(r.allocated, f(r.saved + r.immediate))) : 0;
  }
  wait(r, cost) {
    const deficit = f(cost + r.minimum - this.spendable(r));
    if (Math.trunc(deficit) <= 0) return 0;
    let denominator = Math.max(f(r.allocated - r.immediate - r.saved), deficit);
    if (r.horizon > 0) denominator = f(denominator / r.horizon);
    return deficit / denominator;
  }
  pay(r, amount) {
    if (!r || r.released) return false;
    const available = this.spendable(r);
    if (Math.trunc(f(available - amount)) < 0) {
      if (r.allocated < amount) r.minimum = f(r.minimum + amount - r.allocated);
      return false;
    }
    const paid = Math.min(amount, available);
    r.minimum = Math.max(0, f(r.minimum - paid));
    r.allocated = Math.max(0, f(r.allocated - paid));
    const saved = Math.min(r.saved, paid);
    r.saved = f(r.saved - saved);
    r.immediate = f(r.immediate - (paid - saved));
    r.category.total = f(r.category.total - paid);
    return paid;
  }
  fiscal(income, credits, duration) {
    const rate = duration > 0 ? income / duration : 0;
    let pool = this.spare;
    for (const c of this.categories.values()) {
      c.total = c.cash;
      const previous = c.totalIncome;
      c.totalIncome = f(c.oldWeight * rate);
      for (const r of c.rows) {
        const share = previous > 0 ? f((r.rate / previous) * c.totalIncome) : 0;
        const missing =
          r.horizon > 0 ? f(share - Math.max(0, r.requested) / r.horizon) : duration > 0 ? f(Math.max(0, r.requested) / duration) : 0;
        let funded = Math.max(0, f((r.horizon > 0 ? 0 : share) - missing));
        if (funded > 0) funded = Math.max(funded, 0.0001 / duration);
        r.saved = f(r.saved + funded * duration);
        r.allocated = Math.max(r.allocated, r.minimum);
        c.total = f(c.total + (share - funded) * duration + r.immediate + r.saved);
        r.horizon = Math.max(0, f(r.horizon - duration));
      }
      c.oldWeight = c.weight;
      pool = f(pool + c.total);
    }
    for (const c of this.categories.values()) {
      if (this.dirty) c.total = f(pool * c.weight);
      c.total = f(c.total + (credits - pool) * c.weight);
    }
    this.duration = duration;
    this.dirty = false;
    this.service();
  }
  release(r) {
    if (!r || r.released) return;
    r.released = true;
    const c = r.category;
    c.cash = f(c.cash + r.saved + r.immediate);
    c.rows.delete(r);
    this.rows.delete(r);
  }
  snapshot(rows) {
    return {
      initialized: this.initialized,
      duration: this.duration,
      dirty: this.dirty,
      spare: this.spare,
      categories: [...this.categories.values()].map(({ rows, ...c }) => ({ ...c })),
      rows: rows.map(r => ({ ...r, category: r.category.name }))
    };
  }
  restore(saved) {
    if (!saved) return [];
    this.initialized = saved.initialized;
    this.duration = saved.duration;
    this.dirty = saved.dirty;
    this.spare = saved.spare;
    this.categories = new Map(saved.categories.map(c => [c.name, { ...c, rows: new Set() }]));
    this.rows.clear();
    return saved.rows.map(data => {
      const category = this.category(data.category);
      if (!category) return null;
      const r = { ...data, category };
      category.rows.add(r);
      this.rows.add(r);
      return r;
    });
  }
  report() {
    return [...this.categories.values()].map(c => ({
      name: c.name,
      weight: c.weight,
      credits: c.cash,
      income: c.income,
      total: c.total,
      goals: c.rows.size
    }));
  }
}
