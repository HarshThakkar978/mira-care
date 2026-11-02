// "Your story": the background Cura asks about once, so her insights and the doctor summary have context.
// Pure helpers (no database, no Claude) so they can be tested offline. Cura fills the fields through the
// save_background tool, from whatever the person says or dictates, and asks one question at a time for the rest.
//
// The fields follow what clinicians use to place someone in the transition (STRAW+10: how the cycle has
// changed, gaps of 60+ days, 12 months without a period) and the symptom areas of the Menopause Rating Scale,
// plus what they've tried, relevant medical background and what they want help with.
//
// A/B test on timing: half of people are offered it straight away ("early"), half once they've checked in on
// 3 different days ("later"). The admin page compares how many start and finish in each group.
import { checkinDays } from './community-logic.js';

export const STORY_FIELDS = [
  ['periods', 'how their periods are now'],
  ['last_period', 'when their last period was'],
  ['symptoms_started', 'when the symptoms started'],
  ['hardest_symptoms', 'which symptoms are hardest'],
  ['tried', "what they've tried and how it went"],
  ['medical', 'relevant medical background (surgery such as a hysterectomy, conditions, regular medicines)'],
  ['family', "family history, such as their mother's age at menopause"],
  ['hopes', 'what they most want help with'],
  ['age', 'their age']
];
export const PERIODS = ['regular', 'changing', 'skipping', 'stopped', 'not_sure', 'not_applicable'];
export const PERIODS_LABEL = {
  regular: 'Still regular', changing: 'Changing (cycle length varies by a week or more)', skipping: 'Skipping (60+ days between some periods)',
  stopped: 'Stopped (no period for 12+ months)', not_sure: 'Not sure', not_applicable: "Can't tell (hysterectomy, IUD, pill or similar)"
};
const FIELD_LABEL = {
  periods: 'Periods', last_period: 'Last period', symptoms_started: 'Symptoms started', hardest_symptoms: 'Hardest symptoms', tried: 'Tried so far',
  medical: 'Medical background', family: 'Family history', hopes: 'Wants help with', age: 'Age'
};
const MAX_QUESTIONS = 8; // after this many story turns Cura wraps up, even if some things are still unknown

export const freshStory = () => ({ arm: '', offeredAt: '', startedAt: '', completedAt: '', turns: 0, fields: {} });

// Stable 50/50 split by the person's storage key.
export function storyArm(key) {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 ? 'later' : 'early';
}

export const STORY_DAYS = 3;
export function storyOfferDue(user) {
  const s = user.story || {};
  if (s.offeredAt || s.startedAt) return false;
  return s.arm === 'early' || checkinDays(user) >= STORY_DAYS;
}

// Cura's invitation in chat (once). The wording frames it as making her insights more personal.
export function storyOffer(user, key, now = new Date()) {
  user.story = { ...freshStory(), ...(user.story || {}) };
  if (!user.story.arm) user.story.arm = storyArm(key);
  if (!storyOfferDue(user)) return null;
  user.story.offeredAt = now.toISOString();
  return {
    from: 'mira', at: now.toISOString(), kind: 'story-offer',
    text: "Quick one 💜 Could you tell me how this all started for you? It helps me make my insights more personal. About 3 minutes, and you can just talk.",
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
  return {
    from: 'mira', at: now.toISOString(), kind: 'story',
    text: "Thank you 💜 So, how did it all start, and what's it been like since? Periods, the symptoms that bother you most, anything you've tried. Tap the mic and just talk if that's easier."
  };
}

const clean = (v, n = 400) => String(v == null ? '' : v).trim().slice(0, n);

// Merges what Cura heard into the saved fields. Text fields are replaced (Cura is told to include anything
// already known), the symptom list is combined.
export function saveStory(user, input = {}, now = new Date()) {
  user.story = { ...freshStory(), ...(user.story || {}) };
  const f = { ...user.story.fields };
  if (PERIODS.includes(input.periods)) f.periods = input.periods;
  const age = Number(input.age);
  if (age >= 18 && age <= 90) f.age = Math.round(age);
  for (const k of ['last_period', 'symptoms_started', 'tried', 'medical', 'family', 'hopes']) if (clean(input[k])) f[k] = clean(input[k]);
  if (Array.isArray(input.hardest_symptoms)) {
    const all = [...(f.hardest_symptoms || []), ...input.hardest_symptoms.map(x => clean(x, 60).toLowerCase()).filter(Boolean)];
    f.hardest_symptoms = [...new Set(all)].slice(0, 8);
  }
  user.story.fields = f;
  if (input.done === true && user.story.startedAt && !user.story.completedAt) user.story.completedAt = now.toISOString();
  return { ok: true, saved: f, missing: storyMissing(user).map(([k]) => k) };
}

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
  const known = STORY_FIELDS.filter(([k]) => f[k] != null && f[k] !== '' && !(Array.isArray(f[k]) && !f[k].length))
    .map(([k]) => `${k}: ${Array.isArray(f[k]) ? f[k].join(', ') : f[k]}`);
  const lines = known.length ? [`Their background so far: ${known.join('; ')}.`] : [];
  if (storyActive(user)) {
    const missing = storyMissing(user);
    lines.push(missing.length
      ? `They agreed to tell you their story. Save what they share with save_background. Then ask about ONE of these, in this order, warmly and briefly: ${missing.map(([, d]) => d).join('; ')}. Offer tap-to-answer buttons when it fits (for periods use the six plain options). If they'd rather not answer, or seem done, thank them and call save_background with done=true.`
      : 'You now have their whole story. Thank them warmly in a sentence, tell them it will make your insights more personal, and call save_background with done=true.');
  } else if (!known.length) lines.push('If they mention their history (when this started, treatments, surgery, family history), save it with save_background.');
  return lines.length ? `<background>${lines.join(' ')}</background>` : '';
}

// For the doctor summary and the Me tab.
export function storyLines(user) {
  const f = (user.story || {}).fields || {};
  return STORY_FIELDS.filter(([k]) => f[k] != null && f[k] !== '' && !(Array.isArray(f[k]) && !f[k].length))
    .map(([k]) => [FIELD_LABEL[k], k === 'periods' ? PERIODS_LABEL[f[k]] : Array.isArray(f[k]) ? f[k].join(', ') : String(f[k])]);
}

// For the admin page: how the two timing groups compare.
export function storyStats(users) {
  const out = { early: { people: 0, offered: 0, started: 0, finished: 0, fields: 0 }, later: { people: 0, offered: 0, started: 0, finished: 0, fields: 0 } };
  for (const u of users) {
    const s = u.story; if (!s || !out[s.arm]) continue;
    const g = out[s.arm];
    g.people++;
    if (s.offeredAt) g.offered++;
    if (s.startedAt) g.started++;
    if (s.completedAt) g.finished++;
    g.fields += STORY_FIELDS.length - storyMissing(u).length;
  }
  return out;
}
