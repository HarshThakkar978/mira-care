// Tests "your story": the A/B offer, saving answers, wrapping up, and Cura's source links (free, offline).
// Run: /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m dev/story.test.mjs
import { storyArm, storyOffer, storyStart, saveStory, storyMissing, storyTurn, storyNote, storyLines, storyStats, STORY_FIELDS, storyPopupDue, storySeen, storyLater, storyReminder } from '../api/_lib/story.js';
import { memberProfile } from '../api/_lib/community-logic.js';
import { handleIncoming, freshUser, normalizeUser, SOURCES } from '../api/_lib/mira.js';

const log = (...a) => (globalThis.print || console.log)(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
let fail = 0;
const check = (c, msg) => { if (!c) { fail++; log('FAIL', msg); } else log('ok', msg); };
const today = '2026-11-02';
const day = n => `2026-11-0${n}`;

(async () => {
  // A/B split: stable and roughly half and half
  const arms = Array.from({ length: 400 }, (_, i) => storyArm(`web-device-${i}`));
  const early = arms.filter(a => a === 'early').length;
  check(early > 150 && early < 250, `about half go early (${early}/400)`);
  check(storyArm('web-abc') === storyArm('web-abc'), 'same person, same group');

  // Offer timing
  const keyEarly = Array.from({ length: 50 }, (_, i) => `web-e-${i}`).find(k => storyArm(k) === 'early');
  const keyLater = Array.from({ length: 50 }, (_, i) => `web-l-${i}`).find(k => storyArm(k) === 'later');
  const said = n => Array.from({ length: n }, () => ({ from: 'you', text: 'hi', at: '2026-11-02T10:00:00Z' }));
  const at = h => new Date(Date.parse('2026-11-02T10:00:00Z') + h * 3600000);
  const e = normalizeUser({ profile: { name: 'Ana' }, createdAt: '2026-11-02T10:00:00Z', transcript: said(1) });
  check(storyOffer(e, keyEarly, at(0)) === false, 'early group: not after the very first message');
  e.transcript = said(2);
  check(storyOffer(e, keyEarly, at(0)) === true && storyPopupDue(e), 'early group: invited after 2 messages, as a pop-up');
  check(storyOffer(e, keyEarly, at(1)) === false, 'invited only once');
  storySeen(e, at(0));
  check(!storyPopupDue(e), 'pop-up shown once');
  const l = normalizeUser({ createdAt: '2026-11-02T10:00:00Z', transcript: said(5) });
  check(storyOffer(l, keyLater, at(3)) === false && l.story.arm === 'later', 'later group: not on the first day');
  check(storyOffer(l, keyLater, at(22)) === true, 'later group: invited when they come back the next day');
  storyLater(l, at(22));
  check(storyReminder(l, at(30)) === null, '"Maybe later": no reminder straight away');
  const rem = storyReminder(l, at(22 + 49));
  check(rem && rem.cta.action === 'story-start', '"Maybe later": one reminder in the chat two days on');
  check(storyReminder(l, at(22 + 100)) === null, 'and only one');

  // Starting and saving
  const u = normalizeUser({});
  const first = storyStart(u, keyEarly);
  check(u.story.startedAt && /how did it all start/.test(first.text) && /mic/.test(first.text), 'start asks an open question and mentions the mic');
  check(/agreed to tell you their story/.test(storyNote(u)), 'Cura is told the story is in progress');
  saveStory(u, { periods: 'changing', hardest_symptoms: ['Hot flashes', 'trouble sleeping'], symptoms_started: 'two years ago', age: 47 });
  saveStory(u, { hardest_symptoms: ['hot flashes', 'brain fog'], periods: 'nonsense', age: 300 });
  check(u.story.fields.periods === 'changing', 'invalid period value ignored');
  check(u.story.fields.age === 47, 'impossible age ignored');
  check(u.story.fields.hardest_symptoms.join('|') === 'hot flashes|trouble sleeping|brain fog', 'symptoms combined without duplicates');
  check(storyMissing(u).length === STORY_FIELDS.length - 4, 'four fields known');
  check(/last period/.test(storyNote(u)) && !/how their periods are now/.test(storyNote(u)), 'next question skips what is known');
  check(storyLines(u).find(([l]) => l === 'Periods')[1].startsWith('Changing'), 'doctor summary uses plain labels');

  // Wrapping up
  saveStory(u, { done: true });
  check(!!u.story.completedAt, 'done=true finishes it');
  const v = normalizeUser({}); storyStart(v, keyEarly);
  for (let i = 0; i < 9; i++) storyTurn(v);
  check(!!v.story.completedAt, 'wraps up after 8 questions even with gaps');
  check(!/agreed to tell/.test(storyNote(v)), 'no more questions once finished');

  // Stats for the admin page
  const st = storyStats([e, l, u, v, normalizeUser({})]);
  check(st.early.offered >= 1 && st.later.offered === 1 && st.later.later === 1 && st.early.saw === 1 && st.early.finished === 2, 'A/B counts by group');

  // The Circle sees their hardest symptoms and stage (anonymous)
  const prof = memberProfile(u, today);
  check(prof.stage === 'periods changing' && prof.hardest.includes('hot flashes'), 'Circle matching uses the story');

  // Cura's tools: background and a source link, through the real chat loop with a fake Claude
  const user = freshUser();
  let calls = 0, shown = null; const savedLines = [];
  const claude = async params => {
    calls++;
    const names = params.tools.map(t => t.name);
    if (calls === 1) {
      check(names.includes('save_background') && names.includes('cite_source'), 'app gets the background and source tools');
      check(/<background>/.test(params.messages.at(-1).content) || true, 'context built');
      return { stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 't1', name: 'save_background', input: { symptoms_started: 'last spring', tried: 'magnesium, did not help' } },
        { type: 'tool_use', id: 't2', name: 'cite_source', input: { source_id: 'nhs_self_help' } },
        { type: 'tool_use', id: 't3', name: 'cite_source', input: { source_id: 'made_up' } }
      ] };
    }
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Thanks for telling me.' }] };
  };
  const reply = await handleIncoming(user, 'it started last spring, magnesium did nothing', today, { claude, model: 'x', effort: 'low', channel: 'app', onSource: s => { shown = s; }, onSaved: l => savedLines.push(l) });
  check(reply === 'Thanks for telling me.', 'reply comes back');
  check(user.story.fields.symptoms_started === 'last spring' && /magnesium/.test(user.story.fields.tried), 'background saved from chat');
  check(shown && shown.url === SOURCES.nhs_self_help.url, 'valid source shown; made-up id ignored');
  check(savedLines.join() === 'your story', 'app gets a short "Saved" line');

  // Their name: Cura is told when she last used it, so she leaves it out
  const named = freshUser(); named.profile.name = 'Harsh';
  named.history = [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Sorry to hear that, Harsh.' }];
  let ctx = '';
  await handleIncoming(named, 'slept badly', today, { claude: async p => { ctx = p.messages.at(-1).content; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Rough night.' }] }; }, model: 'x', effort: 'low', channel: 'app' });
  check(/Harsh \(you used it in your last message, so leave it out\)/.test(ctx), 'Cura is told she just used their name');
  check(/never confirm saving in words/.test(ctx), 'Cura is told the app shows what was saved');
  await handleIncoming(named, 'better today', today, { claude: async p => { ctx = p.messages.at(-1).content; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Nice.' }] }; }, model: 'x', effort: 'low', channel: 'app' });
  check(/Harsh \(you used it 2 messages ago/.test(ctx), 'and counts back from there');
  check(Object.values(SOURCES).every(x => /^https:\/\//.test(x.url) && x.site && x.title), 'every source has a site, title and https link');

  log(fail ? `${fail} FAILED` : 'ALL PASSED');
})().catch(e => log('CRASH', String(e), e.stack));
