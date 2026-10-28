// Cura's community: small groups of people with similar symptoms, sorted by Claude.
// Members just chat. Claude quietly picks out "what worked for me" tips, the team approves them on the
// admin page, and Cura offers them to people with matching symptoms as ideas for their daily plan.
//
// Redis keys: cura:groups (all groups, one JSON value), cura:group:<id>:msgs (a list per group),
// cura:tips (all tips), cura:read:<user> (last message they saw), cura:cal:<token> (calendar link → user).
// Group members and message authors are stored by user key, which never leaves the server.
import Anthropic from '@anthropic-ai/sdk';
import { rcmd, getValue, setValue, getUsers, deleteUser, deleteAccount } from './store.js';
import { MODEL, loadUser, storeUser, today } from './respond.js';
import { normalizeUser } from './mira.js';
import {
  canonSymptom, memberProfile, groupSummary, nearestGroup, checkGrouping, uniqueAlias, welcomeText, freshCommunity, ideasFor, addDays,
  HOW_WELL, WHEN, TIP_ANSWERS, ANSWER_HOW, ONE_GROUP_BELOW
} from './community-logic.js';

const GROUPS = 'cura:groups', TIPS = 'cura:tips';
const msgsKey = id => `cura:group:${id}:msgs`;
const reactKey = id => `cura:group:${id}:reacts`; // message id → { emoji: [user keys] }
export const REACTIONS = ['💜', '🙌', '🤗'];
const readKey = key => `cura:read:${key}`;
const calKey = token => `cura:cal:${token}`;
const MSG_KEEP = 500, PAGE = 100;
const GENERAL = { name: 'The Cura Circle', focus: "Everyone's welcome. Share what you're going through and what's helped." };
const SMALL_REASON = "Cura's community is small for now, so everyone's together. As more people join, Cura will match you with people whose symptoms are closest to yours.";

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const nowIso = () => new Date().toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const loadGroups = async () => (await getValue(GROUPS)) || [];
const saveGroups = groups => setValue(GROUPS, groups);
export const loadTips = async () => (await getValue(TIPS)) || [];
// Team switches, e.g. { circleOpen: true } while testing.
export const loadSettings = async () => (await getValue('cura:settings')) || {};
export async function saveSettings(patch) { const next = { ...(await loadSettings()), ...patch }; await setValue('cura:settings', next); return next; }
const saveTips = tips => setValue(TIPS, tips);

// One writer at a time for the shared group and tip records.
async function withLock(name, fn, ms = 30000) {
  const key = `cura:lock:${name}`, token = newId();
  for (let i = 0; i < 60; i++) {
    if ((await rcmd(['SET', key, token, 'NX', 'PX', ms])) === 'OK') {
      try { return await fn(); } finally { if ((await rcmd(['GET', key])) === token) await rcmd(['DEL', key]); }
    }
    await sleep(200);
  }
  throw new Error('Community is busy, please try again');
}

// One structured answer from Claude, or null if it declined or the output didn't parse.
async function askJson(prompt, schema, { effort = 'low', maxTokens = 4000 } = {}) {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL(), max_tokens: maxTokens,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }]
  });
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return null;
  try { return JSON.parse(res.content.filter(b => b.type === 'text').map(b => b.text).join('')); } catch { return null; }
}

export const displayName = user => (user.community.anonymous || !user.profile.name ? user.community.alias : user.profile.name);

// ---------- Messages ----------
// Each post is read by Claude, so keep it to a sensible number per hour.
export async function allowPost(key, perHour = 40) {
  const k = `cura:rate:${key}:${new Date().toISOString().slice(0, 13)}`;
  const n = await rcmd(['INCR', k]);
  if (n === 1) await rcmd(['EXPIRE', k, 3600]);
  return n <= perHour;
}
export async function postMessage(groupId, from, text, kind = '') {
  const msg = { id: newId(), from, text: String(text).slice(0, 1000), at: nowIso(), ...(kind ? { kind } : {}) };
  await rcmd(['RPUSH', msgsKey(groupId), JSON.stringify(msg)]);
  await rcmd(['LTRIM', msgsKey(groupId), -MSG_KEEP, -1]);
  return msg;
}
export async function groupMessages(groupId, n = PAGE) {
  return ((await rcmd(['LRANGE', msgsKey(groupId), -n, -1])) || []).map(r => JSON.parse(r));
}
async function rewriteMessages(groupId, keep) {
  const all = await groupMessages(groupId, MSG_KEEP);
  const next = all.filter(keep);
  if (next.length === all.length) return 0;
  await rcmd(['DEL', msgsKey(groupId)]);
  if (next.length) await rcmd(['RPUSH', msgsKey(groupId), ...next.map(m => JSON.stringify(m))]);
  return all.length - next.length;
}

