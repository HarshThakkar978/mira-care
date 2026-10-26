// Backend for /admin.html. Read-only view of every user, protected by the ADMIN_PASSWORD setting in Vercel.
import crypto from 'node:crypto';
import { normalizeUser } from './_lib/mira.js';
import { allUserIds, getUsers, storeConfigured } from './_lib/store.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

function passwordOk(given) {
  const real = process.env.ADMIN_PASSWORD || '';
  if (!real || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

const lastActive = u => {
  const times = [u.createdAt, ...(u.transcript || []).map(m => m.at)].filter(Boolean).sort();
  const lastEntry = [...u.symptoms, ...u.cycleStarts, ...u.checkins, ...u.preNotes, ...u.postNotes].map(x => x.date).filter(Boolean).sort().pop();
  const t = times.pop() || '';
  return lastEntry && lastEntry > t.slice(0, 10) ? lastEntry : t;
};

function summary(id, u) {
  const msgs = u.transcript.filter(m => m.from === 'you');
  return {
    id, channel: id.startsWith('web-') ? 'App' : 'WhatsApp', name: u.profile.name || '', createdAt: u.createdAt || '', lastActive: lastActive(u),
    messages: msgs.length, symptoms: u.symptoms.length, periods: u.cycleStarts.length, checkins: u.checkins.length,
    notes: u.preNotes.length + u.postNotes.length, reminder: u.reminder.enabled ? u.reminder.hour : null,
    lastMessage: msgs.length ? msgs[msgs.length - 1].text.slice(0, 120) : ''
  };
}

function stats(users) {
  const now = Date.now(), day = 86400000;
  const allMsgs = users.flatMap(([, u]) => u.transcript.filter(m => m.from === 'you').map(m => m.at)).filter(Boolean);
  const perDay = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now - (13 - i) * day).toISOString().slice(0, 10);
    return { date: d, messages: allMsgs.filter(t => t.slice(0, 10) === d).length };
  });
  const active = days => users.filter(([, u]) => { const t = lastActive(u); return t && now - new Date(t).getTime() < days * day; }).length;
  return {
    users: users.length, active1: active(1), active7: active(7),
    messages7: allMsgs.filter(t => now - new Date(t).getTime() < 7 * day).length, messagesAll: allMsgs.length,
    symptoms: users.reduce((n, [, u]) => n + u.symptoms.length, 0), reminders: users.filter(([, u]) => u.reminder.enabled).length,
    perDay
  };
}

export async function POST(request) {
  if (!storeConfigured()) return json({ error: 'Database not connected' }, 503);
  if (!process.env.ADMIN_PASSWORD) return json({ error: 'Admin page is not set up yet: add ADMIN_PASSWORD in Vercel → Settings → Environment Variables, then redeploy.' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request' }, 400); }
  if (!passwordOk(body.password)) {
    await new Promise(r => setTimeout(r, 800)); // slow down guessing
    return json({ error: 'Wrong password' }, 401);
  }
  if (body.action === 'list') {
    const users = (await getUsers(await allUserIds())).map(([id, u]) => [id, normalizeUser(u)]);
    const list = users.map(([id, u]) => summary(id, u)).sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''));
    return json({ stats: stats(users), users: list });
  }
  if (body.action === 'user') {
    const id = String(body.id || '');
    const [found] = await getUsers([id]);
    if (!found) return json({ error: 'User not found' }, 404);
    const u = normalizeUser(found[1]);
    const { history, actionLog, reminder, ...rest } = u;
    return json({ id, summary: summary(id, u), user: { ...rest, reminder: { enabled: reminder.enabled, hour: reminder.hour, tz: reminder.tz, devices: reminder.subscriptions.length } }, actionLog });
  }
  return json({ error: 'Unknown action' }, 400);
}
