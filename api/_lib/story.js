// "Your story": the background Cura asks about once, so her insights and the doctor summary have context.
// Pure helpers (no database, no Claude) so they can be tested offline. Cura fills the fields through the
// save_background tool, from whatever the person says or dictates, and asks one question at a time for the rest.
//
// The fields follow what clinicians use to place someone in the transition (STRAW+10: how the cycle has
// changed, gaps of 60+ days, 12 months without a period) and the symptom areas of the Menopause Rating Scale,
// plus what they've tried, relevant medical background and what they want help with.
//
// A/B test on timing: half of people are invited after their first couple of messages ("early"), half when they
// come back on another day ("later", 20+ hours after they started). The invitation is a pop-up in the app; if they
// tap "Maybe later", Cura asks once more in the chat two days on. The admin page compares the two groups.

// The questions, in the order Cura asks them. Each is specific and comes with tap-to-answer buttons, so it feels
// like a quick check-in, not a form. Why each one matters:
// - when it started, period changes and last period: how doctors place someone in the transition (STRAW+10:
//   cycles varying by 7+ days = early, gaps of 60+ days = late, 12 months without = menopause);
// - which symptoms affect daily life: the Menopause Rating Scale's areas (body, mood, sleep, urogenital);
// - what they've tried; medical background that hides or mimics the signs (surgery, hormonal contraception,
//   thyroid, cancer treatment); mother's age at menopause (timing runs in families);
// - age: UK NICE guidance recognises perimenopause from symptoms after 45; before 40 it's worth a doctor's look;
// - what they want help with, last, so Cura knows what to focus on.
// Each question shows a short "why I ask" line under it, with the trusted page it comes from (checked by hand).
const NHS = 'https://www.nhs.uk/conditions/menopause-and-perimenopause/';
const NICE = 'https://www.nice.org.uk/guidance/ng23/chapter/Recommendations';
const why = (text, site, title, url) => ({ text, site, title, url });
export const STORY_FIELDS = [
  ['symptoms_started', 'when they first noticed changes', 'When did you first notice changes you think might be perimenopause, like hot flashes, poorer sleep, mood changes or different periods?',
    { kind: 'options', options: ['In the last 6 months', '6–12 months ago', '1–2 years ago', 'Over 2 years ago', 'Not sure'] },
    why('Perimenopause can start years before periods stop, so this shows where you might be.', 'NHS', 'Menopause and perimenopause', NHS)],
  ['periods', 'how their periods are now', 'How are your periods now, compared with a few years ago?',
    { kind: 'options', options: ['Still regular', 'Timing varies by a week+', 'Gaps of 2+ months', 'Stopped for a year+', 'Hard to say'] },
    why('Doctors recognise perimenopause from changes in your cycle along with your symptoms.', 'NICE', 'Menopause guidance', NICE)],
  ['last_period', 'when their last period started', 'When did your last period start?',
    { kind: 'options', options: ['This month', '1–2 months ago', '3–11 months ago', 'Over a year ago', 'Not sure'] },
    why('Menopause is reached after 12 months without a period.', 'NICE', 'Menopause guidance', NICE)],
  ['hardest_symptoms', 'which symptoms affect them most', 'Which of these affect your day-to-day life the most? Pick any.',
    { kind: 'multi', options: ['Hot flashes', 'Night sweats', 'Trouble sleeping', 'Mood or anxiety', 'Brain fog', 'Aches and pains', 'Heavy or painful periods', 'Low energy'] },
    why("Perimenopause is different for everyone, so Cura starts with what affects you most.", 'NHS', 'Symptoms', NHS + 'symptoms/')],
  ['tried', "what they've tried and whether it helped", 'What have you tried for them so far? Pick any.',
    { kind: 'multi', options: ['Nothing yet', 'Sleep or diet changes', 'Exercise', 'Supplements', 'HRT', 'Other medicine', 'Saw a doctor about it'] },
    why("So Cura doesn't repeat ideas, and your doctor can see what's helped.", 'NHS', 'Treatment', NHS + 'treatment/')],
  ['medical', 'medical background that affects the picture', 'Do any of these apply to you? Pick any.',
    { kind: 'multi', options: ['Womb or ovary surgery', 'Hormonal IUD, pill or implant', 'Thyroid condition', 'Cancer treatment', 'Other regular medicines', 'None of these'] },
    why('A hysterectomy or hormonal contraception can hide period changes, so doctors go by symptoms instead.', 'NICE', 'Menopause guidance', NICE)],
  ['family', "their mother's age at menopause", 'Do you know roughly how old your mum was when her periods stopped?',
    { kind: 'options', options: ['Before 45', '45–50', 'After 50', "Don't know"] },
    why('Early menopause is more likely if it runs in your family.', 'NHS', 'Early menopause', 'https://www.nhs.uk/conditions/early-menopause/')],
  ['age', 'their age', 'And how old are you?',
    { kind: 'options', options: ['Under 40', '40–44', '45–49', '50–54', '55 or over'] },
    why('Menopause usually happens between 45 and 55, and age changes what doctors look for.', 'NHS', 'Menopause and perimenopause', NHS)],
  ['hopes', 'what they most want help with', 'Last one: what would you most like help with right now? Pick any.',
    { kind: 'multi', options: ['Sleeping better', 'Fewer hot flashes', 'Feeling like myself', "Understanding what's happening", 'Talking to my doctor', 'Something else'] },
    why('So Cura focuses on what matters most to you.', '', '', '')]
];
export const AGE_BANDS = ['Under 40', '40–44', '45–49', '50–54', '55 or over'];
// How a tapped period answer maps to the saved stage.
const PERIOD_ANSWERS = "Still regular = regular; Timing varies by a week+ = changing; Gaps of 2+ months = skipping; Stopped for a year+ = stopped; Hard to say = not_sure (or not_applicable if they mention a hysterectomy, hormonal IUD, pill or implant)";
export const PERIODS = ['regular', 'changing', 'skipping', 'stopped', 'not_sure', 'not_applicable'];
export const PERIODS_LABEL = {
  regular: 'Still regular', changing: 'Changing (cycle length varies by a week or more)', skipping: 'Skipping (60+ days between some periods)',
  stopped: 'Stopped (no period for 12+ months)', not_sure: 'Not sure', not_applicable: "Can't tell (hysterectomy, IUD, pill or similar)"
};
const FIELD_LABEL = {
  periods: 'Periods', last_period: 'Last period', symptoms_started: 'Changes started', hardest_symptoms: 'Affects me most', tried: 'Tried so far',
  medical: 'Medical background', family: "Mum's menopause", hopes: 'Wants help with', age: 'Age'
};
const MAX_QUESTIONS = 12; // after this many story turns Cura wraps up, even if some things are still unknown (9 questions + a follow-up or two)

