// Mira's brain: takes one incoming text, lets Claude log it with tools, returns the reply.
// Channel-agnostic: the Mira app, WhatsApp, and later iMessage all call handleIncoming.

const HISTORY_TURNS = 16;
const MAX_TOOL_ROUNDS = 6;

export const SYSTEM_PROMPT = `You are Mira, a companion people text to keep track of their perimenopause: how they feel, their periods and their symptoms, so they have clear notes for their clinician.

## How you talk
- Text like a caring friend who listens well: short, natural and plain. Most replies are one or two sentences, well under 40 words. Go longer only when they ask for a summary or explanation.
- React to what they actually said first. If it sounds hard, say so simply and kindly ("Oof, that sounds rough.") before anything practical.
- Don't introduce yourself or explain what you do unless they ask. Don't repeat their words back to them.
- Saving happens quietly in the background. Confirm in a few words at most ("Noted.", "Got it, logged the cramps at 8."). Never list everything you saved; the app already shows it.
- At most one question per reply, and only when the answer is useful. Many replies need no question at all. Don't end every message with a question.
- Ask about any detail once. For a new symptom, one gentle follow-up is enough, usually how strong it was (1-10) or what it got in the way of. If they don't answer or say "nothing" or "that's all", let it go and close warmly in one short line.
- Their name is nice to know but it isn't a form. Never ask for it in your first reply, and never right after they share something worrying or painful. If it comes up naturally later in a light moment, ask casually; it's fine never to ask. If they tell you their name, save it.
- Plain text. Use *bold* rarely, no headings or bullet lists unless you're giving a summary they asked for. Emojis rarely.

## Keeping their notes
- Save things as soon as they're mentioned, using your tools: symptoms, period starts, how they feel today, appointments, things to raise at a visit, and what happened at a visit.
- <recent_entries> in the context shows what's already saved, with ids. If they add detail to something already there (an intensity, how it affected them), use update_entry on that entry. Don't log it a second time.
- <your_recent_actions> lists what you actually saved, changed or deleted in earlier messages. Trust it over your memory of the conversation.
- Only say you saved, changed or deleted something if you called the tool for it in this turn. Never describe work you didn't do. If you notice a mistake, fix it with the tools and mention it in a few words, once.
- Dates: turn "last night", "yesterday" or "on Tuesday" into a real date using today's date from the context. If it's unclear, use today.
- Use get_my_history before answering questions about their past entries, patterns, or a summary for a visit.

## Boundaries
- Don't diagnose, say what symptoms mean medically, or suggest treatments or doses.
- If something is new, severe or getting worse, you can say once, in a short phrase, that it's worth mentioning to their clinician. Don't repeat it in later messages.
- Only give urgent-care guidance when they describe a red flag: bleeding that soaks a pad every hour, fainting, chest pain, sudden severe pain, or thoughts of harming themselves. Then say clearly and kindly to contact a doctor or emergency services now (911 in the US, or 988 for a mental health crisis). Don't list red flags otherwise.

They can text "DELETE ALL" to erase everything Mira saved about them.`;

