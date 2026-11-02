// Tests "your story": the A/B offer, saving answers, wrapping up, and Cura's source links (free, offline).
// Run: /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m dev/story.test.mjs
import { storyArm, storyOffer, storyStart, saveStory, storyMissing, storyTurn, storyNote, storyLines, storyStats, STORY_FIELDS } from '../api/_lib/story.js';
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
  const e = normalizeUser({ profile: { name: 'Ana' } });
  const o1 = storyOffer(e, keyEarly);
  check(o1 && o1.cta.action === 'story-start' && /Ana/.test(o1.text), 'early group is offered straight away, by name');
  check(storyOffer(e, keyEarly) === null, 'offered only once');
  const l = normalizeUser({});
  check(storyOffer(l, keyLater) === null && l.story.arm === 'later', 'later group: not before 3 check-in days');
  l.checkins = [1, 2, 3].map(n => ({ id: 'c' + n, date: day(n), feeling: 'ok' }));
  check(storyOffer(l, keyLater) !== null, 'later group: offered after 3 check-in days');

  // Starting and saving
  const u = normalizeUser({});
  const first = storyStart(u, keyEarly);
  check(u.story.startedAt && /own words/.test(first.text) && /mic/.test(first.text), 'start asks an open question and mentions the mic');
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
  check(st.early.offered >= 1 && st.later.offered === 1 && st.early.finished === 2, 'A/B counts by group');

  // Cura's tools: background and a source link, through the real chat loop with a fake Claude
  const user = freshUser();
  let calls = 0, shown = null;
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
  const reply = await handleIncoming(user, 'it started last spring, magnesium did nothing', today, { claude, model: 'x', effort: 'low', channel: 'app', onSource: s => { shown = s; } });
  check(reply === 'Thanks for telling me.', 'reply comes back');
  check(user.story.fields.symptoms_started === 'last spring' && /magnesium/.test(user.story.fields.tried), 'background saved from chat');
  check(shown && shown.url === SOURCES.nhs_self_help.url, 'valid source shown; made-up id ignored');
  check(Object.values(SOURCES).every(x => /^https:\/\//.test(x.url) && x.site && x.title), 'every source has a site, title and https link');

  log(fail ? `${fail} FAILED` : 'ALL PASSED');
})().catch(e => log('CRASH', String(e), e.stack));
