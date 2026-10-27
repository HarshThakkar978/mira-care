// Shared by every channel: load the person's data, let Mira answer, save, return the reply.
import Anthropic from '@anthropic-ai/sdk';
import { handleIncoming, normalizeUser, localDate } from './mira.js';
import { getUser, saveUser } from './store.js';

const env = name => process.env[name] || '';
export const MODEL = () => env('MIRA_MODEL') || 'claude-haiku-5-5';
export const today = () => localDate(env('MIRA_TIMEZONE') || 'America/New_York');
const TRANSCRIPT_MAX = 300;

export const loadUser = async key => normalizeUser(await getUser(key));
export const storeUser = (key, user) => saveUser(key, user);

// key: the person's storage id — phone digits on WhatsApp, "web-<device id>" in the app.
// hooks.onText(delta) streams Mira's words as they're written (the app); without it the reply arrives whole (WhatsApp).
// Tool inputs here are tiny, so eager tool-input streaming isn't worth turning on.
export async function miraReply(key, text, channel = 'whatsapp', hooks = {}) {
  const user = await loadUser(key);
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
  let quick = null; // tap-to-answer buttons Mira attached to this reply (app only)
  const reply = await handleIncoming(user, text, today(), {
    model,
    effort: env('MIRA_EFFORT') || 'low',
    fallbacks: !model.startsWith('claude-haiku'),
    channel,
    onRound: hooks.onRound,
    onQuickReplies: q => { quick = q; },
    claude
  });
  // Full chat log for the app to display (history above is only the short memory sent to Claude).
  const at = new Date().toISOString();
  user.transcript = [...(user.transcript || []), { from: 'you', text, at }, { from: 'mira', text: reply, at, ...(quick ? { ui: quick } : {}) }].slice(-TRANSCRIPT_MAX);
  await saveUser(key, user);
  return { reply, user };
}
