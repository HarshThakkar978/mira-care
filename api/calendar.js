// The private calendar feed people subscribe to from Apple or Google Calendar: /cal/<token>.ics (see vercel.json).
// It lists their plan from the community and their next appointment, and updates by itself.
import { loadUser } from './_lib/respond.js';
import { userForCalendar } from './_lib/community.js';
import { buildIcs } from './_lib/community-logic.js';

export async function GET(request) {
  const url = new URL(request.url);
  const token = String(url.searchParams.get('t') || '').replace(/\.ics$/, '');
  const key = await userForCalendar(token);
  const user = key ? await loadUser(key) : null;
  if (!user || user.calToken !== token) return new Response('Calendar not found', { status: 404 });
  return new Response(buildIcs(user, { host: url.host }), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="cura.ics"', 'Cache-Control': 'no-cache, max-age=0' }
  });
}
