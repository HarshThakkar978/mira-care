// Tests the community's pure logic and Cura's idea card (free, offline).
// Run: /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m dev/community-logic.test.mjs
import { circleAccess, circleInvite, canonSymptom, checkGrouping, ideasFor, addToPlan, recordOutcome, buildIcs, welcomeText, tipStats, uniqueAlias, symptomStats, utf8Len } from '../api/_lib/community-logic.js';
import { handleIncoming, freshUser, normalizeUser, mergeUsers } from '../api/_lib/mira.js';
import { visitNudge, recapData, tipNews, recapText } from '../api/_lib/nudges.js';

const log = (...a) => (globalThis.print || console.log)(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
let fail = 0;
const check = (c, msg) => { if (!c) { fail++; log('FAIL', msg); } else log('ok', msg); };
const today = '2026-10-27';

(async () => {
  // Symptom names
  check(canonSymptom('Heat flashes') === 'hot flashes', 'heat flashes → hot flashes');
  check(canonSymptom('waking up drenched') === 'night sweats', 'waking up drenched → night sweats');
  check(canonSymptom("can't sleep") === 'trouble sleeping', "can't sleep → trouble sleeping");
  check(canonSymptom('crazy cramps') === 'cramps', 'crazy cramps → cramps');
  check(canonSymptom('Eye  twitch') === 'eye twitch', 'unknown symptoms keep their own name');

  // Grouping rules
  const ids = ['m1', 'm2', 'm3', 'm4'];
  check(checkGrouping({ groups: [{ id: 'g1', name: 'All', focus: 'x', members: ids }] }, ['g1'], ids)?.[0].id === 'g1', 'one group for a small community keeps its id');
  check(checkGrouping({ groups: [{ id: 'g1', members: ['m1', 'm2'] }, { id: 'new', members: ['m3', 'm4'] }] }, ['g1'], ids) === null, 'no split below 6 members');
  check(checkGrouping({ groups: [{ id: 'g1', members: ['m1', 'm2', 'm3'] }] }, ['g1'], ids) === null, 'everyone must be placed');
  check(checkGrouping({ groups: [{ id: 'g1', members: ['m1', 'm2', 'm3', 'm4', 'm4'] }] }, ['g1'], ids) === null, 'nobody twice');
  check(checkGrouping({ groups: [{ id: 'g1', members: ['m1', 'm2', 'm3', 'zz'] }] }, ['g1'], ids) === null, 'unknown members rejected');
  const six = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  const split = checkGrouping({ groups: [{ id: 'g1', name: 'Sleep', members: ['m1', 'm2', 'm3'] }, { id: 'new', name: 'Mood', members: ['m4', 'm5', 'm6'] }] }, ['g1'], six);
  check(split && split.length === 2 && split[0].id === 'g1' && split[1].id === null, 'split into two groups of three, new group gets no id');
  check(checkGrouping({ groups: [{ id: 'g1', members: ['m1', 'm2', 'm3', 'm4', 'm5'] }, { id: 'new', members: ['m6'] }] }, ['g1'], six) === null, 'no group of one');

  // Ideas for a person
  const user = normalizeUser(freshUser());
  user.symptoms = [{ id: 'a', date: '2026-10-26', name: 'night sweats', severity: 7 }, { id: 'b', date: '2026-10-24', name: 'woke up soaked', severity: 6 }];
  user.community.focus = ['Night sweats'];
  const tips = [
    { id: 't1', status: 'approved', symptom: 'night sweats', title: 'Keep a fan by your bed', when: 'bedtime', kind: 'everyday', author: 'x', howWell: 'a_lot', reports: [{ key: 'y', howWell: 'some' }], outcomes: [{ key: 'z', howWell: 'a_lot' }, { key: 'w', howWell: 'not_much' }] },
    { id: 't2', status: 'approved', symptom: 'anxiety', title: 'Try box breathing', when: 'anytime', kind: 'everyday', reports: [], outcomes: [] },
    { id: 't3', status: 'pending', symptom: 'night sweats', title: 'Pending one', reports: [], outcomes: [] },
    { id: 't4', status: 'approved', symptom: 'night sweats', title: 'Cotton sheets', when: 'bedtime', kind: 'everyday', reports: [], outcomes: [] }
  ];
  let ideas = ideasFor(user, tips, today);
  check(ideas[0].id === 't1' && ideas[0].match && ideas[0].personal.includes('2 of the last 14 days'), 'matching, most-helped idea first with a personal line');
  check(!ideas.some(i => i.id === 't3'), 'pending tips are never shown');
  check(ideas.find(i => i.id === 't2') && !ideas.find(i => i.id === 't2').match, 'other ideas come after, marked as not matched');
  check(!('author' in ideas[0]) && !('reports' in ideas[0]), 'cards never say who shared a tip');
  const st = tipStats(tips[0]);
  check(st.shared === 2 && st.tried === 2 && st.helped === 1, 'stats: shared by 2, 1 of 2 who tried it helped');
  user.community.hidden = ['t4'];
  check(!ideasFor(user, tips, today).some(i => i.id === 't4'), '"Not now" hides an idea');

  // Plan
  const item = addToPlan(user, tips[0], today, 'p1');
  check(item && item.checkOn === '2026-11-03' && item.when === 'bedtime', 'added to plan with a one-week check-in');
  check(addToPlan(user, tips[0], today, 'p2') === null, 'not added twice');
  check(!ideasFor(user, tips, today).some(i => i.id === 't1'), 'ideas already in the plan are not offered');
  user.profile.appointmentDate = '2026-11-05'; user.profile.clinician = 'Dr. Patel, MD';
  let ics = buildIcs(user, { host: 'curadaily.vercel.app', now: new Date('2026-10-27T15:00:00Z') });
  check(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'), 'calendar file uses CRLF lines');
  check(ics.includes('DTSTART:20261027T213000') && ics.includes('RRULE:FREQ=DAILY;COUNT=7'), 'plan item is a daily bedtime event for a week');
  check(ics.includes('UID:check-p1@') && ics.includes('DTSTART:20261103T190000'), 'one-week check-in event');
  check(ics.includes('DTSTART;VALUE=DATE:20261105') && ics.includes('Dr. Patel\\, MD'), 'appointment with escaped comma');
  check(ics.split('\r\n').every(l => utf8Len(l) <= 75) && ics.includes('\r\n '), 'long lines are folded');
  recordOutcome(item, 'a_lot');
  ics = buildIcs(user, { host: 'h', now: new Date() });
  check(item.kept && ics.includes('RRULE:FREQ=DAILY\r\n') && !ics.includes('UID:check-p1@'), 'helped: kept as an ongoing habit, no more check-in');
  recordOutcome(item, 'not_much');
  check(item.status === 'stopped' && !buildIcs(user, { host: 'h' }).includes('UID:plan-p1@'), 'not helped: off the plan and calendar');

  // Small things
  check(welcomeText('Wren', ['Night sweats', 'Trouble sleeping']) === "Say hi to Wren 💚 Wren's here to talk about night sweats and trouble sleeping. Has anyone found something that helps?", 'welcome message');
  check(uniqueAlias(new Set(['Willow']), 'Willow', () => 0) === 'Juniper', 'alias changes when taken');
  check(symptomStats(user, today)[0].name === 'night sweats' && symptomStats(user, today)[0].days === 2, 'stats merge different wordings');
  const old = normalizeUser({ profile: { name: 'A' } });
  check(old.community.joined === false && Array.isArray(old.plan) && Array.isArray(old.community.focus), 'older records get community fields');

  // Cura's idea card in chat
  const u2 = normalizeUser(freshUser());
  u2.plan = [{ id: 'p', title: 'Keep a fan by your bed', symptom: 'night sweats', when: 'bedtime', start: '2026-10-25', status: 'active', done: [] }];
  let shown = null;
  const seen = [];
  const claude = async params => {
    seen.push(JSON.parse(JSON.stringify(params)));
    if (seen.length === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'i1', name: 'suggest_idea', input: { tip_id: 't9' } }, { type: 'tool_use', id: 'i2', name: 'suggest_idea', input: { tip_id: 'nope' } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'A few members found cotton sheets help.' }] };
  };
  await handleIncoming(u2, 'night sweats again', today, { model: 'm', effort: 'low', channel: 'app', claude, note: '<community_ideas>\n- id=t9 "Cotton sheets"\n</community_ideas>', ideas: [{ id: 't9', title: 'Cotton sheets' }], onIdea: i => { shown = i; } });
  check(shown && shown.id === 't9', 'valid idea id shows the card');
  const results = seen[1].messages[seen[1].messages.length - 1].content;
  check(results[1].is_error === true, 'unknown idea id returns an error to Claude');
  check(seen[0].tools.some(t => t.name === 'suggest_idea'), 'idea tool offered in the app');
  check(seen[0].messages[0].content.includes('<community_ideas>') && seen[0].messages[0].content.includes('"Keep a fan by your bed" for night sweats (bedtime, day 3 of 7)'), 'context has community ideas and the plan');

  // The Circle opens after 3 check-in days, or early when the team opens it
  const fresh = normalizeUser(freshUser());
  fresh.checkins = [{ date: '2026-10-25' }, { date: '2026-10-26' }];
  check(!circleAccess(fresh, {}), 'closed with 2 check-in days');
  check(circleAccess(fresh, { circleOpen: true }), 'open for everyone while testing');
  check(circleAccess({ ...fresh, circleEarly: true }, {}), 'open early for one person');
  fresh.symptoms = [{ date: '2026-10-27', name: 'x' }];
  check(circleAccess(fresh, {}) && circleInvite(fresh, {}).cta.route === 'community', 'opens on the 3rd day with an invite');
  check(circleInvite(fresh, {}) === null, 'invited only once');

  // Cura's own messages around a visit, and the Sunday recap
  const v = normalizeUser({ profile: { name: 'A', appointmentDate: '2026-11-03', clinician: 'Dr. Lee' } });
  const n1 = visitNudge(v, '2026-10-27');
  check(n1 && n1.cta.action === 'draft-agenda' && n1.text.includes('a week away') && n1.text.includes('Dr. Lee'), 'a week before: agenda nudge');
  check(visitNudge(v, '2026-10-28') === null, 'agenda nudge only once');
  check(visitNudge(v, '2026-11-02').cta.route === 'report', 'day before: summary');
  const after = visitNudge(v, '2026-11-04');
  check(after && after.ui.options.length === 3 && after.note.includes('add_after_visit_note'), 'day after: how did it go, with a note for Cura');
  check(visitNudge(v, '2026-11-20') === null, 'nothing long after');
  check(recapData(normalizeUser({ checkins: [{ date: '2026-10-25', feeling: 'ok' }] }), '2026-10-25') === null, 'no recap with one day of entries');
  const rd = recapData(normalizeUser({ checkins: [{ date: '2026-10-21', feeling: 'ok' }], symptoms: [{ date: '2026-10-24', name: 'night sweats', severity: 7 }] }), '2026-10-25');
  check(rd && rd.days_checked_in === 2 && rd.symptoms[0].severity === 7, 'recap data from the last 7 days');
  const news = tipNews('me', [{ author: 'me', status: 'approved', title: 'Fan by the bed', adds: [{ key: 'a', at: '2026-10-24T10:00:00Z' }, { key: 'b', at: '2026-10-25T10:00:00Z' }, { key: 'a', at: '2026-10-25T11:00:00Z' }, { key: 'c', at: '2026-10-01T10:00:00Z' }] }], '2026-10-25');
  check(news.startsWith('2 people in the Circle added your tip "Fan by the bed"'), 'tip news counts people this week');
  check(recapText({ most_common: 'x', best_day: 'y', noticed: 'z' }, news).split('\n').length === 6, 'recap text has 3 lines plus tip news');

  // Signing in on a phone that had its own notes
  const acct = normalizeUser({ profile: { name: 'Ana', appointmentDate: '', clinician: '' }, symptoms: [{ id: 's1', date: '2026-10-20', name: 'cramps' }], cycleStarts: [{ id: 'c1', date: '2026-10-01' }], transcript: [{ from: 'you', text: 'hi', at: '2026-10-20T10:00:00Z' }] });
  const phone = normalizeUser({ profile: { name: 'A', appointmentDate: '2026-11-05', clinician: '' }, symptoms: [{ id: 's1', date: '2026-10-20', name: 'cramps' }, { id: 's2', date: '2026-10-26', name: 'night sweats' }], cycleStarts: [{ id: 'x', date: '2026-10-01' }, { id: 'c2', date: '2026-10-25' }], transcript: [{ from: 'you', text: 'later', at: '2026-10-26T10:00:00Z' }, { from: 'you', text: 'hi', at: '2026-10-20T10:00:00Z' }] });
  mergeUsers(acct, phone);
  check(acct.symptoms.length === 2 && acct.cycleStarts.length === 2, 'merge keeps both sets of entries without duplicates');
  check(acct.transcript.length === 2 && acct.transcript[1].text === 'later', 'merged chat is in time order');
  check(acct.profile.name === 'Ana' && acct.profile.appointmentDate === '2026-11-05', "account's name wins, empty fields filled from the phone");

  log(fail ? `${fail} FAILED` : 'ALL PASSED');
})().catch(e => log('CRASH', String(e), e.stack));