export const TOOLS = [
  {
    name: 'log_symptoms',
    description: 'Save one or more new symptoms the person noticed on a given date. If the same symptom is already in <recent_entries> for that date, use update_entry instead.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date the symptoms happened, YYYY-MM-DD.' },
        symptoms: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Short name in their words, e.g. "hot flashes", "night sweats", "brain fog".' },
              severity: { type: 'integer', minimum: 1, maximum: 10, description: 'Intensity 1-10 if they gave one or it is clear.' },
              impact: { type: 'string', description: 'How it affected their day, e.g. "woke me up twice".' },
              notes: { type: 'string', description: 'Any extra timing or context.' }
            },
            required: ['name']
          }
        }
      },
      required: ['date', 'symptoms']
    }
  },
  {
    name: 'log_period_start',
    description: 'Save the date a period started.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['date']
    }
  },
  {
    name: 'log_feeling',
    description: 'Save how the person is feeling overall today (a daily check-in), in their own words.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        feeling: { type: 'string', description: 'Short summary in their words, e.g. "tired but okay".' }
      },
      required: ['date', 'feeling']
    }
  },
  {
    name: 'save_profile',
    description: 'Save the name they want to be called and/or their next appointment details. Only include fields you are setting.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        appointment_date: { type: 'string', description: 'YYYY-MM-DD' },
        clinician: { type: 'string', description: 'Clinician or clinic name.' }
      }
    }
  },
  {
    name: 'add_visit_note',
    description: 'Save something they want to bring up at their next appointment (a question, concern or change they noticed).',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  },
  {
    name: 'add_after_visit_note',
    description: 'Save something they want to remember from an appointment that already happened (what was said, next steps, things to follow up on).',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  },
  {
    name: 'update_entry',
    description: 'Change a saved symptom or check-in, for example to add an intensity or how it affected them, or to fix a mistake. Use the id from <recent_entries> or get_my_history. Only include the fields you are changing.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['symptom', 'checkin'] },
        id: { type: 'string' },
        name: { type: 'string' },
        severity: { type: 'integer', minimum: 1, maximum: 10 },
        impact: { type: 'string' },
        notes: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        feeling: { type: 'string', description: 'For check-ins only.' }
      },
      required: ['kind', 'id']
    }
  },
  {
    name: 'get_my_history',
    description: 'Read their saved entries from the last N days (symptoms, period starts, check-ins, visit notes, profile). Each entry has an id usable with update_entry and delete_entry.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 1, maximum: 365, description: 'How many days back. Default 30.' } }
    }
  },
  {
    name: 'delete_entry',
    description: 'Delete one saved entry by id, for example a duplicate or something logged by mistake.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['symptom', 'period_start', 'checkin', 'visit_note', 'after_note'] },
        id: { type: 'string' }
      },
      required: ['kind', 'id']
    }
  }
];

export function freshUser() {
  return {
    profile: { name: '', appointmentDate: '', clinician: '' },
    cycleStarts: [], symptoms: [], checkins: [], preNotes: [], postNotes: [],
    agenda: { summary: '', topics: [], questions: [] },
    followup: { summary: '', steps: [], questions: [] },
    reminder: { enabled: false, hour: 20, tz: '', subscriptions: [], lastSent: '' },
    history: [], actionLog: [], transcript: [], createdAt: new Date().toISOString()
  };
}

// Fills in fields added after a record was first saved, so older users keep working.
export function normalizeUser(user) {
  const base = freshUser();
  const out = { ...base, ...(user || {}) };
  out.profile = { ...base.profile, ...(out.profile || {}) };
  out.agenda = { ...base.agenda, ...(out.agenda || {}) };
  out.followup = { ...base.followup, ...(out.followup || {}) };
  out.reminder = { ...base.reminder, ...(out.reminder || {}) };
  if (!Array.isArray(out.reminder.subscriptions)) out.reminder.subscriptions = [];
  for (const k of ['cycleStarts', 'symptoms', 'checkins', 'preNotes', 'postNotes', 'history', 'actionLog', 'transcript']) if (!Array.isArray(out[k])) out[k] = [];
  return out;
}

export function localDate(timeZone, d = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}

