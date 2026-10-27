// Tests Mira's conversation logic with a fake Claude (free, offline).
// Run: /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m dev/mira-logic.test.mjs
//  or: node dev/mira-logic.test.mjs
import { handleIncoming, freshUser, localDate, runTool, normalizeUser } from '../api/_lib/mira.js';

const log = (...a) => (globalThis.print || console.log)(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
let fail = 0;
const check = (c, msg) => { if (!c) { fail++; log('FAIL', msg); } else log('ok', msg); };
function fakeClaude(script) {
  let i = 0; const seen = [];
  const fn = async params => { seen.push(JSON.parse(JSON.stringify(params))); return typeof script === 'function' ? script(params) : script[i++]; };
  fn.seen = seen; return fn;
}
const today = '2026-10-23';

(async () => {
  // Logging, profile, history and request shape
  const user = freshUser();
  const claude = fakeClaude([
    { stop_reason: 'tool_use', content: [
      { type: 'thinking', thinking: '', signature: 'x' },
      { type: 'tool_use', id: 't1', name: 'log_symptoms', input: { date: '2026-10-22', symptoms: [{ name: 'hot flashes', severity: 7, impact: 'woke me up' }] } },
      { type: 'tool_use', id: 't2', name: 'save_profile', input: { name: 'Priya' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Got it, logged the hot flashes at 7.' }] }
  ]);
  let rounds = 0;
  const reply = await handleIncoming(user, "I'm Priya. hot flashes last night, like a 7, woke me up", today, { model: 'claude-opus-5-5', effort: 'low', fallbacks: true, channel: 'app', claude, onRound: () => rounds++ });
  check(reply.startsWith('Got it'), 'reply text returned');
  check(rounds === 2, 'onRound fires once per Claude call');
  check(user.symptoms.length === 1 && user.symptoms[0].date === '2026-10-22' && user.symptoms[0].severity === 7, 'symptom saved with date + severity');
  check(user.profile.name === 'Priya', 'name saved');
  check(user.history.length === 2 && !user.history[0].text.includes('<context>'), 'history stores clean text');
  const p2 = claude.seen[1];
  check(p2.messages[2].content.length === 2 && p2.messages[2].content[0].type === 'tool_result', 'tool results sent back in one message');
  check(p2.messages[1].content[0].type === 'thinking', 'assistant content passed back unchanged');
  check(p2.fallbacks === 'default' && p2.betas[0] === 'server-side-fallback-2026-07-01', 'fallbacks set when requested');
  check(claude.seen[0].messages[0].content.includes('Today is Friday, 2026-10-23') && claude.seen[0].messages[0].content.includes('skip any introduction'), 'context has date and first-message note');

  // Second turn: history, bad date falls back to today, no fallbacks on Haiku
  const c2 = fakeClaude([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a', name: 'log_period_start', input: { date: 'bad' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Noted.' }] }
  ]);
  await handleIncoming(user, 'my period started', today, { model: 'claude-haiku-5-5', effort: 'low', fallbacks: false, claude: c2 });
  check(user.cycleStarts.length === 1 && user.cycleStarts[0].date === today, 'invalid date falls back to today');
  check(c2.seen[0].messages.length === 3 && c2.seen[0].messages[0].role === 'user', 'previous turns sent as history');
  check(!('fallbacks' in c2.seen[0]), 'no fallbacks on haiku');

  // update_entry edits in place and is logged; context shows ids and actions
  const u = freshUser();
  await handleIncoming(u, 'crazy cramps today', '2026-10-26', { model: 'm', effort: 'low', channel: 'app', claude: fakeClaude(p => p.messages.length === 1
    ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a', name: 'log_symptoms', input: { date: '2026-10-26', symptoms: [{ name: 'cramps' }] } }] }
    : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Oof. How strong?' }] }) });
  const id = u.symptoms[0].id;
  const c3 = fakeClaude(p => p.messages.length === 3
    ? { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'b', name: 'update_entry', input: { kind: 'symptom', id, severity: 8 } }] }
    : { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Got it, 8.' }] });
  await handleIncoming(u, 'a solid 8', '2026-10-26', { model: 'm', effort: 'low', channel: 'app', claude: c3 });
  const ctx = c3.seen[0].messages[2].content;
  check(ctx.includes(`symptom id=${id}`) && ctx.includes('saved cramps') && !ctx.includes('first message'), 'context shows entries + actions');
  check(u.symptoms.length === 1 && u.symptoms[0].severity === 8, 'updated in place, no duplicate');
  check(u.actionLog[1].includes(`updated symptom [id=${id}]: severity=8`), 'update logged');
  check(runTool(u, 'update_entry', { kind: 'symptom', id: 'nope', severity: 3 }, '2026-10-26').ok === false, 'bad id rejected');

  // Stop reasons
  check((await handleIncoming(freshUser(), 'x', today, { model: 'm', effort: 'low', claude: fakeClaude([{ stop_reason: 'refusal', content: [] }]) })).startsWith('Sorry'), 'refusal handled');
  const cut = freshUser();
  await handleIncoming(cut, 'x', today, { model: 'm', effort: 'low', claude: fakeClaude([{ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Partial' }, { type: 'tool_use', id: 'z', name: 'log_symptoms', input: { date: today, symptoms: [{ name: 'half' }] } }] }]) });
  check(cut.symptoms.length === 0, 'tools not run when cut off at max_tokens');

  // DELETE ALL, history cap, after-visit notes, old records
  const d = freshUser(); d.symptoms.push({ id: 'x', date: today, name: 'a' }); d.profile.name = 'A';
  const r4 = await handleIncoming(d, ' delete all ', today, { claude: null });
  check(d.symptoms.length === 0 && d.profile.name === '' && r4.startsWith('Done'), 'DELETE ALL wipes');
  const u5 = freshUser();
  for (let i = 0; i < 12; i++) await handleIncoming(u5, 'hi ' + i, today, { model: 'm', effort: 'low', claude: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hey' }] }) });
  check(u5.history.length === 16 && u5.history[0].role === 'user', 'history capped at 16, starts with user');
  const old = normalizeUser({ profile: { name: 'A' }, symptoms: [{ id: 'x', date: '2026-10-01', name: 'cramps' }] });
  check(old.postNotes.length === 0 && old.agenda.topics.length === 0 && old.actionLog.length === 0 && old.profile.name === 'A', 'normalizes old records');
  const n = freshUser(); runTool(n, 'add_after_visit_note', { text: 'track sleep' }, today);
  check(runTool(n, 'get_my_history', {}, today).after_visit_notes.length === 1, 'after-visit notes saved');
  check(/^\d{4}-\d{2}-\d{2}$/.test(localDate('America/New_York')), 'localDate format');

  log(fail ? `${fail} FAILED` : 'ALL PASSED');
})().catch(e => log('CRASH', String(e), e.stack));

// Patterns: Mira gets a two-week summary to connect today's message to recent days.
(async () => {
  const u = freshUser();
  u.symptoms.push({ id: 'a', date: '2026-10-20', name: 'Fatigue', severity: 6 }, { id: 'b', date: '2026-10-22', name: 'fatigue', severity: 8 }, { id: 'c', date: '2026-09-01', name: 'old thing', severity: 3 });
  u.checkins.push({ id: 'd', date: '2026-10-22', feeling: 'wiped out' });
  u.cycleStarts.push({ id: 'e', date: '2026-10-10' });
  const c = fakeClaude([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }]);
  await handleIncoming(u, 'tired again', '2026-10-23', { model: 'm', effort: 'low', claude: c });
  const ctx = c.seen[0].messages[0].content;
  const check2 = (ok, m) => log(ok ? 'ok' : 'FAIL', m);
  check2(ctx.includes('- fatigue: 2 days, average 7.0/10, peak 8'), 'patterns group symptoms over 14 days');
  check2(!ctx.includes('old thing'), 'patterns skip entries older than 14 days');
  check2(ctx.includes('"wiped out"') && ctx.includes('day 14 since their last period started'), 'patterns include check-ins and cycle day');
})();

// Tap-to-answer buttons: offered only in the app, validated, and passed to the caller.
import { cleanQuickReplies, QUICK_REPLY_TOOL } from '../api/_lib/mira.js';
(async () => {
  const ok = (c, m) => log(c ? 'ok' : 'FAIL', m);
  let got = null;
  const u = freshUser();
  const c = fakeClaude([
    { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Oof. How strong were they, 1 to 10?' }, { type: 'tool_use', id: 'q', name: 'show_quick_replies', input: { kind: 'scale', low_label: 'Barely', high_label: 'Unbearable' } }] },
    { stop_reason: 'end_turn', content: [] }
  ]);
  const r = await handleIncoming(u, 'cramps today', '2026-10-27', { model: 'm', effort: 'low', channel: 'app', claude: c, onQuickReplies: q => { got = q; } });
  ok(c.seen[0].tools.some(t => t.name === QUICK_REPLY_TOOL.name), 'quick replies offered in the app');
  ok(got && got.kind === 'scale' && got.low === 'Barely', 'scale passed to the caller');
  ok(r === 'Oof. How strong were they, 1 to 10?', 'text from the tool round kept when the last round is empty');
  const w = fakeClaude([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] }]);
  await handleIncoming(freshUser(), 'hi', '2026-10-27', { model: 'm', effort: 'low', channel: 'whatsapp', claude: w });
  ok(!w.seen[0].tools.some(t => t.name === QUICK_REPLY_TOOL.name), 'not offered on WhatsApp');
  ok(cleanQuickReplies({ kind: 'options', options: ['Yes'] }) === null, 'options need at least two choices');
  ok(cleanQuickReplies({ kind: 'multi', options: ['a', 'b', 'a', '', 'c'] }).options.join() === 'a,b,c', 'options de-duplicated and trimmed');
})();
