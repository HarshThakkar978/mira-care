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
    webpush.setVapidDetails('https://curadaily.vercel.app', keys.publicKey, keys.privateKey);
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

export function reminderMessage(user, date) {
  const name = user.profile.name ? `, ${user.profile.name}` : '';
  const appt = user.profile.appointmentDate;
  const tomorrow = new Date(date + 'T12:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (appt && appt === tomorrow.toISOString().slice(0, 10)) {
    return { title: 'Your appointment is tomorrow', body: 'Want Cura to pull your notes into an agenda? Tap to open Visits.', url: '/#visit' };
  }
  // A message Cura left today (a visit nudge or the week recap) comes first.
  const note = [...(user.transcript || [])].reverse().find(m => m.from === 'mira' && (m.kind === 'nudge' || m.kind === 'recap') && String(m.at).slice(0, 10) >= date);
  if (note) return { title: note.kind === 'recap' ? 'Your week with Cura 💜' : `Hi${name} 👋`, body: note.text.split('\n')[0].slice(0, 140), url: note.cta && note.cta.route ? `/#${note.cta.route}` : '/#chat' };
  const todo = (user.plan || []).filter(p => p.status === 'active' && !(p.done || []).includes(date));
  if (todo.length) return { title: `Hi${name} 👋`, body: `How are you feeling today? And on your plan: ${todo[0].title.replace(/\.$/, '')}${todo.length > 1 ? ` (+${todo.length - 1} more)` : ''} 🌿`, url: '/#today' };
  const lines = ['How are you feeling today? Tap to tell Cura.', 'A quick check-in takes 10 seconds 💚', 'Anything you noticed today? Cura will keep track.'];
  const pick = lines[new Date(date + 'T12:00:00Z').getUTCDate() % lines.length];
  return { title: `Hi${name} 👋`, body: pick, url: '/#chat' };
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