export const freshStory = () => ({ arm: '', offeredAt: '', popupAt: '', snoozedAt: '', remindedAt: '', startedAt: '', completedAt: '', turns: 0, fields: {} });

// Stable 50/50 split by the person's storage key.
export function storyArm(key) {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 ? 'later' : 'early';
}

export const EARLY_MESSAGES = 2; // "early": invited after this many messages to Cura
export const LATER_HOURS = 20;   // "later": invited on a visit at least this long after they started
export const REMIND_DAYS = 2;    // after "Maybe later", Cura asks once more in the chat this many days on
const sentCount = user => (user.transcript || []).filter(m => m.from === 'you').length;
// When they started using Cura: the earlier of their sign-up and first message (older accounts have no sign-up date).
const startedAt = user => [user.createdAt, ((user.transcript || [])[0] || {}).at].filter(Boolean).sort()[0] || '';
const hoursSince = (iso, now) => (iso ? (now - new Date(iso)) / 3600000 : 0);

// People who were already using Cura before "your story" launched aren't part of the timing test: they're asked
// after their first message to Cura once it's live.
export const STORY_LAUNCH = '2026-11-03T17:00:00.000Z';
const sentSinceLaunch = user => (user.transcript || []).some(m => m.from === 'you' && m.at >= STORY_LAUNCH);

