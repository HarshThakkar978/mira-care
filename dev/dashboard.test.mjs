// Tests for the Today dashboard's numbers (dashboard.js). Run: jsc -m dashboard.test.mjs (or node).
import '../dashboard.js';
const D = globalThis.CuraDash;
let failed = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { failed++; (globalThis.print || console.log)(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); } };
const T = '2026-11-22';
const ago = n => D.addDays(T, -n);
const sym = (name, n, severity) => ({ id: name + n, name, date: ago(n), severity });
const user = o => ({ profile: {}, symptoms: [], checkins: [], cycleStarts: [], ...o });

// Moods from free text
eq('mood good', D.moodOf('Feeling good today'), 'good');
eq('mood rough', D.moodOf('bad day'), 'rough');
eq('mood tired but okay', D.moodOf('tired but okay'), 'okay');
eq('mood not great', D.moodOf('not great'), 'rough');
eq('mood Meh', D.moodOf('Meh'), 'okay');
eq('mood empty', D.moodOf(''), '');

// Nothing logged: no highlights, progress 0 of 3
eq('empty highlights', D.highlights(user({}), T), []);
eq('empty progress', D.progress(user({}), T), { have: 0, need: 3 });

// Trend: hot flashes 2 days this week (avg 5), 4 days last week (avg 7)
const hf = user({ symptoms: [sym('hot flashes', 1, 5), sym('hot flashes', 3, 5), sym('hot flashes', 8, 7), sym('hot flashes', 9, 7), sym('hot flashes', 10, 7), sym('Hot flashes', 12, 7)] });
const h = D.highlights(hf, T);
eq('trend text', h[0].text, '2 days this week, down from 4');
eq('trend sub', h[0].sub, 'Average strength 5/10, down from 7');
eq('trend label', h[0].label, 'Hot flashes');
eq('trend bars', h[0].bars.length, 14);
eq('trend bar today', h[0].bars[13], { date: T, v: 0 });
eq('trend eased', h[0].eased, true);

// Together: poor sleep on 4 of 5 hot-flash days
const tog = user({ symptoms: [1, 3, 5, 7, 9].map(n => sym('hot flashes', n, 6)).concat([1, 3, 5, 7, 20].map(n => sym('poor sleep', n, 6))) });
const t = D.highlights(tog, T).find(x => x.kind === 'together');
eq('together sub', t && t.sub, 'On 4 of the 5 days with hot flashes this month');
// Not enough overlap: no "together"
const apart = user({ symptoms: [1, 3, 5].map(n => sym('headache', n, 4)).concat([2, 4, 6].map(n => sym('fatigue', n, 4))) });
eq('no together', D.highlights(apart, T).some(x => x.kind === 'together'), false);

// Good days
const good = user({ checkins: [{ date: ago(0), feeling: 'Good' }, { date: ago(2), feeling: 'great' }, { date: ago(3), feeling: 'rough' }, { date: ago(9), feeling: 'good' }] });
const g = D.highlights(good, T).find(x => x.kind === 'good');
eq('good text', g && g.text, '2 good days this week');
eq('good sub', g && g.sub, 'Up from 1 last week');

// Cycle: usual 28, now day 40
const cyc = user({ cycleStarts: [{ date: ago(95) }, { date: ago(67) }, { date: ago(39) }] });
const c = D.highlights(cyc, T).find(x => x.kind === 'cycle');
eq('cycle long', c && c.text, 'Day 40, longer than your usual 28');
const cyc2 = user({ cycleStarts: [{ date: ago(4) }] });
eq('cycle first', D.highlights(cyc2, T)[0].text, 'Day 5 of your cycle');

// At most 3 highlights
const lots = user({ symptoms: tog.symptoms.concat(hf.symptoms), checkins: good.checkins, cycleStarts: cyc.cycleStarts });
eq('max 3', D.highlights(lots, T).length, 3);

// Pins: defaults, saved, tiles
eq('default pins', D.pins(hf, T), ['hot flashes']);
eq('default pins with mood', D.pins(user({ ...hf, checkins: good.checkins }), T), ['hot flashes', 'mood']);
eq('saved pins', D.pins(user({ ...hf, profile: { pinned: ['Mood'] } }), T), ['mood']);
const tiles = D.pinnedTiles(user({ ...hf, checkins: good.checkins, profile: { pinned: ['hot flashes', 'mood'] } }), T);
eq('tile symptom', tiles[0], { key: 'hot flashes', label: 'Hot flashes', big: '5', unit: '/10 avg', sub: 'Down from 7', tone: 'good' });
eq('tile mood', tiles[1], { key: 'mood', label: 'Mood', big: 'Good', unit: '', sub: '2 good, 1 rough this week', tone: '' });
eq('tile gone', D.pinnedTiles(user({ profile: { pinned: ['cramps'] } }), T)[0].sub, 'Not in the last 2 weeks');
eq('choices', D.pinChoices(hf, T).map(x => x.key), ['mood', 'hot flashes']);

// Month view: Nov 2026 starts on a Sunday, 30 days, padded to whole weeks
const cells = D.monthCells(user({ symptoms: [sym('cramps', 0, 9)], cycleStarts: [{ date: '2026-11-03' }] }), '2026-11', T);
eq('month length', cells.length % 7, 0);
eq('month first', cells[0].date, '2026-11-01');
eq('month today', cells.find(x => x && x.today), { date: T, n: 22, sev: 5, logged: true, period: false, today: true, future: false });
eq('month period', cells.find(x => x && x.date === '2026-11-03').period, true);
eq('month future', cells.find(x => x && x.date === '2026-11-25').future, true);
const dec = D.monthCells(user({}), '2026-12', T);
eq('dec pad', dec.slice(0, 2), [null, null]); // Dec 1 2026 is a Tuesday

(globalThis.print || console.log)(failed ? `${failed} FAILED` : 'ALL PASSED');
