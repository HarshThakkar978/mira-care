// Once a day (the 14:00 UTC reminders run): Cura's own messages to each person, from nudges.js.
// Visit nudges every day; the week recap on Sundays (New York date). Runs at most once per day.
import Anthropic from '@anthropic-ai/sdk';
import { rcmd, allUserIds, getUsers, saveUser } from './store.js';
import { MODEL, today } from './respond.js';
import { normalizeUser } from './mira.js';
import { loadTips } from './community.js';
import { visitNudge, recapData, tipNews, recapText } from './nudges.js';

const RECAP_PROMPT = `Write a short weekly recap for someone tracking perimenopause in the Cura app, from their own entries below. Three short parts, plain and warm, second person:
- most_common: their most frequent symptom this week and how strong it tended to be (e.g. "night sweats, 4 nights, mostly 6-7").
- best_day: the day that went best and why, in a few words (e.g. "Thursday, no symptoms and you felt good").
- noticed: one pattern worth knowing, like a link between symptoms, sleep, their plan or their period. If nothing stands out, say something encouraging about them checking in.
Each part under 18 words. Don't diagnose or explain causes medically.`;

async function recapParts(data) {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL(), max_tokens: 2000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false, required: ['most_common', 'best_day', 'noticed'], properties: { most_common: { type: 'string' }, best_day: { type: 'string' }, noticed: { type: 'string' } } } } },
    messages: [{ role: 'user', content: `${RECAP_PROMPT}\n\n<entries>${JSON.stringify(data)}</entries>` }]
  });
  if (res.stop_reason !== 'end_turn') return null;
  try { return JSON.parse(res.content.filter(b => b.type === 'text').map(b => b.text).join('')); } catch { return null; }
}

export async function userDaily({ force = false } = {}) {
  const date = today();
  if (!force && (await rcmd(['SET', `cura:userdaily:${date}`, '1', 'NX', 'EX', 172800])) !== 'OK') return { skipped: 'already ran today' };
  const sunday = new Date(date + 'T12:00:00Z').getUTCDay() === 0;
  const tips = sunday ? await loadTips() : [];
  const out = { nudges: 0, recaps: 0 };
  for (const [key, raw] of await getUsers(await allUserIds())) {
    try {
      const user = normalizeUser(raw);
      const add = [];
      const nudge = visitNudge(user, date);
      if (nudge) { add.push(nudge); out.nudges++; }
      const data = sunday && user.lastRecap !== date ? recapData(user, date) : null;
      if (data) {
        const parts = await recapParts(data).catch(e => { console.error('recap failed', key, e); return null; });
        if (parts) {
          const text = recapText(parts, tipNews(key, tips, date));
          add.push({ from: 'mira', at: new Date().toISOString(), kind: 'recap', text, note: `You sent them their weekly recap: ${text.replace(/\n/g, ' ')}` });
          user.lastRecap = date; out.recaps++;
        }
      }
      if (!add.length) continue;
      user.transcript = [...user.transcript, ...add].slice(-300);
      await saveUser(key, user);
    } catch (e) { console.error('user daily failed', key, e); }
  }
  return out;
}
