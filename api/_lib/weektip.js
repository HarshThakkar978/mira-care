// "For you this week" on Today: one personal idea from Cura, grounded in the person's own entries and backed by one
// of the trusted pages in SOURCES. No source that fits, no tip. Cached on the user for up to a week, and remade
// at most once a day when their entries change.
import { SOURCES } from './mira.js';
import { storyLines } from './story.js';

const DAY = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY);
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);

// What the tip is based on: the last 14 days, their story, and their plan.
export function tipInput(user, todayStr) {
  const since = addDays(todayStr, -13);
  const symptoms = (user.symptoms || []).filter(s => s.date >= since && s.date <= todayStr);
  const checkins = (user.checkins || []).filter(c => c.date >= since && c.date <= todayStr);
  const periods = (user.cycleStarts || []).map(c => c.date).sort().slice(-4);
  const plan = (user.plan || []).filter(p => p.status !== 'removed').map(p => ({ idea: p.title, outcome: p.outcome || 'trying' }));
  const sig = [...symptoms.map(s => `${s.id}:${s.severity || ''}`), ...checkins.map(c => c.id), ...periods, ...plan.map(p => p.idea + p.outcome)].sort().join(',');
  return { enough: symptoms.length + checkins.length >= 3, sig, data: {
    today: todayStr,
    symptoms: symptoms.map(({ date, name, severity, impact, notes }) => ({ date, name, severity, impact, notes })),
    checkins: checkins.map(({ date, feeling }) => ({ date, feeling })),
    recent_period_starts: periods,
    background: storyLines(user).map(([k, v]) => `${k}: ${v}`),
    already_trying: plan
  } };
}

export const TIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'What it responds to, 2 to 5 words, e.g. "For your 3am wake-ups". Empty when there is no tip.' },
    tip: { type: 'string', description: 'One or two short sentences, under 32 words. Empty when no source fits.' },
    source_id: { type: 'string', enum: ['none', ...Object.keys(SOURCES)] }
  },
  required: ['title', 'tip', 'source_id']
};

export function tipPrompt(input) {
  return `You are Cura, a perimenopause companion: like a friend who happens to be a menopause nurse. Write the "For you this week" card on their Today screen: ONE idea for the coming week.

Rules:
- Start from their own entries below. Name the pattern it responds to in a few words ("Since your hot flashes have mostly come with poor sleep…"), then the idea.
- It must be something the chosen source page actually recommends. Sources (id: what the page covers):
${Object.entries(SOURCES).map(([id, x]) => `  ${id}: ${x.site}, ${x.about}`).join('\n')}
- If no source covers an idea that fits them, return an empty tip with source_id "none". No tip is better than a generic one.
- No generic advice a parent would give (cut screens, drink water, fresh air, a warm bath, herbal tea, get some rest) unless their entries point straight at it.
- Don't repeat what's in already_trying, or anything their background says didn't help. Build on what helped.
- No medicines, supplements or doses, and never diagnose. When a symptom is frequent or strong, the idea can be a proven option to ask a clinician about (HRT or menopause-specific CBT for hot flashes and night sweats; CBT for insomnia for sleep).
- Calm, warm, plain words, second person. Never make things sound worse ("the worst", "miserable", "exhausting", "brutal").

<data>${JSON.stringify(input.data)}</data>`;
}

// Checks the model's answer; returns { title, text, source } or null.
export function cleanTip(out) {
  if (!out || typeof out !== 'object') return null;
  const src = SOURCES[out.source_id];
  const text = String(out.tip || '').trim().replace(/\s+/g, ' ');
  if (!src || !text || text.split(' ').length > 45) return null;
  const title = String(out.title || '').trim().slice(0, 48) || 'An idea for you';
  return { title, text: text.slice(0, 320), source: { site: src.site, title: src.title, url: src.url } };
}

// Keep a tip for up to a week while nothing changes, and remake it at most once a day when entries change.
export const tipFresh = (cached, sig, todayStr) => !!cached && (cached.date === todayStr || (cached.sig === sig && daysBetween(cached.date, todayStr) < 7));

export async function weeklyTip(user, todayStr, model, save) {
  const input = tipInput(user, todayStr);
  if (!input.enough) return null;
  if (tipFresh(user.weekTip, input.sig, todayStr)) return user.weekTip.tip || null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk'); // loaded here so the tests can import this file
  const response = await new Anthropic().messages.create({
    model, max_tokens: 1500, output_config: { effort: 'low', format: { type: 'json_schema', schema: TIP_SCHEMA } },
    messages: [{ role: 'user', content: tipPrompt(input) }]
  });
  let out = null;
  try { out = JSON.parse(response.content.filter(b => b.type === 'text').map(b => b.text).join('')); } catch {}
  const tip = response.stop_reason === 'refusal' ? null : cleanTip(out);
  user.weekTip = { date: todayStr, sig: input.sig, tip };
  await save(user);
  return tip;
}
