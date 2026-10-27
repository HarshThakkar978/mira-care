// Shared by every channel: load the person's data, let Cura answer, save, return the reply.
import Anthropic from '@anthropic-ai/sdk';
import { handleIncoming, normalizeUser, localDate } from './mira.js';
import { getUser, saveUser } from './store.js';

const env = name => process.env[name] || '';
export const MODEL = () => env('MIRA_MODEL') || 'claude-sonnet-5-5';
export const today = () => localDate(env('MIRA_TIMEZONE') || 'America/New_York');
const TRANSCRIPT_MAX = 300;

export const loadUser = async key => normalizeUser(await getUser(key));
export const storeUser = (key, user) => saveUser(key, user);

// key: the person's storage id — phone digits on WhatsApp, "web-<device id>" in the app.
// hooks.onText(delta) streams Cura's words as they're written (the app); without it the reply arrives whole (WhatsApp).
// Tool inputs here are tiny, so eager tool-input streaming isn't worth turning on.
// hooks.context(user, text) → { note, ideas } adds community context in the app (see community.js).
export async function miraReply(key, text, channel = 'whatsapp', hooks = {}) {
  const user = await loadUser(key);
  const extra = hooks.context ? await hooks.context(user, text).catch(e => { console.error('chat context failed', e); return {}; }) : {};
  const client = new Anthropic();
  const model = MODEL();
  const claude = hooks.onText
    ? async params => {
        const stream = client.beta.messages.stream(params);
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') hooks.onText(event.delta.text);
        }
        return stream.finalMessage();
      }
    : params => client.beta.messages.create(params);
  let quick = null, idea = null; // tap-to-answer buttons and an idea card Cura attached to this reply (app only)
  const reply = await handleIncoming(user, text, today(), {
    model,
    effort: env('MIRA_EFFORT') || 'low',
    fallbacks: !model.startsWith('claude-haiku'),
    channel,
    onRound: hooks.onRound,
    onQuickReplies: q => { quick = q; },
    note: extra.note || '',
    ideas: extra.ideas || [],
    onIdea: i => { idea = i; },
    claude
  });
  // Full chat log for the app to display (history above is only the short memory sent to Claude).
  const at = new Date().toISOString();
  user.transcript = [...(user.transcript || []), { from: 'you', text, at }, { from: 'mira', text: reply, at, ...(quick ? { ui: quick } : {}), ...(idea ? { idea } : {}) }].slice(-TRANSCRIPT_MAX);
  if (idea) user.offers = { ...user.offers, [idea.id]: today() }; // not offered again for two weeks
  await saveUser(key, user);
  return { reply, user };
}