// Reactions on group messages, as { msgId: [{ e, n, mine }] } for this person.
async function reactionsFor(groupId, key) {
  const flat = (await rcmd(['HGETALL', reactKey(groupId)])) || [];
  const out = {};
  for (let i = 0; i + 1 < flat.length; i += 2) {
    let r; try { r = JSON.parse(flat[i + 1]); } catch { continue; }
    const list = REACTIONS.filter(e => (r[e] || []).length).map(e => ({ e, n: r[e].length, mine: r[e].includes(key) }));
    if (list.length) out[flat[i]] = list;
  }
  return out;
}
// Tapping a reaction adds it, tapping it again takes it back.
export async function toggleReaction(groupId, msgId, key, emoji) {
  if (!REACTIONS.includes(emoji) || !/^[a-f0-9]{12}$/.test(msgId)) return;
  await withLock(`react:${groupId}`, async () => {
    const raw = await rcmd(['HGET', reactKey(groupId), msgId]);
    const r = raw ? JSON.parse(raw) : {};
    const who = new Set(r[emoji] || []);
    if (who.has(key)) who.delete(key); else who.add(key);
    r[emoji] = [...who];
    await rcmd(['HSET', reactKey(groupId), msgId, JSON.stringify(r)]);
  }, 5000);
}
async function dropReactionsBy(groupId, key) {
  const flat = (await rcmd(['HGETALL', reactKey(groupId)])) || [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const r = JSON.parse(flat[i + 1]); let changed = false;
    for (const e of Object.keys(r)) if (r[e].includes(key)) { r[e] = r[e].filter(k => k !== key); changed = true; }
    if (changed) await rcmd(['HSET', reactKey(groupId), flat[i], JSON.stringify(r)]);
  }
}

// What a member sees: names come from the group's member list (so switching to anonymous renames old messages too).
export async function groupView(key, user, since = '') {
  const g = (await loadGroups()).find(x => x.id === user.community.groupId);
  if (!g) return null;
  const names = new Map(g.members.map(m => [m.key, m.name]));
  const msgs = await groupMessages(g.id);
  if (msgs.length) await rcmd(['SET', readKey(key), msgs[msgs.length - 1].at]);
  const messages = msgs.filter(m => !since || m.at >= since).map(m => ({
    id: m.id, at: m.at, text: m.text, kind: m.kind || '', cura: m.from === 'cura', mine: m.from === key,
    name: m.from === 'cura' ? 'Cura' : m.from === key ? displayName(user) : names.get(m.from) || 'Former member'
  }));
  return { group: { id: g.id, name: g.name, focus: g.focus, size: g.members.length, members: g.members.map(m => (m.key === key ? `${m.name} (you)` : m.name)) }, messages, reactions: await reactionsFor(g.id, key) };
}

export async function unreadCount(key, user) {
  if (!user.community.joined || !user.community.groupId) return 0;
  const [last, msgs] = await Promise.all([rcmd(['GET', readKey(key)]), groupMessages(user.community.groupId, 50)]);
  return msgs.filter(m => m.from !== key && (!last || m.at > last)).length;
}

// ---------- Joining, settings, leaving ----------
const cleanFocus = list => [...new Set((Array.isArray(list) ? list : []).map(x => String(x || '').trim().slice(0, 40)).filter(Boolean))].slice(0, 8);

export async function joinCommunity(key, user, { focus, anonymous }) {
  const c = user.community;
  c.focus = cleanFocus(focus);
  c.anonymous = !!anonymous || !user.profile.name;
  const { group, reason } = await placeMember(key, user);
  Object.assign(c, { joined: true, groupId: group.id, reason, joinedAt: c.joinedAt || nowIso(), notice: null });
  await storeUser(key, user);
  await postMessage(group.id, 'cura', welcomeText(displayName(user), c.focus), 'welcome');
  return group;
}

