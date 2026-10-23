// Tiny key-value store on Upstash Redis (free tier, added from Vercel → Storage).
// Uses the REST API directly, so no extra package is needed.

const url = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const storeConfigured = () => Boolean(url() && token());

async function redis(command) {
  const res = await fetch(url(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Redis error: ${data.error || res.status}`);
  return data.result;
}

export async function getUser(phone) {
  const raw = await redis(['GET', `mira:user:${phone}`]);
  return raw ? JSON.parse(raw) : null;
}

export async function saveUser(phone, user) {
  await redis(['SET', `mira:user:${phone}`, JSON.stringify(user)]);
}

// True the first time a message id is seen; WhatsApp sometimes delivers the same webhook twice.
export async function firstTimeSeen(messageId) {
  return (await redis(['SET', `mira:seen:${messageId}`, '1', 'NX', 'EX', 86400])) === 'OK';
}
