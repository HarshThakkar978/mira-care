// Mira's brain: takes one incoming text, lets Claude log it with tools, returns the reply.
// Channel-agnostic: WhatsApp today, iMessage (or anything else) later can call handleIncoming too.

const HISTORY_TURNS = 16;
const MAX_TOOL_ROUNDS = 6;

export const SYSTEM_PROMPT = `You are Mira, a warm, calm companion that people text on WhatsApp to keep track of their perimenopause: how they feel, their period, and symptoms. You help them remember what happened so they can talk to their clinician with clear notes.

How you text:
- Short, friendly messages like a thoughtful friend. Usually 1-3 sentences. No long lists unless they ask for a summary.
- Ask at most one question at a time. Never interrogate; everything is optional and it's fine to skip.
- WhatsApp formatting only: *bold*, _italic_, simple line breaks. No markdown headings or tables.
- Match their language and energy. Emojis sparingly.

What you do:
- Whenever they mention a symptom, a period starting, how they feel, an appointment, or something to raise at a visit, save it with your tools right away, then briefly confirm what you saved in plain words (e.g. "Saved: hot flashes, 7/10, kept you up").
- If a symptom has no intensity, you may ask once for a 1-10 rating, but log it anyway first.
- Dates: work out the real date from words like "yesterday" or "last Tuesday" using today's date given in the context. If unclear, assume today.
- Use get_my_history before answering questions about their past entries, patterns or for a visit summary.
- If they made a mistake, use delete_entry and log the corrected version.
- New person (no name saved yet): greet them, explain in one line what you do, and ask what to call them. Save it with save_profile.

Boundaries:
- You do not diagnose, interpret what symptoms mean medically, or recommend treatments or doses. You can say a pattern is worth raising with their clinician.
- If they describe something that sounds urgent (very heavy bleeding soaking a pad an hour, fainting, chest pain, severe sudden pain, thoughts of harming themselves), gently and clearly tell them to contact a doctor or emergency services now (911 in the US, or 988 for a mental health crisis).

They can text "DELETE ALL" to erase everything Mira saved about them.`;

export const TOOLS = [
  {
    name: 'log_symptoms',
    description: 'Save one or more symptoms the person noticed on a given date. Call this whenever they mention a symptom.',
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
    name: 'get_my_history',
    description: 'Read their saved entries from the last N days (symptoms, period starts, check-ins, visit notes, profile). Each entry has an id usable with delete_entry.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 1, maximum: 365, description: 'How many days back. Default 30.' } }
    }
  },
  {
    name: 'delete_entry',
    description: 'Delete one saved entry by id (get ids from get_my_history or from earlier tool results).',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['symptom', 'period_start', 'checkin', 'visit_note'] },
        id: { type: 'string' }
      },
      required: ['kind', 'id']
    }
  }
];

export function freshUser() {
  return { profile: { name: '', appointmentDate: '', clinician: '' }, cycleStarts: [], symptoms: [], checkins: [], preNotes: [], history: [], createdAt: new Date().toISOString() };
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
      const entry = { id: newId(), date: dateOr(input.date), name: String(s.name).slice(0, 80), severity: sev >= 1 && sev <= 10 ? Math.round(sev) : '', impact: String(s.impact || '').slice(0, 200), notes: String(s.notes || '').slice(0, 500), source: 'whatsapp' };
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
    const entry = { id: newId(), date: dateOr(input.date), savedAt: new Date().toISOString(), feeling: String(input.feeling || '').slice(0, 240), source: 'whatsapp' };
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
  if (name === 'get_my_history') {
    const days = Number(input.days) > 0 ? Math.min(Number(input.days), 365) : 30;
    const from = new Date(new Date(today + 'T12:00:00Z').getTime() - days * 86400000).toISOString().slice(0, 10);
    const recent = arr => arr.filter(x => x.date >= from).sort((a, b) => a.date.localeCompare(b.date));
    return {
      today, from, profile: user.profile,
      period_starts: [...user.cycleStarts].sort((a, b) => a.date.localeCompare(b.date)),
      symptoms: recent(user.symptoms),
      checkins: recent(user.checkins).map(({ id, date, feeling }) => ({ id, date, feeling })),
      visit_notes: user.preNotes
    };
  }
  if (name === 'delete_entry') {
    const key = { symptom: 'symptoms', period_start: 'cycleStarts', checkin: 'checkins', visit_note: 'preNotes' }[input.kind];
    if (!key) return { ok: false, error: 'unknown kind' };
    const before = user[key].length;
    user[key] = user[key].filter(x => x.id !== input.id);
    return { ok: user[key].length < before, deleted: before - user[key].length };
  }
  return { ok: false, error: `unknown tool ${name}` };
}

function contextNote(user, today) {
  const lastPeriod = [...user.cycleStarts].sort((a, b) => b.date.localeCompare(a.date))[0];
  const lines = [
    `Today is ${weekday(today)}, ${today}.`,
    user.profile.name ? `Their name: ${user.profile.name}.` : 'New person: no name saved yet.',
    lastPeriod ? `Last period start: ${lastPeriod.date}.` : 'No period start saved yet.',
    user.profile.appointmentDate ? `Next appointment: ${user.profile.appointmentDate}${user.profile.clinician ? ' with ' + user.profile.clinician : ''}.` : '',
    `Saved so far: ${user.symptoms.length} symptoms, ${user.checkins.length} check-ins, ${user.preNotes.length} visit notes.`
  ];
  return lines.filter(Boolean).join(' ');
}

// deps: { claude: (params) => Promise<Message>, model, effort, fallbacks }
// Mutates `user` (state + history) and returns the reply text.
export async function handleIncoming(user, text, today, deps) {
  if (text.trim().toUpperCase() === 'DELETE ALL') {
    Object.assign(user, freshUser());
    return 'Done. I erased everything I had saved for you. Text me anytime to start fresh.';
  }

  const history = (user.history || []).slice(-HISTORY_TURNS);
  const messages = history.map(h => ({ role: h.role, content: h.text }));
  messages.push({ role: 'user', content: `<context>${contextNote(user, today)}</context>\n\n${text}` });

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
        return { type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(result), is_error: result.ok === false };
      })
    });
  }

  reply = (reply || 'Got it, saved ✓').slice(0, 4000);
  user.history = [...history, { role: 'user', text }, { role: 'assistant', text: reply }].slice(-HISTORY_TURNS);
  return reply;
}