// Puts a new member in the best existing group. Claude only chooses among groups; new groups are made
// by the daily regrouping, so nobody ever lands in a group on their own.
async function placeMember(key, user) {
  return withLock('groups', async () => {
    const groups = await loadGroups();
    for (const g of groups) g.members = g.members.filter(m => m.key !== key);
    let group, reason;
    if (!groups.length) {
      group = { id: newId(), ...GENERAL, createdAt: nowIso(), members: [], questions: [] };
      groups.push(group); reason = SMALL_REASON;
    } else if (groups.length === 1) {
      group = groups[0]; reason = SMALL_REASON;
    } else {
      const users = await usersByKey(groups.flatMap(g => g.members.map(m => m.key)));
      const summaries = groups.map(g => groupSummary(g, users, today()));
      let pick = null;
      try { pick = await aiPlace(user, groups, summaries); } catch (e) { console.error('placement failed', e); }
      group = groups.find(g => pick && g.id === pick.group_id) || nearestGroup(user, groups, summaries, today());
      reason = (pick && pick.reason) || "You're with people whose symptoms are closest to yours.";
    }
    user.community.alias = uniqueAlias(new Set(group.members.map(m => m.name)), user.community.alias);
    group.members.push({ key, name: displayName(user), joinedAt: nowIso() });
    await saveGroups(groups);
    return { group, reason };
  });
}

const PLACE_PROMPT = `You sort people going through perimenopause into small peer-support groups, so each person is with others dealing with similar symptoms at a similar intensity.

A new member is joining. Pick the existing group that fits them best. Look first at the symptoms they chose to talk about (focus), then at what they've logged and how strong it's been. If no group is a close match, pick the one with the nearest symptoms: everyone must get a group.

reason: one short, warm sentence to the new member about why this group fits them, e.g. "You're with others who've been having a lot of night sweats and broken sleep." Don't mention anyone else's details or any numbers.`;

async function aiPlace(user, groups, summaries) {
  const data = { new_member: memberProfile(user, today()), groups: groups.map((g, i) => ({ id: g.id, name: g.name, focus: g.focus, size: g.members.length, common_symptoms: summaries[i] })) };
  return askJson(`${PLACE_PROMPT}\n\n<data>${JSON.stringify(data)}</data>`, {
    type: 'object', additionalProperties: false, required: ['group_id', 'reason'],
    properties: { group_id: { type: 'string', enum: groups.map(g => g.id) }, reason: { type: 'string' } }
  }, { effort: 'medium' });
}

async function usersByKey(keys) {
  return new Map((await getUsers([...new Set(keys)])).map(([k, u]) => [k, normalizeUser(u)]));
}

// Name shown in the group changes when they switch between first name and anonymous.
export async function updateCommunity(key, user, { anonymous, focus }) {
  const c = user.community;
  if (typeof anonymous === 'boolean') c.anonymous = anonymous || !user.profile.name;
  if (Array.isArray(focus)) c.focus = cleanFocus(focus);
  if (c.joined && c.groupId) await withLock('groups', async () => {
    const groups = await loadGroups();
    const g = groups.find(x => x.id === c.groupId);
    const me = g && g.members.find(m => m.key === key);
    if (!me) return;
    c.alias = uniqueAlias(new Set(g.members.filter(m => m.key !== key).map(m => m.name)), c.alias);
    me.name = displayName(user);
    await saveGroups(groups);
  });
}

// Leaving keeps their past messages (shown as "Former member"); erasing their data removes them too.
export async function leaveCommunity(key, user, { purge = false } = {}) {
  const emptied = [];
  await withLock('groups', async () => {
    const groups = await loadGroups();
    for (const g of groups) g.members = g.members.filter(m => m.key !== key);
    const keep = groups.filter(g => g.members.length);
    emptied.push(...groups.filter(g => !g.members.length).map(g => g.id));
    await saveGroups(keep);
  });
  for (const id of emptied) await rcmd(['DEL', msgsKey(id), reactKey(id)]);
  if (purge) {
    for (const g of await loadGroups()) { await rewriteMessages(g.id, m => m.from !== key); await dropReactionsBy(g.id, key); }
    await withLock('tips', async () => {
      const tips = (await loadTips()).filter(t => t.author !== key);
      for (const t of tips) { t.reports = (t.reports || []).filter(r => r.key !== key); t.outcomes = (t.outcomes || []).filter(o => o.key !== key); }
      await saveTips(tips);
    });
    await rcmd(['DEL', readKey(key)]);
    if (user.calToken) await rcmd(['DEL', calKey(user.calToken)]);
  }
  const { hidden } = user.community;
  user.community = { ...freshCommunity(), hidden: purge ? [] : hidden || [] };
}

