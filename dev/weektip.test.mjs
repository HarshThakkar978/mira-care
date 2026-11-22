// Tests for "For you this week" (api/_lib/weektip.js) without calling the AI. Run: jsc -m weektip.test.mjs
import { cleanTip, tipFresh, tipInput, tipPrompt } from '../api/_lib/weektip.js';
let failed = 0;
const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; (globalThis.print || console.log)(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); } };

// Only tips with a known source get through
eq('no source', cleanTip({ title: 'x', tip: 'Try this.', source_id: 'none' }), null);
eq('made-up source', cleanTip({ title: 'x', tip: 'Try this.', source_id: 'webmd' }), null);
eq('empty tip', cleanTip({ title: 'x', tip: ' ', source_id: 'nhs_insomnia' }), null);
eq('too long', cleanTip({ title: 'x', tip: 'word '.repeat(60), source_id: 'nhs_insomnia' }), null);
const ok = cleanTip({ title: 'For your 3am wake-ups', tip: 'Keep  the same wake-up time.', source_id: 'nhs_insomnia' });
eq('good tip', ok, { title: 'For your 3am wake-ups', text: 'Keep the same wake-up time.', source: { site: 'NHS', title: 'Insomnia', url: 'https://www.nhs.uk/conditions/insomnia/' } });
eq('default title', cleanTip({ title: '', tip: 'Hi.', source_id: 'nhs_insomnia' }).title, 'An idea for you');

// Kept for a week while nothing changes; remade at most once a day
eq('same day', tipFresh({ date: '2026-11-22', sig: 'a' }, 'b', '2026-11-22'), true);
eq('same data 6 days', tipFresh({ date: '2026-11-16', sig: 'a' }, 'a', '2026-11-22'), true);
eq('same data 7 days', tipFresh({ date: '2026-11-15', sig: 'a' }, 'a', '2026-11-22'), false);
eq('new data next day', tipFresh({ date: '2026-11-21', sig: 'a' }, 'b', '2026-11-22'), false);
eq('none cached', tipFresh(undefined, 'a', '2026-11-22'), false);

// Needs a few entries; uses the last 14 days only
const u = { symptoms: [{ id: 1, date: '2026-11-21', name: 'hot flashes', severity: 6 }, { id: 2, date: '2026-11-01', name: 'old', severity: 3 }], checkins: [{ id: 3, date: '2026-11-20', feeling: 'tired' }], cycleStarts: [], plan: [], story: { fields: {} } };
const inp = tipInput(u, '2026-11-22');
eq('not enough', inp.enough, false);
eq('window', inp.data.symptoms.map(s => s.name), ['hot flashes']);
const more = tipInput({ ...u, checkins: [...u.checkins, { id: 4, date: '2026-11-22', feeling: 'low' }] }, '2026-11-22');
eq('enough', more.enough, true);
eq('prompt has data', tipPrompt(more).includes('"hot flashes"'), true);
eq('prompt lists sources', tipPrompt(more).includes('nhs_insomnia:'), true);

(globalThis.print || console.log)(failed ? `${failed} FAILED` : 'ALL PASSED');
