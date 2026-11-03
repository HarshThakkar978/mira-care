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
  const said = n => Array.from({ length: n }, () => ({ from: 'you', text: 'hi', at: '2026-11-05T10:00:00Z' }));
  const at = h => new Date(Date.parse('2026-11-05T10:00:00Z') + h * 3600000);
  const e = normalizeUser({ profile: { name: 'Ana' }, createdAt: '2026-11-05T10:00:00Z', transcript: said(1) });
  check(storyOffer(e, keyEarly, at(0)) === false, 'early group: not after the very first message');
  e.transcript = said(2);
  check(storyOffer(e, keyEarly, at(0)) === true && storyPopupDue(e), 'early group: invited after 2 messages, as a pop-up');
  check(storyOffer(e, keyEarly, at(1)) === false, 'invited only once');
  storySeen(e, at(0));
  check(!storyPopupDue(e), 'pop-up shown once');
  const l = normalizeUser({ createdAt: '2026-11-05T10:00:00Z', transcript: said(5) });
  check(storyOffer(l, keyLater, at(3)) === false && l.story.arm === 'later', 'later group: not on the first day');
  check(storyOffer(l, keyLater, at(22)) === true, 'later group: invited when they come back the next day');
  storyLater(l, at(22));
  check(storyReminder(l, at(30)) === null, '"Maybe later": no reminder straight away');
  const rem = storyReminder(l, at(22 + 49));
  check(rem && rem.cta.action === 'story-start', '"Maybe later": one reminder in the chat two days on');
  check(storyReminder(l, at(22 + 100)) === null, 'and only one');

  // People who used Cura before launch: their own group, asked after their first message once it's live
  const old = normalizeUser({ createdAt: '2026-10-20T10:00:00Z', transcript: [{ from: 'you', text: 'hi', at: '2026-10-20T10:00:00Z' }] });
  check(storyOffer(old, keyEarly, at(30)) === false && old.story.arm === 'existing', 'existing user: own group, not asked from old messages');
  old.transcript.push({ from: 'you', text: 'hello again', at: '2026-11-04T09:00:00.000Z' });
  check(storyOffer(old, keyEarly, at(30)) === true, 'existing user: asked after their first message once it is live');
  const st0 = storyStats([old]); check(st0.existing.offered === 1 && st0.early.offered === 0, 'existing users kept out of the A/B numbers');
  // why-lines: every question but the last links a trusted page
  check(STORY_FIELDS.slice(0, -1).every(f => f[4].text && /^https:\/\/www\.(nhs\.uk|nice\.org\.uk)\//.test(f[4].url)), 'each question has a "why I ask" with a source');
  check(storyStart(normalizeUser({}), keyEarly).why.site === 'NHS', 'the first question carries its why-line');

  // Starting and saving
  const u = normalizeUser({});
  const first = storyStart(u, keyEarly);
  check(u.story.startedAt && /first notice changes/.test(first.text) && /mic/.test(first.text) && first.ui && first.ui.options.length === 5, 'start asks a specific first question, with buttons, and mentions the mic');
  check(/getting-to-know-you questions/.test(storyNote(u)) && /first notice changes/.test(storyNote(u)), 'Cura is told the next exact question');
  saveStory(u, { periods: 'changing', hardest_symptoms: ['Hot flashes', 'trouble sleeping'], symptoms_started: 'two years ago', age: 47 });
  saveStory(u, { hardest_symptoms: ['hot flashes', 'brain fog'], periods: 'nonsense', age: 300 });
  check(u.story.fields.periods === 'changing', 'invalid period value ignored');
  check(u.story.fields.age === 47, 'impossible age ignored');
  check(u.story.fields.hardest_symptoms.join('|') === 'hot flashes|trouble sleeping|brain fog', 'symptoms combined without duplicates');
  check(storyMissing(u).length === STORY_FIELDS.length - 4, 'four fields known');
  check(/last period/.test(storyNote(u)) && !/how their periods are now/.test(storyNote(u)), 'next question skips what is known');
  check(storyLines(u).find(([l]) => l === 'Periods')[1].startsWith('Changing'), 'doctor summary uses plain labels');
  const r1 = saveStory(normalizeUser({}), { symptoms_started: '1–2 years ago' });
  check(r1.next_question && r1.next_question.about === 'periods' && r1.next_question.buttons.options.length === 5, 'saving hands Cura the next question and its buttons');
  const sk = normalizeUser({}); saveStory(sk, { skip: 'symptoms_started' });
  check(storyMissing(sk)[0][0] === 'periods' && !storyLines(sk).length, 'a skipped question is not asked again or shown');
  saveStory(u, { age: '45-49' }); check(u.story.fields.age === 47, 'a typed age is kept over a band');
  const w = normalizeUser({}); saveStory(w, { age: '45-49' }); check(w.story.fields.age === '45–49', 'a tapped age band is saved');

  // Wrapping up
  saveStory(u, { done: true });
  check(!!u.story.completedAt, 'done=true finishes it');
  const v = normalizeUser({}); storyStart(v, keyEarly);
  for (let i = 0; i < 13; i++) storyTurn(v);
  check(!!v.story.completedAt, 'wraps up after 12 turns even with gaps');
  check(!/getting-to-know-you/.test(storyNote(v)), 'no more questions once finished');

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

  // Every kind of tap-to-answer button still works through the chat loop (the 1-10 scale has no options list)
  for (const qr of [{ kind: 'scale', low_label: 'Mild', high_label: 'Strong' }, { kind: 'options', options: ['Yes', 'No'] }, { kind: 'multi', options: STORY_FIELDS[3][3].options }]) {
    let n = 0, gotWhy = null;
    const fake = async () => (++n === 1 ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'q', name: 'show_quick_replies', input: qr }] } : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] });
    const r = await handleIncoming(freshUser(), 'hi', today, { claude: fake, model: 'x', effort: 'low', channel: 'app', onQuickReplies: () => {}, onWhy: w => { gotWhy = w; } }).catch(e => 'CRASH ' + e.message);
    check(r === 'ok' && (qr.kind === 'multi' ? gotWhy && gotWhy.site === 'NHS' : !gotWhy), `${qr.kind} buttons work${qr.kind === 'multi' ? ' and a story question gets its why-line' : ''}`);
  }

  log(fail ? `${fail} FAILED` : 'ALL PASSED');
})().catch(e => log('CRASH', String(e), e.stack));