export async function eraseUser(key) {
  const user = await loadUser(key);
  await leaveCommunity(key, user, { purge: true });
  if (user.account && user.account.sub) await deleteAccount(user.account.sub);
  await deleteUser(key);
}

// ---------- Tips Claude finds in the group chat ----------
const TIP_PROPS = {
  symptom: { type: 'string' }, title: { type: 'string' }, details: { type: 'string' },
  how_well: { type: 'string', enum: HOW_WELL }, when: { type: 'string', enum: WHEN }, kind: { type: 'string', enum: ['everyday', 'medical'] }
};
const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['tips'],
  properties: { tips: { type: 'array', items: { type: 'object', additionalProperties: false, required: [...Object.keys(TIP_PROPS), 'same_as', 'followup_question'], properties: { ...TIP_PROPS, same_as: { type: 'string' }, followup_question: { type: 'string' } } } } }
};
const EXTRACT_PROMPT = `You read a small peer-support group chat for people going through perimenopause. Notice when the author of the NEW message shares something they personally tried for a symptom, and pull it out as a tip that could help others.

- Only count things the author says they tried or are doing themselves. Questions, sympathy, plans to try something, and other people's experiences don't count. Most messages have no tip: return an empty list then.
- symptom: the plain common name of the symptom it was for, e.g. "hot flashes", "night sweats", "trouble sleeping", "brain fog", "joint pain", "anxiety". Use the earlier messages if the new one doesn't say.
- title: a short, friendly action someone else could try, starting with a verb, under 8 words, e.g. "Keep a fan by your bed".
- details: one sentence with useful specifics they gave (how, when, how long). No names.
- how_well: how much they said it helped: a_lot, some, not_much, made_worse, or unclear if they didn't say.
- when: when in the day it's done: morning, midday, evening, bedtime, or anytime.
- kind: "medical" for a medicine, supplement, hormone therapy or other treatment; otherwise "everyday".
- same_as: the id of an existing tip if it's the same idea, otherwise "".
- followup_question: only when how_well is unclear, a short, warm question Cura can send the author privately (under 25 words) asking how much it helped, naming what they tried. Otherwise "".`;

function newTip(fields, extra) {
  return {
    id: newId(), status: 'pending', source: 'member', author: '', groupId: '', msgId: '', quote: '',
    symptom: canonSymptom(fields.symptom) || 'other', title: String(fields.title || '').trim().slice(0, 80),
    details: String(fields.details || '').trim().slice(0, 300), when: WHEN.includes(fields.when) ? fields.when : 'anytime',
    kind: fields.kind === 'medical' ? 'medical' : 'everyday', howWell: HOW_WELL.includes(fields.how_well) ? fields.how_well : 'unclear',
    why: String(fields.why || '').trim().slice(0, 400), createdAt: nowIso(), reviewedAt: '', reports: [], outcomes: [], added: 0, ...extra
  };
}

// Runs after a member posts (in the background). Returns how many tips were found.
export async function extractTips(groupId, msg, authorKey, authorName) {
  const earlier = (await groupMessages(groupId, 8)).filter(m => m.id !== msg.id).slice(-6).map(m => ({ from: m.from === 'cura' ? 'Cura' : m.from === authorKey ? authorName : 'Another member', text: m.text }));
  const existing = (await loadTips()).filter(t => t.status !== 'rejected').slice(-80).map(t => ({ id: t.id, symptom: t.symptom, title: t.title }));
  const out = await askJson(`${EXTRACT_PROMPT}\n\n<earlier_messages>${JSON.stringify(earlier)}</earlier_messages>\n<existing_tips>${JSON.stringify(existing)}</existing_tips>\n<new_message author="${authorName}">${msg.text}</new_message>`, EXTRACT_SCHEMA);
  const found = (out && Array.isArray(out.tips) ? out.tips : []).filter(t => t && t.title).slice(0, 3);
  if (!found.length) return 0;
  let ask = null;
  await withLock('tips', async () => {
    const tips = await loadTips();
    for (const f of found) {
      const how = HOW_WELL.includes(f.how_well) ? f.how_well : 'unclear';
      const same = f.same_as && tips.find(t => t.id === f.same_as && t.status !== 'rejected');
      const tip = same || newTip(f, { author: authorKey, groupId, msgId: msg.id, quote: msg.text.slice(0, 1000) });
      if (same) same.reports.push({ key: authorKey, howWell: how, at: nowIso() }); else tips.push(tip);
      if (how === 'unclear' && f.followup_question && !ask) ask = { tipId: tip.id, text: f.followup_question.trim().slice(0, 240) };
    }
    await saveTips(tips);
  });
  if (ask) await askAuthor(authorKey, ask);
  return found.length;
}

