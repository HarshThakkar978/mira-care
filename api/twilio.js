// WhatsApp through Twilio (works with Twilio's free WhatsApp Sandbox, no Meta business verification).
// GET  /api/twilio → status page
// POST /api/twilio → Twilio's "When a message comes in" webhook; Mira replies via Twilio's REST API
import { waitUntil } from '@vercel/functions';
import { miraReply, MODEL } from './_lib/respond.js';
import { firstTimeSeen, storeConfigured } from './_lib/store.js';

const env = name => process.env[name] || '';

export async function GET() {
  const missing = ['ANTHROPIC_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'].filter(n => !env(n));
  if (!storeConfigured()) missing.push('Upstash Redis database (KV_REST_API_URL / KV_REST_API_TOKEN)');
  return Response.json({ mira: 'twilio webhook is running', model: MODEL(), ready: missing.length === 0, missing });
}

export async function POST(request) {
  const form = new URLSearchParams(await request.text());
  const from = form.get('From') || '';
  const sid = form.get('MessageSid') || '';
  const body = (form.get('Body') || '').trim();
  // Reply from whichever Twilio number they messaged (the sandbox number differs per account).
  const to = form.get('To') || '';
  // Answer Twilio right away with an empty 200 (trial webhooks don't accept TwiML); the reply is sent separately via the API.
  if (from && sid) waitUntil(processMessage(from, to, sid, body, Number(form.get('NumMedia') || 0)).catch(e => console.error('mira error', e)));
  return new Response(null, { status: 200 });
}

async function processMessage(from, to, sid, body, numMedia) {
  if (!(await firstTimeSeen(sid))) return;
  if (!body) {
    await sendText(to, from, numMedia ? "I can only read text messages for now. Could you type it out for me?" : 'Hi! Tell me how you’re feeling today.');
    return;
  }
  const phone = from.replace(/\D/g, '');
  await sendText(to, from, await miraReply(phone, body));
}

async function sendText(from, to, text) {
  const sidAcct = env('TWILIO_ACCOUNT_SID');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sidAcct}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sidAcct}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ From: from, To: to, Body: text.slice(0, 1600) })
  });
  if (!res.ok) console.error('twilio send failed', res.status, await res.text());
}
