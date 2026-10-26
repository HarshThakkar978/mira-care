// The Mira app's backend. One POST endpoint; `action` picks what to do.
// Each device gets a random id (kept in the browser); data lives under "web-<id>" in Redis.
import Anthropic from '@anthropic-ai/sdk';
import { runTool, freshUser, normalizeUser } from './_lib/mira.js';
import { miraReply, loadUser, storeUser, today, MODEL } from './_lib/respond.js';
import { storeConfigured, addReminderUser, removeReminderUser } from './_lib/store.js';
import { vapidKeys, localNow, sendToUser } from './_lib/push.js';

const ID_RE = /^[A-Za-z0-9-]{16,64}$/;
// Tools the app may run directly (same ones Mira uses), so manual entries and chat entries stay in one place.
const APP_TOOLS = new Set(['log_symptoms', 'log_period_start', 'log_feeling', 'save_profile', 'add_visit_note', 'add_after_visit_note', 'update_entry', 'delete_entry']);

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
// What the app gets back: everything except Mira's internal short-term memory.
const view = user => {
  const { history, actionLog, reminder, ...rest } = user;
  const { subscriptions, ...r } = reminder || {};
  return { ...rest, reminder: { ...r, devices: (subscriptions || []).length } };
};
const hasData = u => u.symptoms.length + u.cycleStarts.length + u.checkins.length + u.preNotes.length + u.postNotes.length + u.transcript.length > 0;