// A private question in their own Cura chat, with tap-to-answer buttons.
async function askAuthor(key, { tipId, text }) {
  const user = await loadUser(key);
  if (!user.community.joined) return;
  user.transcript = [...user.transcript, { from: 'mira', text, at: nowIso(), ui: { kind: 'options', options: TIP_ANSWERS, tipAsk: tipId } }].slice(-300);
  await storeUser(key, user);
}

// Extra context for Cura's 1:1 chat, built before she replies:
// - if they're answering the private "how much did it help?" question, save the answer to the tip and tell Cura,
//   so she thanks them instead of logging it as a symptom;
// - everyday ideas from the community that fit their symptoms, which she can offer with suggest_idea.
export async function chatContext(key, user, text) {
  const notes = [];
  const last = [...user.transcript].reverse().find(m => m.from === 'mira');
  // Cura's own messages (visit check-in, recap) carry a note on what she asked, since they aren't in her memory.
  if (last && last.note) notes.push(`<your_last_message>${last.note}</your_last_message>`);
  const askedTip = last && last.ui && last.ui.tipAsk;
  if (askedTip) {
    const how = ANSWER_HOW[text.trim().toLowerCase().replace(/[.!]+$/, '')];
    let title = '';
    await withLock('tips', async () => {
      const tips = await loadTips();
      const tip = tips.find(t => t.id === askedTip);
      if (!tip) return;
      title = tip.title;
      if (!how) return;
      if (tip.author === key) tip.howWell = how;
      else tip.reports = [...(tip.reports || []).filter(r => r.key !== key), { key, howWell: how, at: nowIso() }];
      await saveTips(tips);
    });
    if (title) notes.push(how
      ? `<community_note>Your previous message privately asked how much "${title}" helped them (something they shared in their Cura community group). They answered "${text}" and it's saved, so others can learn from it. Thank them warmly in a few words; don't log it as a symptom.</community_note>`
      : `<community_note>Your previous message privately asked how much "${title}" helped them (something they shared in their Cura community group). Their message below may be answering it; it doesn't need logging.</community_note>`);
  }
  const recent = new Set(Object.entries(user.offers || {}).filter(([, d]) => d >= addDays(today(), -13)).map(([id]) => id));
  const ideas = ideasFor(user, await loadTips(), today()).filter(i => i.match && i.kind === 'everyday' && !recent.has(i.id)).slice(0, 4);
  if (ideas.length) notes.push(`<community_ideas>\n${ideas.map(i => `- id=${i.id} "${i.title}" for ${i.symptom}${i.why ? `: ${i.why}` : ''}${i.stats.tried ? ` (${i.stats.helped} of ${i.stats.tried} members who tried it said it helped)` : i.stats.shared ? ` (${i.stats.shared} member${i.stats.shared === 1 ? '' : 's'} shared that it helped)` : ''}`).join('\n')}\n</community_ideas>`);
  return { note: notes.join('\n'), ideas };
}

// ---------- Tips from the team, and "why it may help" ----------
const WHY_PROMPT = `Write "why it may help" for a tip in Cura, an app for people going through perimenopause: 1-2 short sentences (under 40 words), plain and warm, based on general knowledge of why this kind of thing can ease that symptom. Say "may" or "can", never promise. No medicines, supplements, hormones or doses. If kind is "medical", don't explain how it works: say that some members found it helpful and that it's something to talk through with a clinician.`;

export async function writeWhy(tip) {
  const out = await askJson(`${WHY_PROMPT}\n\n<tip>${JSON.stringify({ symptom: tip.symptom, title: tip.title, details: tip.details, kind: tip.kind })}</tip>`, {
    type: 'object', additionalProperties: false, required: ['why'], properties: { why: { type: 'string' } }
  });
  return out ? String(out.why || '').trim().slice(0, 400) : '';
}

const TEAM_PROMPT = `A member of the Cura team wrote one or more starter tips for people going through perimenopause. Turn each into a structured tip.
- symptom: the plain common name of the symptom it's for ("hot flashes", "night sweats", "trouble sleeping", "brain fog", ...).
- title: a short, friendly action starting with a verb, under 8 words. details: one sentence of specifics, or "".
- when: morning, midday, evening, bedtime or anytime. kind: "medical" for medicines, supplements, hormones or treatments, otherwise "everyday".
- how_well: "unclear". why: ${WHY_PROMPT.slice(WHY_PROMPT.indexOf('1-2'))}`;

