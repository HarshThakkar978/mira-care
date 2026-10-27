// Runs from Vercel Cron once at the start of every hour (see vercel.json).
// Sends each person their daily reminder once their chosen local hour has arrived,
// unless they already logged something today. Safe to call more than once: lastSent stops repeats.
// Once a day (the 14:00 UTC run, 10 AM in New York) it also does the community's daily jobs.
import { loadUser, storeUser } from './_lib/respond.js';
import { communityDaily } from './_lib/community.js';
import { reminderUsers, removeReminderUser } from './_lib/store.js';
import { localNow, reminderMessage, sendToUser } from './_lib/push.js';

const COMMUNITY_HOUR_UTC = 14;

export async function GET(request) {
  const h = Number(new URL(request.url).searchParams.get('h'));
  const community = h === COMMUNITY_HOUR_UTC ? await communityDaily().catch(e => { console.error('community daily failed', e); return { error: true }; }) : undefined;
  const keys = await reminderUsers();
  let sent = 0, skipped = 0;
  for (const key of keys) {
    try {
      const user = await loadUser(key);
      const r = user.reminder;
      if (!r.enabled || !r.subscriptions.length) { await removeReminderUser(key); continue; }
      const { hour, date } = localNow(r.tz);
      // Hobby cron can fire up to 59 minutes late, so "at or after the chosen hour, not yet today" is the rule.
      if (hour < r.hour || r.lastSent === date) { skipped++; continue; }
      const loggedToday = user.checkins.some(c => c.date === date) || user.symptoms.some(s => s.date === date) || user.cycleStarts.some(c => c.date === date);
      r.lastSent = date;
      if (!loggedToday && await sendToUser(user, reminderMessage(user, date))) sent++;
      await storeUser(key, user);
    } catch (e) { console.error('reminder failed', key, e); }
  }
  return Response.json({ checked: keys.length, sent, skipped, ...(community ? { community } : {}) });
}
