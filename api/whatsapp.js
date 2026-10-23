// WhatsApp Cloud API webhook for Mira.
// GET  /api/whatsapp  → Meta's one-time webhook check (and a status page for us)
// POST /api/whatsapp  → incoming messages; Mira replies through the Graph API
import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { miraReply, MODEL } from './_lib/respond.js';
import { firstTimeSeen, storeConfigured } from './_lib/store.js';

const env = name => process.env[name] || '';
const GRAPH = () => `https://graph.facebook.com/${env('WHATSAPP_API_VERSION') || 'v23.0'}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`;

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  if (q.get('hub.mode') === 'subscribe') {
    if (q.get('hub.verify_token') && q.get('hub.verify_token') === env('WHATSAPP_VERIFY_TOKEN')) return new Response(q.get('hub.challenge') || '', { status: 200 });
    return new Response('Verify token does not match WHATSAPP_VERIFY_TOKEN', { status: 403 });
  }
  // Status page: shows which settings are still missing (names only, never values).
  const needed = ['ANTHROPIC_API_KEY', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN'];
  const missing = needed.filter(n => !env(n));
  if (!storeConfigured()) missing.push('Upstash Redis database (KV_REST_API_URL / KV_REST_API_TOKEN)');
  return Response.json({ mira: 'whatsapp webhook is running', model: MODEL(), ready: missing.length === 0, missing });
}

export async function POST(request) {
  const raw = await request.text();
  const secret = env('WHATSAPP_APP_SECRET');
  if (secret) {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const got = request.headers.get('x-hub-signature-256') || '';
    if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) return new Response('bad signature', { status: 401 });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return new Response('ok'); }

  const incoming = [];
  for (const entry of body.entry || []) for (const change of entry.changes || []) for (const m of change.value?.messages || []) incoming.push(m);
  // Answer Meta right away; do the slow AI work in the background.
  if (incoming.length) waitUntil(Promise.all(incoming.map(m => processMessage(m).catch(e => console.error('mira error', e)))));
  return new Response('ok');
}

async function processMessage(m) {
  if (!(await firstTimeSeen(m.id))) return;
  const phone = m.from;
  if (m.type !== 'text') {
    await sendText(phone, "I can only read text messages for now. Could you type it out for me?");
    return;
  }
  await markReadAndTyping(m.id);
  await sendText(phone, (await miraReply(phone, m.text.body)).reply);
}

async function graph(payload) {
  const res = await fetch(GRAPH(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload })
  });
  if (!res.ok) console.error('whatsapp send failed', res.status, await res.text());
}

const sendText = (to, body) => graph({ to, type: 'text', text: { body } });
const markReadAndTyping = id => graph({ status: 'read', message_id: id, typing_indicator: { type: 'text' } });
