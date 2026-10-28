// Pure helpers for Cura's community (no database, no Claude), so they can be tested offline.
// Groups, tips and plans are plain objects; community.js loads and saves them.

export const MIN_GROUP = 3;          // smallest group once there are enough people to split
export const ONE_GROUP_BELOW = 6;    // fewer members than this: everyone stays in one group
export const MAX_GROUP_HARD = 20;    // a grouping with a bigger group is rejected
export const HOW_WELL = ['a_lot', 'some', 'not_much', 'made_worse', 'unclear'];
export const WHEN = ['morning', 'midday', 'evening', 'bedtime', 'anytime'];
export const TIP_ANSWERS = ['Helped a lot', 'Helped a little', 'Not really'];
export const ANSWER_HOW = { 'helped a lot': 'a_lot', 'helped a little': 'some', 'a little': 'some', 'not really': 'not_much' };
export const ALIASES = ['Willow', 'Juniper', 'Sage', 'Fern', 'Maple', 'Hazel', 'Ivy', 'Rowan', 'Aspen', 'Clover', 'Birch', 'Wren', 'Linden', 'Laurel', 'Marigold', 'Poppy', 'Iris', 'Olive', 'Briar', 'Heather', 'Saffron', 'Yarrow', 'Sorrel', 'Tansy'];

// The Circle opens once someone has checked in on 3 different days, so Cura knows what to match them on.
// The team can open it early for one person (circleEarly) or for everyone while testing.
export const CIRCLE_DAYS = 3;
export const checkinDays = user => new Set([...(user.checkins || []), ...(user.symptoms || [])].map(x => x.date).filter(Boolean)).size;
export const circleAccess = (user, settings = {}) => !!(user.community && user.community.joined) || !!settings.circleOpen || !!user.circleEarly || checkinDays(user) >= CIRCLE_DAYS;
// Cura's one-time invitation in chat, the first time the Circle opens for them.
export function circleInvite(user, settings) {
  if (user.circleInvited || (user.community && user.community.joined) || !circleAccess(user, settings)) return null;
  user.circleInvited = true;
  return { from: 'mira', text: 'By the way, people with symptoms like yours are swapping tips in the Cura Circle. Want to take a peek? 💜', at: new Date().toISOString(), cta: { label: 'Peek at the Circle', route: 'community' } };
}

export const freshCommunity = () => ({ joined: false, anonymous: false, alias: '', focus: [], groupId: '', joinedAt: '', reason: '', notice: null, hidden: [] });

export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);

// People describe the same symptom many ways; matching groups and tips works on one common name.
const SYNONYMS = [
  ['night sweats', /night sweat|sweat\w* (at|in the|during the) night|(wak|woke)\w* (up )?(hot|sweaty|drenched|soaked)/],
  ['hot flashes', /hot fl[au]sh|heat fl[au]sh|\bflush|overheat|hot spell|heat wave/],
  ['trouble sleeping', /sleep|insomnia|(wak(e|ing)|woke) up|restless night/],
  ['fatigue', /fatigue|tired|exhaust|no energy|low energy|drained|worn out/],
  ['brain fog', /brain fog|foggy|forget|memory|concentrat|focus/],
  ['anxiety', /anxi|panic|nervous|worr/],
  ['low mood', /low mood|depress|\bsad|feeling down|tearful|crying/],
  ['mood swings', /mood|irritab|angry|rage|snappy/],
  ['headaches', /headache|migraine/],
  ['joint pain', /joint|\baches?\b|stiff|arthrit/],
  ['cramps', /cramp/],
  ['heavy periods', /heav(y|ier) (flow|period|bleed)|flooding|clots/],
  ['irregular periods', /irregular|spotting|missed period|late period|period came early/],
  ['bloating', /bloat/],
  ['palpitations', /palpitation|heart rac|racing heart|heart pound/],
  ['vaginal dryness', /vaginal|dryness down/],
  ['low libido', /libido|sex drive/],
  ['dizziness', /dizz|lightheaded/],
  ['weight changes', /weight/],
  ['skin and hair changes', /dry skin|\bitch|hair (loss|thinning)|acne/]
];
export function canonSymptom(name) {
  const s = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return '';
  for (const [canon, re] of SYNONYMS) if (s === canon || re.test(s)) return canon;
  return s.slice(0, 40);
}

// What someone has logged lately, by common symptom name: days noticed, average and peak intensity.
export function symptomStats(user, todayStr, days = 30) {
  const since = addDays(todayStr, -days + 1);
  const map = new Map();
  for (const s of user.symptoms || []) {
    if (!s.date || s.date < since || s.date > todayStr) continue;
    const k = canonSymptom(s.name); if (!k) continue;
    const e = map.get(k) || { days: new Set(), sev: [] };
    e.days.add(s.date); if (Number(s.severity)) e.sev.push(Number(s.severity));
    map.set(k, e);
  }
  return [...map.entries()].map(([name, e]) => ({
    name, days: e.days.size,
    avg: e.sev.length ? Math.round(e.sev.reduce((a, b) => a + b, 0) / e.sev.length * 10) / 10 : null,
    peak: e.sev.length ? Math.max(...e.sev) : null
  })).sort((a, b) => b.days - a.days).slice(0, 8);
}