function weekday(date) {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const newId = () => Math.random().toString(36).slice(2, 10);

// Runs one tool against the user's saved state. Returns a JSON-able result for Claude.
export function runTool(user, name, input, today) {
  input = input || {};
  const dateOr = d => (isDate(d) ? d : today);
  if (name === 'log_symptoms') {
    const list = Array.isArray(input.symptoms) ? input.symptoms : [];
    const saved = list.filter(s => s && s.name).map(s => {
      const sev = Number(s.severity);
      const entry = { id: newId(), date: dateOr(input.date), name: String(s.name).slice(0, 80), severity: sev >= 1 && sev <= 10 ? Math.round(sev) : '', impact: String(s.impact || '').slice(0, 200), notes: String(s.notes || '').slice(0, 500), source: 'chat' };
      user.symptoms.push(entry);
      return entry;
    });
    return { ok: true, saved };
  }
  if (name === 'log_period_start') {
    const date = dateOr(input.date);
    const existing = user.cycleStarts.find(x => x.date === date);
    if (existing) return { ok: true, already_saved: existing };
    const entry = { id: newId(), date };
    user.cycleStarts.push(entry);
    return { ok: true, saved: entry };
  }
  if (name === 'log_feeling') {
    const entry = { id: newId(), date: dateOr(input.date), savedAt: new Date().toISOString(), feeling: String(input.feeling || '').slice(0, 240), source: 'chat' };
    user.checkins.push(entry);
    return { ok: true, saved: entry };
  }
  if (name === 'save_profile') {
    if (input.name) user.profile.name = String(input.name).slice(0, 60);
    if (isDate(input.appointment_date)) user.profile.appointmentDate = input.appointment_date;
    if (input.clinician) user.profile.clinician = String(input.clinician).slice(0, 80);
    return { ok: true, profile: user.profile };
  }
  if (name === 'add_visit_note') {
    if (!input.text) return { ok: false, error: 'text is required' };
    const entry = { id: newId(), date: today, text: String(input.text).slice(0, 1000) };
    user.preNotes.push(entry);
    return { ok: true, saved: entry };
  }
  if (name === 'add_after_visit_note') {
    if (!input.text) return { ok: false, error: 'text is required' };
    const entry = { id: newId(), date: today, text: String(input.text).slice(0, 1000) };
    user.postNotes.push(entry);
    return { ok: true, saved: entry };
  }
  if (name === 'update_entry') {
    const list = { symptom: user.symptoms, checkin: user.checkins }[input.kind];
    const entry = list && list.find(x => x.id === input.id);
    if (!entry) return { ok: false, error: 'No entry with that id. Check <recent_entries> or get_my_history.' };
    if (input.kind === 'symptom') {
      if (input.name) entry.name = String(input.name).slice(0, 80);
      const sev = Number(input.severity);
      if (sev >= 1 && sev <= 10) entry.severity = Math.round(sev);
      if (input.impact !== undefined) entry.impact = String(input.impact).slice(0, 200);
      if (input.notes !== undefined) entry.notes = String(input.notes).slice(0, 500);
    } else if (input.feeling) entry.feeling = String(input.feeling).slice(0, 240);
    if (isDate(input.date)) entry.date = input.date;
    return { ok: true, updated: entry };
  }
  if (name === 'get_my_history') {
    const days = Number(input.days) > 0 ? Math.min(Number(input.days), 365) : 30;
    const from = new Date(new Date(today + 'T12:00:00Z').getTime() - days * 86400000).toISOString().slice(0, 10);
    const recent = arr => arr.filter(x => x.date >= from).sort((a, b) => a.date.localeCompare(b.date));
    return {
      today, from, profile: user.profile,
      period_starts: [...user.cycleStarts].sort((a, b) => a.date.localeCompare(b.date)),
      symptoms: recent(user.symptoms),
      checkins: recent(user.checkins).map(({ id, date, feeling }) => ({ id, date, feeling })),
      visit_notes: user.preNotes,
      after_visit_notes: user.postNotes
    };
  }
  if (name === 'delete_entry') {
    const key = { symptom: 'symptoms', period_start: 'cycleStarts', checkin: 'checkins', visit_note: 'preNotes', after_note: 'postNotes' }[input.kind];
    if (!key) return { ok: false, error: 'unknown kind' };
    const before = user[key].length;
    user[key] = user[key].filter(x => x.id !== input.id);
    return { ok: user[key].length < before, deleted: before - user[key].length };
  }
  return { ok: false, error: `unknown tool ${name}` };
}

const sevText = s => (s.severity ? `${s.severity}/10` : 'no intensity yet');

// Facts Mira needs each turn: date, profile, and what's actually saved recently (with ids),
// so she updates entries instead of duplicating them and never has to guess what she did.
function contextNote(user, today, channel) {
  const lastPeriod = [...user.cycleStarts].sort((a, b) => b.date.localeCompare(a.date))[0];
  const since = new Date(new Date(today + 'T12:00:00Z').getTime() - 3 * 86400000).toISOString().slice(0, 10);
  const recentSym = user.symptoms.filter(s => s.date >= since).sort((a, b) => a.date.localeCompare(b.date));
  const recentCheck = user.checkins.filter(c => c.date >= since);
  const facts = [
    `Today is ${weekday(today)}, ${today}.`,
    user.profile.name ? `Their name: ${user.profile.name}.` : 'Their name: not known yet.',
    lastPeriod ? `Last period start: ${lastPeriod.date}.` : 'No period start saved yet.',
    user.profile.appointmentDate ? `Next appointment: ${user.profile.appointmentDate}${user.profile.clinician ? ' with ' + user.profile.clinician : ''}.` : '',
    !user.history.length && channel === 'app' ? 'This is their first message. The app already showed your welcome message introducing you, so skip any introduction.' : '',
    !user.history.length && channel !== 'app' ? 'This is their first message to you.' : ''
  ].filter(Boolean).join(' ');
  const entries = [
    ...recentSym.map(s => `- symptom id=${s.id} ${s.date}: ${s.name}, ${sevText(s)}${s.impact ? `, impact: ${s.impact}` : ''}`),
    ...recentCheck.map(c => `- checkin id=${c.id} ${c.date}: "${c.feeling}"`)
  ].join('\n') || '(nothing in the last 3 days)';
  const actions = (user.actionLog || []).slice(-10).map(a => `- ${a}`).join('\n') || '(none yet)';
  return `<context>${facts}</context>\n<recent_entries>\n${entries}\n</recent_entries>\n<your_recent_actions>\n${actions}\n</your_recent_actions>`;
}

// One line per tool call for <your_recent_actions>.
function describeAction(name, input, result, at) {
  const when = at.slice(0, 16).replace('T', ' ');
  if (result.ok === false) return `${when} ${name} failed: ${result.error || 'error'}`;
  if (name === 'log_symptoms') return `${when} saved ${(result.saved || []).map(s => `${s.name} (${sevText(s)}) for ${s.date} [id=${s.id}]`).join('; ')}`;
  if (name === 'update_entry') return `${when} updated ${input.kind} [id=${input.id}]: ${Object.keys(input).filter(k => !['kind', 'id'].includes(k)).map(k => `${k}=${input[k]}`).join(', ')}`;
  if (name === 'delete_entry') return `${when} deleted ${input.kind} [id=${input.id}]`;
  if (name === 'log_period_start') return `${when} ${result.already_saved ? 'period start already saved' : 'saved period start'} for ${(result.saved || result.already_saved || {}).date}`;
  if (name === 'log_feeling') return `${when} saved check-in "${input.feeling}"`;
  if (name === 'save_profile') return `${when} saved profile ${JSON.stringify(input)}`;
  if (name === 'add_visit_note') return `${when} saved visit note "${input.text}"`;
  if (name === 'add_after_visit_note') return `${when} saved after-visit note "${input.text}"`;
  return '';
}

// deps: { claude: (params) => Promise<Message>, model, effort, fallbacks, channel: 'app' | 'whatsapp' }
// Mutates `user` (state + history) and returns the reply text.
export async function handleIncoming(user, text, today, deps) {
  if (text.trim().toUpperCase() === 'DELETE ALL') {
    for (const k of Object.keys(user)) delete user[k];
    Object.assign(user, freshUser());
    return 'Done. I erased everything I had saved for you. Text me anytime to start fresh.';
  }

  const history = (user.history || []).slice(-HISTORY_TURNS);
  const messages = history.map(h => ({ role: h.role, content: h.text }));
  messages.push({ role: 'user', content: `${contextNote(user, today, deps.channel)}\n\n${text}` });
  const at = new Date().toISOString();
  const actions = [];

  let reply = '';
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const params = {
      model: deps.model,
      max_tokens: 8000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      output_config: { effort: deps.effort },
      messages
    };
    if (deps.fallbacks) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
    const response = await deps.claude(params);

    if (response.stop_reason === 'refusal') { reply = "Sorry, I can't help with that one. I'm here for your symptoms, cycle and visit notes."; break; }
    // Pass the whole content back unchanged (keeps thinking blocks valid within this turn).
    messages.push({ role: 'assistant', content: response.content });
    const toolUses = response.content.filter(b => b.type === 'tool_use');
    const texts = response.content.filter(b => b.type === 'text').map(b => b.text.trim()).filter(Boolean);
    if (response.stop_reason === 'pause_turn') continue;
    if (!toolUses.length) { reply = texts.join('\n\n'); break; }
    messages.push({
      role: 'user',
      content: toolUses.map(t => {
        let result;
        try { result = runTool(user, t.name, t.input, today); } catch (e) { result = { ok: false, error: String(e.message || e) }; }
        const line = t.name === 'get_my_history' ? '' : describeAction(t.name, t.input || {}, result, at);
        if (line) actions.push(line);
        return { type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(result), is_error: result.ok === false };
      })
    });
  }

  reply = (reply || 'Got it, noted.').replace(/<\/?(context|recent_entries|your_recent_actions)>/g, '').trim().slice(0, 4000);
  user.history = [...history, { role: 'user', text }, { role: 'assistant', text: reply }].slice(-HISTORY_TURNS);
  user.actionLog = [...(user.actionLog || []), ...actions].slice(-30);
  return reply;
}
