// Web push for daily reminders. The VAPID key pair is created once by the server
// and kept in Redis, so nobody has to generate or paste keys by hand.
import webpush from 'web-push';
import { getValue, setValue } from './store.js';
import { localDate } from './mira.js';

const VAPID_KEY = 'mira:vapid';
let ready = null;

export async function vapidKeys() {
  if (!ready) ready = (async () => {
    let keys = await getValue(VAPID_KEY);
    if (!keys) { keys = webpush.generateVAPIDKeys(); await setValue(VAPID_KEY, keys); }
    webpush.setVapidDetails('https://curadaily.com', keys.publicKey, keys.privateKey);
    return keys;
  })().catch(e => { ready = null; throw e; });
  return ready;
}

// Hour (0-23) and date in the person's own time zone.
export function localNow(tz) {
  const zone = tz || 'America/New_York';
  let hour;
  try { hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(new Date())); }
  catch { hour = new Date().getUTCHours(); }
  return { hour, date: localDate(zone) };
}

// Notifications read like a well-made app's. iPhone shows them as: title, then its own "from Cura" line (it can't be
// removed for Home Screen web apps), then the body. So the title is a short plain label (no greeting, no emoji), and
// the body is one personal line in Cura's own voice that never says "Cura" again.
const partOfDay = hour => (hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening');
export function reminderMessage(user, date) {
  const first = String(user.profile.name || '').trim().split(/\s+/)[0];
  const appt = user.profile.appointmentDate;
  const tomorrow = new Date(date + 'T12:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (appt && appt === tomorrow.toISOString().slice(0, 10)) {
    return { title: 'Appointment tomorrow', body: 'Want me to turn your notes into an agenda for it?', url: '/#visit', tag: 'cura-visit' };
  }
  // A message Cura left today (a visit nudge or the week recap) comes first.
  const note = [...(user.transcript || [])].reverse().find(m => m.from === 'mira' && (m.kind === 'nudge' || m.kind === 'recap') && String(m.at).slice(0, 10) >= date);
  if (note) {
    const line = note.text.split('\n').map(x => x.replace(/^[•\s]+/, '').trim()).filter(Boolean);
    return note.kind === 'recap'
      ? { title: 'Your week', body: (line[1] || line[0] || '').slice(0, 140), url: '/#chat', tag: 'cura-recap' }
      : { title: note.cta && note.cta.route === 'visit' ? 'Your visit' : 'Check-in', body: (line[0] || '').slice(0, 140), url: note.cta && note.cta.route ? `/#${note.cta.route}` : '/#chat', tag: 'cura-nudge' };
  }
  const title = `${partOfDay(Number(user.reminder.hour) || 20)} check-in`;
  const todo = (user.plan || []).filter(p => p.status === 'active' && !(p.done || []).includes(date));
  if (todo.length) return { title, body: `How are you feeling${first ? `, ${first}` : ''}? Also on your plan: ${todo[0].title.replace(/\.$/, '').toLowerCase()}.`, url: '/#today', tag: 'cura-daily' };
  const lines = [
    `How are you feeling today${first ? `, ${first}` : ''}? One tap is enough.`,
    'Anything you noticed today? I\'ll keep track of it.',
    `How was today${first ? `, ${first}` : ''}? A quick check-in keeps your notes complete.`
  ];
  return { title, body: lines[new Date(date + 'T12:00:00Z').getUTCDate() % lines.length], url: '/#chat', tag: 'cura-daily' };
}

// Sends to every saved device (or only the one with `onlyEndpoint`); drops subscriptions the browser has revoked.
// Returns how many succeeded.
export async function sendToUser(user, message, onlyEndpoint = '') {
  await vapidKeys();
  let sent = 0;
  const keep = [];
  for (const sub of user.reminder.subscriptions) {
    if (onlyEndpoint && sub.endpoint !== onlyEndpoint) { keep.push(sub); continue; }
    try { await webpush.sendNotification(sub, JSON.stringify(message), { TTL: 6 * 3600 }); sent++; keep.push(sub); }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) continue; // device unsubscribed
      console.error('push failed', e.statusCode, e.body);
      keep.push(sub);
    }
  }
  user.reminder.subscriptions = keep;
  return sent;
}