export function storyOfferDue(user, now = new Date()) {
  const s = user.story || {};
  if (s.offeredAt || s.startedAt) return false;
  if (s.arm === 'existing') return sentSinceLaunch(user);
  return s.arm === 'early' ? sentCount(user) >= EARLY_MESSAGES : sentCount(user) >= 1 && hoursSince(startedAt(user), now) >= LATER_HOURS;
}

// Marks the invitation as due when it's their time; the app then shows the pop-up. Returns true when newly due.
export function storyOffer(user, key, now = new Date()) {
  user.story = { ...freshStory(), ...(user.story || {}) };
  if (!user.story.arm) user.story.arm = startedAt(user) && startedAt(user) < STORY_LAUNCH ? 'existing' : storyArm(key);
  if (!storyOfferDue(user, now)) return false;
  user.story.offeredAt = now.toISOString();
  return true;
}
export const storyPopupDue = user => !!(user.story && user.story.offeredAt && !user.story.popupAt && !user.story.startedAt);
export function storySeen(user, now = new Date()) { if (user.story && !user.story.popupAt) user.story.popupAt = now.toISOString(); }
export function storyLater(user, now = new Date()) { if (user.story) { user.story.popupAt = user.story.popupAt || now.toISOString(); user.story.snoozedAt = now.toISOString(); } }

// After a reply: the one gentle reminder in the chat, for people who tapped "Maybe later" a couple of days ago.
export function storyReminder(user, now = new Date()) {
  const s = user.story || {};
  if (!s.snoozedAt || s.remindedAt || s.startedAt || hoursSince(s.snoozedAt, now) < REMIND_DAYS * 24) return null;
  s.remindedAt = now.toISOString();
  const name = user.profile && user.profile.name ? ` ${user.profile.name}` : '';
  return {
    from: 'mira', at: now.toISOString(), kind: 'story-offer',
    text: `Hey${name}, whenever you have 3 minutes: I'd love to hear how this all started for you. It helps me tailor my tips to you and find you the right Circle. You can just talk.`,
    cta: { label: 'Tell my story', action: 'story-start' }
  };
}

// Their first question once they say yes: an open one, so they can tell it in their own words (or by voice).
export function storyStart(user, key, now = new Date()) {
  user.story = { ...freshStory(), ...(user.story || {}) };
  if (!user.story.arm) user.story.arm = storyArm(key);
  if (!user.story.offeredAt) user.story.offeredAt = now.toISOString();
  user.story.startedAt = user.story.startedAt || now.toISOString();
  user.story.completedAt = '';
  user.story.turns = 0;
  const [, , ask, ui, reason] = storyMissing(user)[0] || STORY_FIELDS[0];
  return {
    from: 'mira', at: now.toISOString(), kind: 'story', why: reason,
    text: `Thank you 💜 Just a few short questions, one at a time. Skip any you like, or tap the mic to talk.\n\nFirst: ${ask.charAt(0).toLowerCase() + ask.slice(1)}`,
    ui
  };
}

const clean = (v, n = 400) => String(v == null ? '' : v).trim().slice(0, n);

// Merges what Cura heard into the saved fields. Text fields are replaced (Cura is told to include anything
// already known), the symptom list is combined.
export function saveStory(user, input = {}, now = new Date()) {
  user.story = { ...freshStory(), ...(user.story || {}) };
  const f = { ...user.story.fields };
  if (PERIODS.includes(input.periods)) f.periods = input.periods;
  const age = Number(input.age), band = String(input.age || '').replace('-', '–').trim();
  if (age >= 18 && age <= 90) f.age = Math.round(age);
  else if (AGE_BANDS.includes(band) && typeof f.age !== 'number') f.age = band; // a band never replaces an exact age
  for (const k of ['last_period', 'symptoms_started', 'tried', 'medical', 'family', 'hopes']) if (clean(input[k])) f[k] = clean(input[k]);
  if (Array.isArray(input.hardest_symptoms)) {
    const all = [...(f.hardest_symptoms || []), ...input.hardest_symptoms.map(x => clean(x, 60).toLowerCase()).filter(Boolean)];
    f.hardest_symptoms = [...new Set(all)].slice(0, 8);
  }
  // They skipped a question: mark it so it isn't asked again (not shown anywhere).
  const skip = STORY_FIELDS.find(([k]) => k === input.skip);
  if (skip && (f[skip[0]] == null || f[skip[0]] === '')) f[skip[0]] = SKIPPED;
  user.story.fields = f;
  if (input.done === true && user.story.startedAt && !user.story.completedAt) user.story.completedAt = now.toISOString();
  const next = !user.story.completedAt && storyMissing(user)[0];
  return { ok: true, next_question: next ? { about: next[0], ask: next[2], buttons: next[3] } : null };
}
export const SKIPPED = '(skipped)';
const shown = v => v != null && v !== '' && v !== SKIPPED && !(Array.isArray(v) && !v.length);

