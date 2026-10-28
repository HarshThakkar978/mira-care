// Backend for /admin.html: view every user and delete test or unwanted records. Protected by the ADMIN_PASSWORD setting in Vercel.
import crypto from 'node:crypto';
import { normalizeUser } from './_lib/mira.js';
import { allUserIds, getUsers, getUser, saveUser, storeConfigured } from './_lib/store.js';
import { eraseUser, adminCommunity, adminGroupMessages, adminDeleteMessage, saveTip, addTeamTips, regroup, questionsOfTheDay, loadSettings, saveSettings } from './_lib/community.js';
import { checkinDays } from './_lib/community-logic.js';

// Ids used by Claude's automated tests ("claude-…" device ids), so they can be cleaned out in one go.
const isTestId = id => /^web-claude-/.test(id);

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
    lastMessage: msgs.length ? msgs[msgs.length - 1].text.slice(0, 120) : '',
    test: isTestId(id), circleEarly: !!u.circleEarly, checkinDays: checkinDays(u), inCircle: !!(u.community && u.community.joined)
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
  if (body.action === 'delete') {
    const id = String(body.id || '');
    if (!id) return json({ error: 'Missing user' }, 400);
    await eraseUser(id);
    return json({ deleted: 1 });
  }
  if (body.action === 'delete-test') {
    const ids = (await allUserIds()).filter(isTestId);
    for (const id of ids) await eraseUser(id);
    return json({ deleted: ids.length });
  }
  // ---------- Community: tips to review, groups, messages ----------
  if (body.action === 'community') return json({ ...(await adminCommunity()), settings: await loadSettings() });
  if (body.action === 'circle-open') return json({ settings: await saveSettings({ circleOpen: body.open === true }) });
  if (body.action === 'circle-early') {
    // Lets one person into the Circle before their 3 check-ins (for team testing).
    const id = String(body.id || ''), raw = await getUser(id);
    if (!raw) return json({ error: 'User not found' }, 404);
    raw.circleEarly = body.on === true;
    await saveUser(id, raw);
    return json({ circleEarly: raw.circleEarly });
  }
  if (body.action === 'group-msgs') return json({ messages: await adminGroupMessages(String(body.groupId || '')) });
  if (body.action === 'msg-delete') return json({ deleted: await adminDeleteMessage(String(body.groupId || ''), String(body.msgId || '')) });
  if (body.action === 'tip-save') {
    const tip = await saveTip(String(body.id || ''), { fields: body.fields || {}, status: body.status, remove: body.remove === true });
    return tip ? json({ tip }) : json({ error: 'Tip not found' }, 404);
  }
  if (body.action === 'tip-add') {
    const text = String(body.text || '').trim();
    if (!text) return json({ error: 'Write a tip first' }, 400);
    const tips = await addTeamTips(text);
    return tips.length ? json({ added: tips.length }) : json({ error: "Cura couldn't find a tip in that text. Try one tip per line, e.g. \"A cool shower before bed for night sweats\"." }, 400);
  }
  if (body.action === 'regroup') return json({ result: await regroup({ force: true }) });
  if (body.action === 'questions') return json({ posted: await questionsOfTheDay() });
  return json({ error: 'Unknown action' }, 400);
}
