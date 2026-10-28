// Messages Cura sends on her own, decided from the person's data (pure, so they can be tested offline).
// Each one is a transcript message from Cura; `note` tells Cura what she asked when they reply.

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const between = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// Around an appointment: a week before (agenda), the day before (summary), and a day or two after (how did it go).
// At most one a day; each is sent once per appointment.
export function visitNudge(user, todayStr) {
  const appt = user.profile && user.profile.appointmentDate;
  if (!isDate(appt)) return null;
  user.nudges = user.nudges || {};
  const days = between(todayStr, appt);
  const who = user.profile.clinician ? ` with ${user.profile.clinician}` : '';
  const once = (key, msg) => { if (user.nudges[key]) return null; user.nudges[key] = todayStr; return { from: 'mira', at: new Date().toISOString(), kind: 'nudge', ...msg }; };
  if (days >= 5 && days <= 7) return once(`agenda-${appt}`, {
    text: `Your appointment${who} is ${days === 7 ? 'a week away' : `in ${days} days`}. Want me to turn your notes into an agenda you can bring? 📋`,
    cta: { label: 'Draft my agenda', action: 'draft-agenda' }
  });
  if (days === 1) return once(`summary-${appt}`, {
    text: `Your appointment${who} is tomorrow. Your one-page summary is ready to show or print. You've got this 💜`,
    cta: { label: 'Open my summary', route: 'report' }
  });
  if (days <= -1 && days >= -3) return once(`after-${appt}`, {
    text: `How did your appointment${who} go?`,
    ui: { kind: 'options', options: ['It went well', 'It was mixed', 'Not great'] },
    note: `You asked how their appointment on ${appt}${who} went. Listen first. Then help them save what was said and any next steps with add_after_visit_note, one short note at a time.`
  });
  return null;
}

// Sunday: is there enough from the last 7 days for a recap?
export function recapData(user, todayStr) {
  const since = addDays(todayStr, -6);
  const symptoms = (user.symptoms || []).filter(s => s.date >= since && s.date <= todayStr);
  const checkins = (user.checkins || []).filter(c => c.date >= since && c.date <= todayStr);
  const periods = (user.cycleStarts || []).filter(c => c.date >= since && c.date <= todayStr);
  const days = new Set([...symptoms, ...checkins].map(x => x.date)).size;
  if (days < 2) return null;
  return {
    today: todayStr, days_checked_in: days,
    symptoms: symptoms.map(({ date, name, severity }) => ({ date, name, severity: severity || null })),
    checkins: checkins.map(({ date, feeling }) => ({ date, feeling })),
    period_starts: periods.map(p => p.date),
    plan: (user.plan || []).filter(p => p.status === 'active').map(p => ({ title: p.title, days_done_this_week: (p.done || []).filter(d => d >= since).length }))
  };
}

// "3 people added your fan tip to their plan this week": tips this person shared that others picked up.
export function tipNews(key, tips, todayStr) {
  const since = addDays(todayStr, -6);
  const mine = tips.filter(t => t.author === key && t.status === 'approved')
    .map(t => ({ title: t.title, n: new Set((t.adds || []).filter(a => a.at.slice(0, 10) >= since && a.key !== key).map(a => a.key)).size }))
    .filter(t => t.n).sort((a, b) => b.n - a.n);
  if (!mine.length) return '';
  const t = mine[0];
  return `${t.n === 1 ? 'Someone' : `${t.n} people`} in the Circle added your tip "${t.title}" to their plan this week. You're helping 💜`;
}

export function recapText(parts, news) {
  const lines = ['Your week in 3 lines 💜', `• Most common: ${parts.most_common}`, `• Best day: ${parts.best_day}`, `• I noticed: ${parts.noticed}`];
  if (news) lines.push('', news);
  return lines.join('\n');
}