export const storyMissing = user => STORY_FIELDS.filter(([k]) => {
  const v = ((user.story || {}).fields || {})[k];
  return v == null || v === '' || (Array.isArray(v) && !v.length);
});
export const storyActive = user => !!(user.story && user.story.startedAt && !user.story.completedAt);

// Counts a story turn; wraps up automatically after MAX_QUESTIONS or when nothing is left to ask.
export function storyTurn(user, now = new Date()) {
  if (!storyActive(user)) return;
  user.story.turns = (user.story.turns || 0) + 1;
  if (user.story.turns > MAX_QUESTIONS || !storyMissing(user).length) user.story.completedAt = now.toISOString();
}

// What Cura sees each turn.
export function storyNote(user) {
  const f = (user.story || {}).fields || {};
  const known = STORY_FIELDS.filter(([k]) => shown(f[k]))
    .map(([k]) => `${k}: ${Array.isArray(f[k]) ? f[k].join(', ') : f[k]}`);
  const lines = known.length ? [`Their background so far: ${known.join('; ')}.`] : [];
  if (storyActive(user)) {
    const now = storyMissing(user)[0];
    lines.push(now
      ? `They're answering your getting-to-know-you questions. Your last question was about ${now[1]} ("${now[2]}"), so a short answer or tapped button answers that. First call save_background with everything their message tells you (it may answer several questions at once; for periods: ${PERIOD_ANSWERS}). If they skipped it or would rather not say, pass skip: "${now[0]}". The result's next_question is what to ask next: after a few words reacting naturally (no stock phrases), ask it in those words or very close ones, and call show_quick_replies with exactly its buttons. One question per message. If they said they tried something specific, you may first ask once, briefly, whether it helped. If next_question is null, thank them warmly in a sentence, say it will help you tailor your tips and find them the right Circle, and call save_background with done=true. If they want to stop, thank them and call save_background with done=true.${f.age === 'Under 40' ? ' They are under 40: once, gently, mention that symptoms like these before 40 are worth raising with a doctor.' : ''}`
      : 'You now have their whole story. Thank them warmly in a sentence, say it will help you tailor your tips and find them the right Circle, and call save_background with done=true.');
  } else if (!known.length) lines.push('If they mention their history (when this started, treatments, surgery, family history), save it with save_background.');
  return lines.length ? `<background>${lines.join(' ')}</background>` : '';
}

// For the doctor summary and the Me tab.
export function storyLines(user) {
  const f = (user.story || {}).fields || {};
  return STORY_FIELDS.filter(([k]) => shown(f[k]))
    .map(([k]) => [FIELD_LABEL[k], k === 'periods' ? PERIODS_LABEL[f[k]] : Array.isArray(f[k]) ? f[k].join(', ') : String(f[k])]);
}

// For the admin page: how the two timing groups compare.
export function storyStats(users) {
  const blank = () => ({ people: 0, offered: 0, saw: 0, later: 0, started: 0, finished: 0, fields: 0 });
  const out = { early: blank(), later: blank(), existing: blank() };
  for (const u of users) {
    const s = u.story; if (!s || !out[s.arm]) continue;
    const g = out[s.arm];
    g.people++;
    if (s.offeredAt) g.offered++;
    if (s.popupAt) g.saw++;
    if (s.snoozedAt) g.later++;
    if (s.startedAt) g.started++;
    if (s.completedAt) g.finished++;
    g.fields += STORY_FIELDS.length - storyMissing(u).length;
  }
  return out;
}
