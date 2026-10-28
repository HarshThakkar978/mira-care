// The Cura app's backend. One POST endpoint; `action` picks what to do.
// Each device gets a random id (kept in the browser); data lives under "web-<id>" in Redis.
import Anthropic from '@anthropic-ai/sdk';
import { waitUntil } from '@vercel/functions';
import { runTool, freshUser, normalizeUser, mergeUsers } from './_lib/mira.js';
import { miraReply, loadUser, storeUser, today, MODEL } from './_lib/respond.js';
import { storeConfigured, addReminderUser, removeReminderUser, getAccount, setAccount } from './_lib/store.js';
import { verifyGoogleToken } from './_lib/google.js';
import { vapidKeys, localNow, sendToUser } from './_lib/push.js';
import {
  joinCommunity, updateCommunity, leaveCommunity, eraseUser, groupView, unreadCount, postMessage, extractTips,
  displayName, chatContext, loadTips, noteTipUse, calendarToken, allowPost
} from './_lib/community.js';
import { ideasFor, addToPlan, recordOutcome, HOW_WELL } from './_lib/community-logic.js';

const ID_RE = /^[A-Za-z0-9-]{16,64}$/;
// Tools the app may run directly (same ones Cura uses), so manual entries and chat entries stay in one place.
const APP_TOOLS = new Set(['log_symptoms', 'log_period_start', 'log_feeling', 'save_profile', 'add_visit_note', 'add_after_visit_note', 'update_entry', 'delete_entry']);

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
// What the app gets back: everything except Cura's internal short-term memory.
const PAGE = 80; // chat messages sent with each response; older ones load on request
const view = user => {
  const { history, actionLog, reminder, offers, transcript = [], ...rest } = user;
  const { subscriptions, ...r } = reminder || {};
  return { ...rest, transcript: transcript.slice(-PAGE), transcriptTotal: transcript.length, reminder: { ...r, devices: (subscriptions || []).length } };
};
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const hasData = u => u.symptoms.length + u.cycleStarts.length + u.checkins.length + u.preNotes.length + u.postNotes.length + u.transcript.length > 0;