export async function addTeamTips(text) {
  const out = await askJson(`${TEAM_PROMPT}\n\n<team_text>${String(text).slice(0, 4000)}</team_text>`, {
    type: 'object', additionalProperties: false, required: ['tips'],
    properties: { tips: { type: 'array', items: { type: 'object', additionalProperties: false, required: [...Object.keys(TIP_PROPS), 'why'], properties: { ...TIP_PROPS, why: { type: 'string' } } } } }
  });
  const made = (out && Array.isArray(out.tips) ? out.tips : []).filter(t => t && t.title).slice(0, 20).map(t => newTip(t, { source: 'team', status: 'approved', reviewedAt: nowIso(), quote: String(text).slice(0, 1000) }));
  if (made.length) await withLock('tips', async () => saveTips([...(await loadTips()), ...made]));
  return made;
}

// Admin edits: fields, status, or delete. Approving writes "why it may help" if it's missing.
export async function saveTip(id, { fields = {}, status, remove = false } = {}) {
  let tip = null;
  await withLock('tips', async () => {
    let tips = await loadTips();
    tip = tips.find(t => t.id === id);
    if (!tip) return;
    if (remove) tips = tips.filter(t => t.id !== id);
    else {
      if (fields.title !== undefined) tip.title = String(fields.title).trim().slice(0, 80);
      if (fields.symptom !== undefined) tip.symptom = canonSymptom(fields.symptom) || tip.symptom;
      if (fields.details !== undefined) tip.details = String(fields.details).trim().slice(0, 300);
      if (fields.why !== undefined) tip.why = String(fields.why).trim().slice(0, 400);
      if (WHEN.includes(fields.when)) tip.when = fields.when;
      if (['everyday', 'medical'].includes(fields.kind)) tip.kind = fields.kind;
      if (['pending', 'approved', 'rejected'].includes(status)) { tip.status = status; tip.reviewedAt = nowIso(); }
    }
    await saveTips(tips);
  });
  if (tip && !remove && tip.status === 'approved' && !tip.why) {
    const why = await writeWhy(tip);
    if (why) await withLock('tips', async () => { const tips = await loadTips(); const t = tips.find(x => x.id === id); if (t && !t.why) { t.why = why; await saveTips(tips); } tip = t || tip; });
  }
  return tip;
}

// When someone adds a tip to their plan or says after a week whether it helped.
export async function noteTipUse(tipId, key, { added = false, outcome = '' } = {}) {
  await withLock('tips', async () => {
    const tips = await loadTips();
    const t = tips.find(x => x.id === tipId);
    if (!t) return;
    if (added) { t.added = (t.added || 0) + 1; t.adds = [...(t.adds || []), { key, at: nowIso() }].slice(-200); }
    if (outcome) t.outcomes = [...(t.outcomes || []).filter(o => o.key !== key), { key, howWell: outcome, at: nowIso() }];
    await saveTips(tips);
  });
}

// ---------- Calendar link ----------
export async function calendarToken(key, user) {
  if (!user.calToken) {
    user.calToken = crypto.randomUUID().replace(/-/g, '');
    await storeUser(key, user);
  }
  await rcmd(['SET', calKey(user.calToken), key]);
  return user.calToken;
}
export const userForCalendar = async token => (/^[a-f0-9]{32}$/.test(token) ? rcmd(['GET', calKey(token)]) : null);

// ---------- Daily: tidy up, regroup, question of the day ----------
const REGROUP_PROMPT = `You look after the small peer-support groups in Cura, an app for people going through perimenopause. Each person should be with others dealing with similar symptoms at a similar intensity, so what they share is relevant to each other.

Below are the current groups and an anonymous summary of each member: the symptoms they chose to talk about (focus) and what they've logged in the last 30 days (days noticed, average and peak intensity out of 10).

Decide how the groups should look today:
- Keep things stable. People get to know their group, so only move someone when it clearly helps them.
- Split a group when it has more than 12 members, or when it has 8 or more and clearly holds different symptom profiles (for example mostly sleep and night sweats vs mostly mood and anxiety). Groups should end up with 4-12 members.
- Move the members of a group with fewer than 3 people into the closest group.
- Match on focus symptoms first, then logged symptoms and intensity. If someone doesn't closely match anyone, put them with the nearest symptoms; nobody is ever left out.
- With fewer than ${ONE_GROUP_BELOW} members in total, everyone stays in one group.
Return every member exactly once. Keep an existing group's id when it continues (you may update its name and focus to fit its members); use id "new" for a new group.
name: 2-5 friendly words naming what the group shares, e.g. "Sleep & night sweats". focus: one short sentence describing who it's for.
moved: for each member you move to a different group, one short, warm sentence to them about why (no one else's details).`;

