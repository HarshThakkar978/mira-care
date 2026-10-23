// Shared by every channel: load the person's data, let Mira answer, save, return the reply.
import Anthropic from '@anthropic-ai/sdk';
import { handleIncoming, freshUser, localDate } from './mira.js';
import { getUser, saveUser } from './store.js';

const env = name => process.env[name] || '';
export const MODEL = () => env('MIRA_MODEL') || 'claude-haiku-5-5';

// phone: digits only (e.g. "919876543210"), used as the storage key on every channel.
export async function miraReply(phone, text) {
  const user = (await getUser(phone)) || freshUser();
  const client = new Anthropic();
  const model = MODEL();
  const reply = await handleIncoming(user, text, localDate(env('MIRA_TIMEZONE') || 'America/New_York'), {
    model,
    effort: env('MIRA_EFFORT') || 'low',
    fallbacks: !model.startsWith('claude-haiku'),
    claude: params => client.beta.messages.create(params)
  });
  await saveUser(phone, user);
  return reply;
}