export async function POST(request) {
  if (!storeConfigured()) return json({ error: 'Database not connected' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const { id, action } = body || {};
  if (!ID_RE.test(id || '')) return json({ error: 'Missing device id' }, 400);
  const key = `web-${id}`;

  try {
    if (action === 'load') {
      const user = await loadUser(key);
      return json({ user: view(user), communityUnread: await unreadCount(key, user).catch(() => 0), googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
    }

    if (action === 'chat') {
      const text = String(body.text || '').trim().slice(0, 2000);
      if (!text) return json({ error: 'Empty message' }, 400);
      if (body.stream) return streamChat(key, text);
      const { reply, user } = await miraReply(key, text, 'app', { context: (u, t) => chatContext(key, u, t) });
      return json({ reply, user: view(user) });
    }

    const user = await loadUser(key);

    if (action === 'transcript') {
      // Older chat messages: the PAGE before the `loaded` most recent ones.
      const loaded = Math.max(0, Number(body.loaded) || 0), end = Math.max(0, user.transcript.length - loaded);
      return json({ messages: user.transcript.slice(Math.max(0, end - PAGE), end), remaining: Math.max(0, end - PAGE) });
    }

    if (action === 'insight') return json({ insight: await weeklyInsight(key, user) });

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
      const sent = await sendToUser(user, { title: 'Cura test 💚', body: "Reminders are working. I'll check in at the time you picked.", url: '/#chat' });
      await storeUser(key, user);
      return json({ sent, user: view(user) });
    }

    if (action === 'draft') return json({ user: view(await draft(key, user, body.mode === 'after' ? 'after' : 'prep')) });

    // ---------- Google sign-in ----------
    // The account remembers which storage id holds their data. Signing in on another phone (or after deleting
    // the app) hands that id back to the app, so everything comes back. A phone's own notes are merged in.
    if (action === 'google-signin') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) return json({ error: 'Google sign-in is not set up yet' }, 503);
      let g;
      try { g = await verifyGoogleToken(body.credential, clientId); }
      catch (e) { console.error('google sign-in rejected', e.message); return json({ error: "Couldn't sign you in with Google. Please try again." }, 401); }
      // A phone already signed in to a different Google account has to sign out first, so accounts never mix.
      if (user.account && user.account.sub && user.account.sub !== g.sub) return json({ error: 'This phone is signed in to another account. Sign out in Me first.' }, 409);
      const linked = await getAccount(g.sub);
      let target = user, targetKey = key, merged = false;
      if (linked && linked !== key) {
        target = await loadUser(linked);
        targetKey = linked;
        if (hasData(user)) { mergeUsers(target, user); merged = true; }
      }
      target.account = { provider: 'google', sub: g.sub, email: g.email, linkedAt: (target.account && target.account.linkedAt) || new Date().toISOString() };
      if (!target.profile.name && g.name) target.profile.name = g.name;
      await storeUser(targetKey, target);
      await setAccount(g.sub, targetKey);
      if (targetKey !== key) await eraseUser(key); // this phone's old record now lives in the account
      return json({ deviceId: targetKey.slice('web-'.length), merged, restored: targetKey !== key, user: view(target) });
    }

    // ---------- Community ----------
    const since = typeof body.since === 'string' ? body.since : '';
    if (action === 'community-join') {
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
      if (name && body.anonymous !== true) user.profile.name = name;
      await joinCommunity(key, user, { focus: body.focus, anonymous: body.anonymous === true });
      return json({ user: view(user), ...(await groupView(key, user)) });
    }
    if (action === 'community-settings') {
      if (body.clearNotice) user.community.notice = null;
      await updateCommunity(key, user, { anonymous: body.anonymous, focus: body.focus });
      await storeUser(key, user);
      return json({ user: view(user) });
    }
    if (action === 'community-leave') {
      await leaveCommunity(key, user);
      await storeUser(key, user);
      return json({ user: view(user) });
    }
    if (action === 'group') {
      if (!user.community.joined) return json({ error: 'Join the community first' }, 400);
      return json({ ...((await groupView(key, user, since)) || { group: null, messages: [] }), notice: user.community.notice, reason: user.community.reason });
    }
    if (action === 'group-post') {
      const text = String(body.text || '').trim().slice(0, 1000);
      if (!text) return json({ error: 'Empty message' }, 400);
      if (!user.community.joined || !user.community.groupId) return json({ error: 'Join the community first' }, 400);
      if (!(await allowPost(key))) return json({ error: "That's a lot of messages for one hour. Take a breather and try again a bit later." }, 429);
      const msg = await postMessage(user.community.groupId, key, text);
      // Claude reads it for tips after the reply has gone out.
      waitUntil(extractTips(user.community.groupId, msg, key, displayName(user)).catch(e => console.error('tip extraction failed', e)));
      return json((await groupView(key, user, since)) || { group: null, messages: [] });
    }
    if (action === 'ideas') return json({ ideas: ideasFor(user, await loadTips(), today()) });
    if (action === 'tip-hide') {
      user.community.hidden = [...new Set([...user.community.hidden, String(body.tipId || '')])].filter(Boolean).slice(-100);
      await storeUser(key, user);
      return json({ user: view(user), ideas: ideasFor(user, await loadTips(), today()) });
    }
    if (action === 'plan-add') {
      const tip = (await loadTips()).find(t => t.id === body.tipId && t.status === 'approved');
      if (!tip) return json({ error: 'That idea is no longer available' }, 404);
      const item = addToPlan(user, tip, today(), newId());
      await storeUser(key, user);
      if (item) await noteTipUse(tip.id, key, { added: true });
      return json({ user: view(user) });
    }
    const item = user.plan.find(p => p.id === body.item); // "id" is the device id
    if (action === 'plan-done' || action === 'plan-outcome') {
      if (!item) return json({ error: 'That plan item is gone' }, 404);
      if (action === 'plan-done') {
        const d = isDate(body.date) ? body.date : today();
        item.done = item.done.includes(d) ? item.done.filter(x => x !== d) : [...item.done, d].slice(-60);
      } else {
        if (!HOW_WELL.includes(body.how) || body.how === 'unclear') return json({ error: 'Pick how it went' }, 400);
        recordOutcome(item, body.how);
        await noteTipUse(item.tipId, key, { outcome: body.how });
      }
      await storeUser(key, user);
      return json({ user: view(user) });
    }
    if (action === 'plan-remove') {
      user.plan = user.plan.filter(p => p.id !== body.item);
      await storeUser(key, user);
      return json({ user: view(user) });
    }
    if (action === 'calendar-link') {
      const token = await calendarToken(key, user);
      return json({ url: `https://${new URL(request.url).host}/cal/${token}.ics`, user: view(user) });
    }

    if (action === 'reset') {
      // Remove the record entirely (and their community messages), so an erased person doesn't linger.
      await eraseUser(key);
      return json({ user: view(freshUser()) });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('app error', action, e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

// Streams Cura's reply as newline-separated JSON: {t:'delta',text} … then {t:'done',reply,user} (or {t:'error'}).
function streamChat(key, text) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = obj => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
      try {
        const { reply, user } = await miraReply(key, text, 'app', { onText: t => send({ t: 'delta', text: t }), onRound: () => send({ t: 'round' }), context: (u, t) => chatContext(key, u, t) });
        send({ t: 'done', reply, user: view(user) });
      } catch (e) {
        console.error('chat stream error', e);
        send({ t: 'error', error: 'Cura could not reply just now. Please try again.' });
      }
      controller.close();
    }
  });
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform' } });
}

// A short, friendly read of the last 7 days for the Today screen. Cached until the entries change.
async function weeklyInsight(key, user) {
  const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const symptoms = user.symptoms.filter(s => s.date >= since), checkins = user.checkins.filter(c => c.date >= since), periods = user.cycleStarts.filter(c => c.date >= since);
  if (symptoms.length + checkins.length + periods.length < 2) return null;
  const sig = [...symptoms, ...checkins, ...periods].map(x => `${x.id}:${x.severity || ''}`).sort().join(',');
  if (user.insight && user.insight.sig === sig && user.insight.date === today()) return user.insight.text;
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL(),
    max_tokens: 2000,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: `Write one or two short sentences (under 40 words) for this person about their last 7 days, noticing patterns: which symptoms came up most, how strong, any link to sleep or their period, how they've been feeling. Warm, plain, second person ("You've…"). Don't diagnose, explain causes or give advice. Only mention their clinician if something was clearly strong or frequent. Reply with just the sentences.\n\n<data>${JSON.stringify({ today: today(), symptoms: symptoms.map(({ date, name, severity, impact, notes }) => ({ date, name, severity, impact, notes })), checkins: checkins.map(({ date, feeling }) => ({ date, feeling })), period_starts: periods.map(p => p.date) })}</data>` }]
  });
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim().slice(0, 400);
  if (!text) return null;
  user.insight = { date: today(), sig, text };
  await storeUser(key, user);
  return text;
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