export async function regroup({ force = false } = {}) {
  const groups = await loadGroups();
  const users = await usersByKey(groups.flatMap(g => g.members.map(m => m.key)));
  // Drop members whose record is gone or who are now in a different group.
  let cleaned = 0;
  for (const g of groups) {
    const before = g.members.length;
    g.members = g.members.filter(m => { const u = users.get(m.key); return u && u.community.joined && u.community.groupId === g.id; });
    cleaned += before - g.members.length;
  }
  const members = groups.flatMap(g => g.members.map(m => ({ ...m, groupId: g.id })));
  if (cleaned) await withLock('groups', async () => {
    const fresh = await loadGroups();
    for (const g of fresh) g.members = g.members.filter(m => { const u = users.get(m.key); return u && u.community.joined && u.community.groupId === g.id; });
    await saveGroups(fresh.filter(g => g.members.length));
  });
  if (!members.length || (!force && members.length < ONE_GROUP_BELOW && groups.filter(g => g.members.length).length <= 1)) return { changed: false, cleaned, members: members.length };

  const short = new Map(members.map((m, i) => [`m${i + 1}`, m]));
  const data = {
    groups: groups.filter(g => g.members.length).map(g => ({ id: g.id, name: g.name, focus: g.focus, members: [...short].filter(([, m]) => m.groupId === g.id).map(([s]) => s) })),
    members: Object.fromEntries([...short].map(([s, m]) => [s, memberProfile(users.get(m.key), today())]))
  };
  const out = await askJson(`${REGROUP_PROMPT}\n\n<data>${JSON.stringify(data)}</data>`, {
    type: 'object', additionalProperties: false, required: ['groups', 'moved'],
    properties: {
      groups: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'focus', 'members'], properties: { id: { type: 'string' }, name: { type: 'string' }, focus: { type: 'string' }, members: { type: 'array', items: { type: 'string' } } } } },
      moved: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['member', 'reason'], properties: { member: { type: 'string' }, reason: { type: 'string' } } } }
    }
  }, { effort: 'medium', maxTokens: 12000 });
  const plan = checkGrouping(out, groups.map(g => g.id), [...short.keys()]);
  if (!plan) return { changed: false, cleaned, members: members.length, rejected: !!out };

  const reasons = new Map((out.moved || []).map(m => [m.member, String(m.reason || '').slice(0, 240)]));
  const moves = [];
  const applied = await withLock('groups', async () => {
    const current = await loadGroups();
    const now = current.flatMap(g => g.members.map(m => m.key)).sort().join();
    if (now !== members.map(m => m.key).sort().join()) return false; // someone joined or left meanwhile; try again tomorrow
    const byId = new Map(current.map(g => [g.id, g]));
    const next = plan.map(p => {
      const old = p.id && byId.get(p.id);
      const g = old ? { ...old, name: p.name, focus: p.focus || old.focus } : { id: newId(), name: p.name, focus: p.focus, createdAt: nowIso(), questions: [] };
      g.members = p.members.map(s => {
        const m = short.get(s);
        if (m.groupId !== g.id) moves.push({ key: m.key, from: m.groupId, to: g.id, name: g.name, reason: reasons.get(s) || '' });
        return { key: m.key, name: m.name, joinedAt: m.groupId === g.id ? m.joinedAt : nowIso() };
      });
      return g;
    });
    await saveGroups(next);
    for (const g of current) if (!next.some(n => n.id === g.id)) await rcmd(['DEL', msgsKey(g.id), reactKey(g.id)]);
    return true;
  }, 60000);
  if (!applied) return { changed: false, cleaned, members: members.length, raced: true };

  for (const mv of moves) {
    const u = await loadUser(mv.key);
    if (!u.community.joined) continue;
    u.community.groupId = mv.to;
    u.community.reason = mv.reason || u.community.reason;
    u.community.notice = { text: `Cura moved you to a new group, ${mv.name}.${mv.reason ? ' ' + mv.reason : ''}`, at: nowIso() };
    await storeUser(mv.key, u);
  }
  const arrivals = new Map();
  for (const mv of moves) arrivals.set(mv.to, [...(arrivals.get(mv.to) || []), members.find(m => m.key === mv.key).name]);
  for (const [gid, names] of arrivals) await postMessage(gid, 'cura', `👋 ${names.join(', ')} just joined this group. Say hi!`, 'welcome');
  return { changed: moves.length > 0, moved: moves.length, groups: plan.length, cleaned, members: members.length };
}

