// The Today dashboard's numbers: highlights, pinned tiles and the month view. Plain functions on the person's own
// entries (no AI, no network), so every line on Today is something they can check. Loaded before app.js; the tests
// in dev/dashboard.test.mjs import it too.
(() => {
  const DAY = 86400000;
  const toMs = d => Date.parse(d + 'T12:00:00Z');
  const addDays = (d, n) => new Date(toMs(d) + n * DAY).toISOString().slice(0, 10);
  const diffDays = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY);
  const inRange = (d, from, to) => d >= from && d <= to;
  const key = s => String(s || '').trim().toLowerCase();
  const cap = s => { s = String(s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const round1 = n => Math.round(n * 10) / 10;
  const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

  // Check-ins are free text ("tired but okay", "Good", "bad day"); sort them into three plain groups.
  function moodOf(feeling) {
    const f = key(feeling);
    if (!f) return '';
    if (/\bnot (so |very |that )?(good|great|well)\b/.test(f)) return 'rough';
    const ok = /\b(okay|ok|alright|fine|so-so|meh|mixed)\b/.test(f);
    if (/\b(great|good|well|better|happy|calm|energ|amazing|lovely)\w*/.test(f) && !/\b(rough|bad|awful)\b/.test(f)) return 'good';
    if (/\b(rough|bad|low|awful|terrible|sad|down|anxious|stress|hard|tough|tired|exhausted|cranky|irritable|angry|teary|overwhelm)\w*/.test(f)) return ok ? 'okay' : 'rough';
    return 'okay';
  }

  // Symptom name → { name, days: Set, sev: { date: max severity } } within [from, to].
  function bySymptom(user, from, to) {
    const map = new Map();
    for (const s of user.symptoms || []) {
      const k = key(s.name);
      if (!k || !inRange(s.date, from, to)) continue;
      const e = map.get(k) || { key: k, name: cap(s.name), days: new Set(), sev: {} };
      e.days.add(s.date);
      const v = Number(s.severity) || 0;
      if (v) e.sev[s.date] = Math.max(e.sev[s.date] || 0, v);
      map.set(k, e);
    }
    return map;
  }
  const avgSev = (e, from, to) => { const v = Object.entries(e.sev).filter(([d]) => inRange(d, from, to)).map(([, x]) => x); return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const daysIn = (e, from, to) => [...e.days].filter(d => inRange(d, from, to)).length;

  function cycleInfo(user, today) {
    const starts = [...new Set((user.cycleStarts || []).map(c => c.date))].filter(d => d <= today).sort();
    if (!starts.length) return null;
    const last = starts[starts.length - 1], day = diffDays(last, today) + 1;
    const gaps = starts.slice(1).map((d, i) => diffDays(starts[i], d)).filter(n => n >= 10 && n <= 120).slice(-3);
    return { last, day, usual: gaps.length ? median(gaps) : null };
  }

  // Days with anything logged (symptom, check-in or period) in the last `n` days.
  function loggedDays(user, today, n) {
    const from = addDays(today, -(n - 1)), set = new Set();
    for (const k of ['symptoms', 'checkins', 'cycleStarts']) for (const x of user[k] || []) if (inRange(x.date, from, today)) set.add(x.date);
    return set;
  }

  // One mood per day: good or rough when that day's check-ins agree, otherwise okay.
  function dayMoods(user, from, to) {
    const by = {};
    for (const c of user.checkins || []) { const m = moodOf(c.feeling); if (m && inRange(c.date, from, to)) (by[c.date] = by[c.date] || new Set()).add(m); }
    return Object.values(by).map(set => set.size === 1 ? [...set][0] : 'okay');
  }

  const NEED_DAYS = 3; // days of entries before the first highlight

  // Up to 3 short, factual findings, calm in tone. Each: { kind, icon, label, text, sub, bars? }.
  function highlights(user, today) {
    const out = [];
    const w1 = addDays(today, -6), w0 = addDays(today, -13), lastWeekEnd = addDays(today, -7), m1 = addDays(today, -29);
    const two = [...bySymptom(user, w0, today).values()].sort((a, b) => b.days.size - a.days.size || Object.keys(b.sev).length - Object.keys(a.sev).length);
    const trend = e => {
      const now = daysIn(e, w1, today), before = daysIn(e, w0, lastWeekEnd);
      if (now + before < 2) return null;
      const text = now === 0 ? `None this week, after ${plural(before, 'day')} last week`
        : before === 0 ? `${plural(now, 'day')} this week`
        : now < before ? `${plural(now, 'day')} this week, down from ${before}`
        : now > before ? `${plural(now, 'day')} this week, up from ${before}`
        : `${plural(now, 'day')} this week, same as last week`;
      const a = avgSev(e, w1, today), b = avgSev(e, w0, lastWeekEnd);
      const sub = a != null && b != null && Math.abs(a - b) >= 1 ? `Average strength ${a}/10, ${a < b ? 'down' : 'up'} from ${b}`
        : a != null ? `Average strength ${a}/10` : 'Last 14 days';
      const bars = Array.from({ length: 14 }, (_, i) => { const d = addDays(today, i - 13); return { date: d, v: e.days.has(d) ? (e.sev[d] || 3) : 0 }; });
      return { kind: 'trend', icon: 'trend', label: e.name, text, sub, bars, eased: now < before || (a != null && b != null && a <= b - 1) };
    };

    if (two[0]) { const t = trend(two[0]); if (t) out.push(t); }

    // Two symptoms that keep turning up on the same days (this month). Stated as co-occurrence, never as a cause.
    const month = [...bySymptom(user, m1, today).values()].filter(e => e.days.size >= 3).sort((a, b) => b.days.size - a.days.size).slice(0, 5);
    let pair = null;
    for (let i = 0; i < month.length; i++) for (let j = i + 1; j < month.length; j++) {
      const [a, b] = month[i].days.size <= month[j].days.size ? [month[i], month[j]] : [month[j], month[i]];
      const shared = [...a.days].filter(d => b.days.has(d)).length;
      if (shared >= 3 && shared / a.days.size >= 0.6 && (!pair || shared > pair.shared)) pair = { a, b, shared };
    }
    if (pair) out.push({ kind: 'together', icon: 'link', label: `${pair.a.name} and ${pair.b.name.toLowerCase()}`, text: 'Often on the same days', sub: `On ${pair.shared === pair.a.days.size ? `all ${pair.shared}` : `${pair.shared} of the ${pair.a.days.size}`} days with ${pair.a.name.toLowerCase()} this month` });

    // Good days, noticed when there are some.
    const goodNow = dayMoods(user, w1, today).filter(m => m === 'good').length, goodBefore = dayMoods(user, w0, lastWeekEnd).filter(m => m === 'good').length;
    if (goodNow >= 2) out.push({ kind: 'good', icon: 'sun', label: 'Good days', text: `${plural(goodNow, 'good day')} this week`, sub: goodBefore && goodNow > goodBefore ? `Up from ${goodBefore} last week` : goodBefore ? `${goodBefore} last week` : 'From your check-ins' });

    const cyc = cycleInfo(user, today);
    if (cyc && cyc.day <= 120) {
      const text = cyc.usual && cyc.day > cyc.usual + 7 ? `Day ${cyc.day}, longer than your usual ${cyc.usual}` : `Day ${cyc.day} of your cycle`;
      const sub = cyc.usual && cyc.day > cyc.usual + 7 ? 'Cycle length often changes in perimenopause' : cyc.usual ? `Your recent cycles were about ${cyc.usual} days` : 'Since your last period';
      out.push({ kind: 'cycle', icon: 'drop', label: 'Cycle', text, sub });
    }

    if (two[1] && out.length < 3) { const t = trend(two[1]); if (t) out.push(t); }
    return out.slice(0, 3);
  }

  // How close they are to their first highlight, for the empty state.
  function progress(user, today) { const n = loggedDays(user, today, 14).size; return { have: Math.min(n, NEED_DAYS), need: NEED_DAYS }; }

  // What they can pin: "mood" plus every symptom from the last 60 days, most frequent first.
  function pinChoices(user, today) {
    const list = [...bySymptom(user, addDays(today, -59), today).values()].sort((a, b) => b.days.size - a.days.size).map(e => ({ key: e.key, label: e.name }));
    return [{ key: 'mood', label: 'Mood' }, ...list];
  }
  // Their pins, or sensible defaults: their most frequent symptom and mood.
  function pins(user, today) {
    const saved = Array.isArray(user.profile && user.profile.pinned) ? user.profile.pinned.map(key).filter(Boolean) : null;
    if (saved && saved.length) return saved.slice(0, 2);
    const choices = pinChoices(user, today), def = [];
    if (choices[1]) def.push(choices[1].key);
    if ((user.checkins || []).length || !def.length) def.push('mood');
    return def.slice(0, 2);
  }

  // One tile per pin: { key, label, big, unit, sub, tone: 'good' | '' }.
  function pinnedTiles(user, today) {
    const w1 = addDays(today, -6), w0 = addDays(today, -13), lastWeekEnd = addDays(today, -7);
    const all = bySymptom(user, w0, today);
    return pins(user, today).map(k => {
      if (k === 'mood') {
        const v = dayMoods(user, w1, today), n = m => v.filter(x => x === m).length;
        if (!v.length) return { key: k, label: 'Mood', big: '–', unit: '', sub: 'No check-ins this week', tone: '' };
        const top = ['good', 'okay', 'rough'].sort((a, b) => n(b) - n(a))[0];
        const parts = [n('good') && `${n('good')} good`, n('okay') && `${n('okay')} okay`, n('rough') && `${n('rough')} rough`].filter(Boolean);
        return { key: k, label: 'Mood', big: cap(top), unit: '', sub: `${parts.join(', ')} this week`, tone: '' };
      }
      const e = all.get(k), label = e ? e.name : cap(k);
      if (!e) return { key: k, label, big: '0', unit: 'days', sub: 'Not in the last 2 weeks', tone: 'good' };
      const a = avgSev(e, w1, today), b = avgSev(e, w0, lastWeekEnd), now = daysIn(e, w1, today), before = daysIn(e, w0, lastWeekEnd);
      if (!now) return { key: k, label, big: '0', unit: 'days', sub: `None this week, ${before} last week`, tone: 'good' };
      if (a == null) return { key: k, label, big: String(now), unit: now === 1 ? 'day' : 'days', sub: before ? `${before} last week` : 'This week', tone: now < before ? 'good' : '' };
      const sub = b == null ? plural(now, 'day') + ' this week' : a < b ? `Down from ${b}` : a > b ? `Up from ${b}` : 'Same as last week';
      return { key: k, label, big: String(a), unit: '/10 avg', sub, tone: b != null && a < b ? 'good' : '' };
    });
  }

  // The month view: weeks starting Sunday, each day { date, n, sev (0-5), period, today, out, future }.
  function monthCells(user, month, today) {
    const [y, m] = month.split('-').map(Number);
    const first = `${month}-01`, startDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const sev = {}, logged = new Set(), starts = new Set((user.cycleStarts || []).map(c => c.date));
    for (const s of user.symptoms || []) { logged.add(s.date); sev[s.date] = Math.max(sev[s.date] || 0, Number(s.severity) || 3); }
    for (const c of user.checkins || []) logged.add(c.date);
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let i = 0; i < daysInMonth; i++) {
      const d = addDays(first, i);
      cells.push({ date: d, n: i + 1, sev: sev[d] ? Math.min(5, Math.ceil(sev[d] / 2)) : 0, logged: logged.has(d), period: starts.has(d), today: d === today, future: d > today });
    }
    while (cells.length % 7) cells.push(null);
    return cells;
  }

  globalThis.CuraDash = { moodOf, highlights, progress, pinChoices, pins, pinnedTiles, monthCells, cycleInfo, addDays };
})();