// The anonymous summary Claude sees when sorting someone into a group.
export const memberProfile = (user, todayStr) => ({
  focus: (user.community.focus || []).map(canonSymptom),
  last_30_days: symptomStats(user, todayStr)
});

// What a group has in common: how many members have each symptom and how strong it's been.
export function groupSummary(group, usersByKey, todayStr) {
  const map = new Map();
  for (const m of group.members) {
    const u = usersByKey.get(m.key); if (!u) continue;
    const stats = symptomStats(u, todayStr);
    const names = new Set([...(u.community.focus || []).map(canonSymptom), ...stats.map(s => s.name)]);
    for (const n of names) {
      const e = map.get(n) || { members: 0, sev: [] };
      e.members++;
      const st = stats.find(s => s.name === n); if (st && st.avg) e.sev.push(st.avg);
      map.set(n, e);
    }
  }
  return [...map.entries()].map(([name, e]) => ({ name, members: e.members, avg: e.sev.length ? Math.round(e.sev.reduce((a, b) => a + b, 0) / e.sev.length * 10) / 10 : null }))
    .sort((a, b) => b.members - a.members).slice(0, 6);
}

// Fallback when Claude can't be reached: the group sharing the most of this person's symptoms.
export function nearestGroup(user, groups, summaries, todayStr) {
  const mine = new Set([...(user.community.focus || []).map(canonSymptom), ...symptomStats(user, todayStr).map(s => s.name)]);
  let best = groups[0], bestScore = -1;
  groups.forEach((g, i) => {
    const score = (summaries[i] || []).reduce((n, s) => n + (mine.has(s.name) ? s.members : 0), 0) - g.members.length * 0.01;
    if (score > bestScore) { best = g; bestScore = score; }
  });
  return best;
}

// Checks Claude's proposed grouping. Returns [{id|null, name, focus, members}] or null if it breaks a rule,
// in which case nothing changes. memberIds are the short ids ("m1"…) Claude was shown.
export function checkGrouping(proposal, existingIds, memberIds) {
  if (!proposal || !Array.isArray(proposal.groups) || !proposal.groups.length) return null;
  const all = new Set(memberIds), seen = new Set(), used = new Set();
  const out = [];
  for (const g of proposal.groups) {
    const members = Array.isArray(g.members) ? g.members : [];
    for (const m of members) { if (!all.has(m) || seen.has(m)) return null; seen.add(m); }
    if (!members.length) continue;
    const id = existingIds.includes(g.id) && !used.has(g.id) ? g.id : null;
    if (id) used.add(id);
    out.push({ id, name: String(g.name || '').trim().slice(0, 40) || 'Cura group', focus: String(g.focus || '').trim().slice(0, 160), members });
  }
  if (seen.size !== all.size) return null;
  if (all.size < ONE_GROUP_BELOW) return out.length === 1 ? out : null;
  if (out.some(g => g.members.length < MIN_GROUP || g.members.length > MAX_GROUP_HARD)) return null;
  return out;
}

export function uniqueAlias(taken, current, rand = Math.random) {
  if (current && !taken.has(current)) return current;
  const free = ALIASES.filter(a => !taken.has(a));
  if (free.length) return free[Math.floor(rand() * free.length)];
  for (let n = 2; ; n++) { const a = `${ALIASES[Math.floor(rand() * ALIASES.length)]} ${n}`; if (!taken.has(a)) return a; }
}

const listJoin = items => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
export function welcomeText(name, focus) {
  const f = (focus || []).map(x => String(x).toLowerCase()).slice(0, 3);
  return `Say hi to ${name} 💚 ${f.length ? `${name}'s here to talk about ${listJoin(f)}. ` : ''}Has anyone found something that helps?`;
}

// ---------- Tips and ideas ----------
const positive = h => h === 'a_lot' || h === 'some';
export function tipStats(t) {
  const sharers = new Set([...(positive(t.howWell) || t.howWell === 'unclear' ? [t.author] : []), ...(t.reports || []).filter(r => positive(r.howWell)).map(r => r.key)].filter(Boolean));
  const outcomes = t.outcomes || [];
  return { shared: sharers.size, tried: outcomes.length, helped: outcomes.filter(o => positive(o.howWell)).length, added: t.added || 0 };
}

function personalLine(user, symptom, todayStr) {
  const since = addDays(todayStr, -13);
  const days = new Set((user.symptoms || []).filter(s => s.date >= since && s.date <= todayStr && canonSymptom(s.name) === symptom).map(s => s.date)).size;
  if (days) return `You've logged ${symptom} on ${days} of the last 14 days.`;
  return (user.community.focus || []).some(f => canonSymptom(f) === symptom) ? `You picked ${symptom} to talk about.` : '';
}

// What the app shows for one tip. Never includes who shared it.
export function tipCard(t, user, todayStr) {
  return { id: t.id, title: t.title, symptom: t.symptom, why: t.why || '', details: t.details || '', when: t.when, kind: t.kind, team: t.source === 'team', stats: tipStats(t), personal: personalLine(user, t.symptom, todayStr) };
}