const QOTD_PROMPT = `Write today's question of the day for a small peer-support group in Cura, an app for people going through perimenopause. One warm, easy question under 20 words that invites people to share what has helped them or how they cope, so others can learn from it. Practical and everyday, not clinical; no medicines or supplements. Fit it to what the group has in common, and don't repeat a recent question.`;

export async function questionsOfTheDay() {
  const date = today();
  const groups = await loadGroups();
  const users = await usersByKey(groups.flatMap(g => g.members.map(m => m.key)));
  let posted = 0;
  for (const g of groups) {
    if (!g.members.length || (g.questions || []).some(q => q.date === date)) continue;
    const out = await askJson(`${QOTD_PROMPT}\n\n<group>${JSON.stringify({ name: g.name, focus: g.focus, common_symptoms: groupSummary(g, users, date), recent_questions: (g.questions || []).map(q => q.text) })}</group>`, {
      type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string' } }
    }).catch(e => { console.error('qotd failed', e); return null; });
    const text = out && String(out.question || '').trim();
    if (!text) continue;
    await postMessage(g.id, 'cura', `💬 Question of the day: ${text.slice(0, 200)}`, 'qotd');
    await withLock('groups', async () => {
      const all = await loadGroups(); const x = all.find(y => y.id === g.id);
      if (x) { x.questions = [...(x.questions || []), { date, text }].slice(-14); await saveGroups(all); }
    });
    posted++;
  }
  return posted;
}

// The cron address is public, so this runs at most once per day.
export async function communityDaily() {
  if ((await rcmd(['SET', `cura:daily:${today()}`, '1', 'NX', 'EX', 172800])) !== 'OK') return { skipped: 'already ran today' };
  const out = {};
  try { out.regroup = await regroup(); } catch (e) { console.error('regroup failed', e); out.regroup = { error: String(e.message || e) }; }
  try { out.questions = await questionsOfTheDay(); } catch (e) { console.error('questions failed', e); out.questions = 0; }
  return out;
}

// ---------- Admin views ----------
export async function adminCommunity() {
  const [groups, tips] = await Promise.all([loadGroups(), loadTips()]);
  const users = await usersByKey([...groups.flatMap(g => g.members.map(m => m.key)), ...tips.map(t => t.author).filter(Boolean)]);
  const nameOf = key => { const g = groups.find(x => x.members.some(m => m.key === key)); const m = g && g.members.find(x => x.key === key); return m ? m.name : users.get(key) ? displayName(users.get(key)) || 'Member' : 'Former member'; };
  const counts = await Promise.all(groups.map(g => rcmd(['LLEN', msgsKey(g.id)])));
  return {
    groups: groups.map((g, i) => ({
      id: g.id, name: g.name, focus: g.focus, createdAt: g.createdAt, messages: counts[i] || 0,
      common: groupSummary(g, users, today()),
      members: g.members.map(m => ({ key: m.key, name: m.name, joinedAt: m.joinedAt, focus: (users.get(m.key)?.community.focus) || [] })),
      questions: (g.questions || []).slice(-3)
    })),
    tips: [...tips].reverse().map(t => ({ ...t, authorName: t.author ? nameOf(t.author) : '', groupName: (groups.find(g => g.id === t.groupId) || {}).name || '', reports: (t.reports || []).length, outcomes: undefined, stats: { tried: (t.outcomes || []).length, helped: (t.outcomes || []).filter(o => o.howWell === 'a_lot' || o.howWell === 'some').length, added: t.added || 0 } }))
  };
}

export async function adminGroupMessages(groupId) {
  const g = (await loadGroups()).find(x => x.id === groupId);
  const names = new Map((g ? g.members : []).map(m => [m.key, m.name]));
  return (await groupMessages(groupId, MSG_KEEP)).map(m => ({ id: m.id, at: m.at, text: m.text, kind: m.kind || '', from: m.from, name: m.from === 'cura' ? 'Cura' : names.get(m.from) || 'Former member' }));
}
export const adminDeleteMessage = (groupId, msgId) => rewriteMessages(groupId, m => m.id !== msgId);