export async function POST(request) {
  if (!storeConfigured()) return json({ error: 'Database not connected' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const { id, action } = body || {};
  if (!ID_RE.test(id || '')) return json({ error: 'Missing device id' }, 400);
  const key = `web-${id}`;

  try {
    if (action === 'load') return json({ user: view(await loadUser(key)) });

    if (action === 'chat') {
      const text = String(body.text || '').trim().slice(0, 2000);
      if (!text) return json({ error: 'Empty message' }, 400);
      const { reply, user } = await miraReply(key, text, 'app');
      return json({ reply, user: view(user) });
    }

    const user = await loadUser(key);

    if (action === 'tool') {
      if (!APP_TOOLS.has(body.name)) return json({ error: 'Unknown tool' }, 400);
      const result = runTool(user, body.name, body.input || {}, today());
      await storeUser(key, user);
      return json({ result, user: view(user) });
    }

    if (action === 'patch') {
      // Agenda / follow-up edits from the visit screens.
      for (const field of ['agenda', 'followup']) {
        const v = body[field];
        if (!v) continue;
        user[field] = {
          summary: String(v.summary || '').slice(0, 2000),
          ...(field === 'agenda'
            ? { topics: cleanList(v.topics), questions: cleanList(v.questions) }
            : { steps: cleanList(v.steps), questions: cleanList(v.questions) })
        };
      }
      await storeUser(key, user);
      return json({ user: view(user) });
    }

    if (action === 'import') {
      // One-time move of entries saved by the old browser-only version of the site.
      if (hasData(user)) return json({ user: view(user), imported: false });
      const merged = normalizeUser({ ...freshUser(), ...pick(body.state || {}) });
      await storeUser(key, merged);
      return json({ user: view(merged), imported: true });
    }

    if (action === 'push-key') return json({ publicKey: (await vapidKeys()).publicKey });

    if (action === 'reminder') {
      // Turn the daily reminder on/off, change its hour, or register this device's push subscription.
      const r = user.reminder;
      if (typeof body.enabled === 'boolean') r.enabled = body.enabled;
      if (Number.isInteger(body.hour) && body.hour >= 0 && body.hour <= 23) r.hour = body.hour;
      if (typeof body.tz === 'string' && body.tz.length < 64) r.tz = body.tz;
      const sub = body.subscription;
      if (sub && typeof sub.endpoint === 'string' && sub.keys) r.subscriptions = [...r.subscriptions.filter(x => x.endpoint !== sub.endpoint), { endpoint: sub.endpoint, keys: sub.keys }].slice(-5);
      if (body.removeEndpoint) r.subscriptions = r.subscriptions.filter(x => x.endpoint !== body.removeEndpoint);
      // If today's hour has already passed when turning it on, start tomorrow instead of firing right away.
      const now = localNow(r.tz);
      if (body.enabled === true || Number.isInteger(body.hour)) r.lastSent = now.hour >= r.hour ? now.date : '';
      await storeUser(key, user);
      if (r.enabled && r.subscriptions.length) await addReminderUser(key); else await removeReminderUser(key);
      return json({ user: view(user) });
    }

    if (action === 'test-push') {
      const sent = await sendToUser(user, { title: 'Mira test 💚', body: "Reminders are working. I'll check in at the time you picked.", url: '/#chat' });
      await storeUser(key, user);
      return json({ sent, user: view(user) });
    }

    if (action === 'draft') return json({ user: view(await draft(key, user, body.mode === 'after' ? 'after' : 'prep')) });

    if (action === 'reset') {
      await storeUser(key, freshUser());
      await removeReminderUser(key);
      return json({ user: view(freshUser()) });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('app error', action, e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

const cleanList = list => (Array.isArray(list) ? list : []).map(x => String(x || '').slice(0, 500)).slice(0, 30);

function pick(state) {
  const arr = v => (Array.isArray(v) ? v.slice(0, 2000) : []);
  return {
    profile: state.profile || {}, cycleStarts: arr(state.cycleStarts), symptoms: arr(state.symptoms),
    checkins: arr(state.checkins).map(({ turns, ...c }) => c), preNotes: arr(state.preNotes), postNotes: arr(state.postNotes),
    agenda: state.agenda || {}, followup: state.followup || {}
  };
}

const DRAFT_SCHEMAS = {
  prep: {
    type: 'object', additionalProperties: false, required: ['summary', 'topics', 'questions'],
    properties: { summary: { type: 'string' }, topics: { type: 'array', items: { type: 'string' } }, questions: { type: 'array', items: { type: 'string' } } }
  },
  after: {
    type: 'object', additionalProperties: false, required: ['summary', 'steps', 'questions'],
    properties: { summary: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } }, questions: { type: 'array', items: { type: 'string' } } }
  }
};

const DRAFT_PROMPTS = {
  prep: `Turn this person's own notes into a short agenda for their next appointment about perimenopause.
- summary: 2-3 sentences in first person ("I've been...") they could say at the start of the visit, mentioning the main patterns with dates or frequencies.
- topics: 3-6 short bullet topics, most important first, in their words.
- questions: 3-6 questions they might want to ask, based only on what they wrote.
Do not diagnose, interpret symptoms medically, or suggest treatments. If there is little data, keep it short.`,
  after: `Turn this person's notes from an appointment that already happened into a personal follow-up list.
- summary: 1-3 sentences in first person about what they remember from the visit.
- steps: the next steps they mentioned, as short reminders (no new medical advice).
- questions: things they said they still want to ask or check.
Only use what they wrote. Do not add medical instructions.`
};

async function draft(key, user, mode) {
  const since = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const recent = arr => arr.filter(x => (x.date || '') >= since);
  const data = mode === 'prep'
    ? { today: today(), profile: user.profile, period_starts: user.cycleStarts, symptoms: recent(user.symptoms), checkins: recent(user.checkins).map(({ date, feeling }) => ({ date, feeling })), visit_notes: user.preNotes }
    : { today: today(), profile: user.profile, after_visit_notes: user.postNotes, agenda_used: user.agenda };
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL(),
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: DRAFT_SCHEMAS[mode] } },
    messages: [{ role: 'user', content: `${DRAFT_PROMPTS[mode]}\n\n<data>${JSON.stringify(data)}</data>` }]
  });
  if (response.stop_reason === 'refusal') throw new Error('draft refused');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const out = JSON.parse(text);
  if (mode === 'prep') user.agenda = { summary: out.summary, topics: cleanList(out.topics), questions: cleanList(out.questions) };
  else user.followup = { summary: out.summary, steps: cleanList(out.steps), questions: cleanList(out.questions) };
  await storeUser(key, user);
  return user;
}