// Approved tips ranked for this person: their chosen symptoms first, then what they log most, then what helped most people.
export function ideasFor(user, tips, todayStr) {
  const weight = new Map();
  for (const f of user.community.focus || []) { const k = canonSymptom(f); weight.set(k, (weight.get(k) || 0) + 5); }
  for (const s of symptomStats(user, todayStr)) weight.set(s.name, (weight.get(s.name) || 0) + s.days);
  const skip = new Set([...(user.plan || []).filter(p => p.status !== 'removed').map(p => p.tipId), ...(user.community.hidden || [])]);
  const score = t => { const s = tipStats(t); return s.helped * 2 + s.shared - (s.tried - s.helped); };
  const open = tips.filter(t => t.status === 'approved' && !skip.has(t.id));
  const matched = open.filter(t => weight.get(t.symptom)).sort((a, b) => weight.get(b.symptom) - weight.get(a.symptom) || score(b) - score(a));
  const others = open.filter(t => !weight.get(t.symptom)).sort((a, b) => score(b) - score(a)).slice(0, matched.length ? 2 : 5);
  return [...matched, ...others].slice(0, 12).map(t => ({ ...tipCard(t, user, todayStr), match: !!weight.get(t.symptom) }));
}

// ---------- Daily plan ----------
export function addToPlan(user, tip, todayStr, id) {
  if ((user.plan || []).some(p => p.tipId === tip.id && p.status === 'active')) return null;
  const item = { id, tipId: tip.id, title: tip.title, symptom: tip.symptom, why: tip.why || '', when: WHEN.includes(tip.when) ? tip.when : 'anytime', start: todayStr, checkOn: addDays(todayStr, 7), done: [], status: 'active', outcome: '' };
  user.plan = [...(user.plan || []), item].slice(-30);
  return item;
}

// After a week: "helped" keeps it as a daily habit, "not really" takes it off the plan.
export function recordOutcome(item, how) {
  item.outcome = how;
  item.status = positive(how) ? 'active' : 'stopped';
  item.kept = positive(how);
}

// ---------- Calendar (.ics) ----------
const SLOT = { morning: '080000', midday: '123000', evening: '183000', bedtime: '213000' };
const LABEL = { morning: 'Morning', midday: 'Midday', evening: 'Evening', bedtime: 'Bedtime', anytime: 'Any time' };
export const whenLabel = w => LABEL[w] || 'Any time';
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Lines longer than 75 bytes (UTF-8) are folded, as the format requires.
export const utf8Len = str => { let n = 0; for (const ch of str) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };
function fold(line) {
  if (utf8Len(line) <= 75) return line;
  const parts = []; let cur = '', len = 0;
  for (const ch of line) {
    const n = utf8Len(ch);
    if (len + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; len = 0; }
    cur += ch; len += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}
const compact = d => d.replace(/-/g, '');

// The person's subscribed calendar: plan items as daily events (floating local times, so they follow
// the phone's time zone), the one-week "did it help?" check-in, and their next appointment.
export function buildIcs(user, { host, now = new Date() }) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const open = `https://${host}/#today`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cura//Plan//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Cura', 'X-WR-CALDESC:Your Cura plan and appointments', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  const event = fields => lines.push('BEGIN:VEVENT', `DTSTAMP:${stamp}`, ...fields, 'END:VEVENT');
  for (const p of user.plan || []) {
    if (p.status !== 'active') continue;
    const desc = icsText(`For ${p.symptom}.${p.why ? ` Why it may help: ${p.why}` : ''} Tick it off in Cura: ${open}`);
    const repeat = p.kept ? 'RRULE:FREQ=DAILY' : 'RRULE:FREQ=DAILY;COUNT=7';
    const start = SLOT[p.when] ? [`DTSTART:${compact(p.start)}T${SLOT[p.when]}`, 'DURATION:PT15M'] : [`DTSTART;VALUE=DATE:${compact(p.start)}`, 'DURATION:P1D'];
    event([`UID:plan-${p.id}@${host}`, ...start, repeat, `SUMMARY:${icsText('🌿 ' + p.title)}`, `DESCRIPTION:${desc}`, `URL:${open}`]);
    if (!p.outcome) event([`UID:check-${p.id}@${host}`, `DTSTART:${compact(p.checkOn)}T190000`, 'DURATION:PT10M', `SUMMARY:${icsText(`Did "${p.title}" help? Tell Cura`)}`, `DESCRIPTION:${icsText(`You've tried it for a week. Open Cura to say how it went: ${open}`)}`, `URL:${open}`]);
  }
  const appt = user.profile && user.profile.appointmentDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(appt || '')) {
    event([`UID:appt-${appt}@${host}`, `DTSTART;VALUE=DATE:${compact(appt)}`, `DTEND;VALUE=DATE:${compact(addDays(appt, 1))}`, `SUMMARY:${icsText(`Appointment${user.profile.clinician ? ' with ' + user.profile.clinician : ''}`)}`, `DESCRIPTION:${icsText(`Your agenda is ready in Cura: https://${host}/#visit`)}`]);
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
