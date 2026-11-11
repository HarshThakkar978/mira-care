// Voice notes → text, for the mic button in the chat and the Circle. Claude doesn't take audio, so this uses
// OpenAI's most accurate transcription model (about $0.006 a minute; it adds punctuation and capitals itself). Turned on by adding OPENAI_API_KEY in Vercel; without it
// the app falls back to the browser's own speech recognition where that exists.
const MODEL = () => process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
export const voiceConfigured = () => !!process.env.OPENAI_API_KEY;

// No spelling hint: on silence the model echoes (or even translates) any hint it's given. It spells these words fine.
// What it invents from silence is a short stock phrase; those are thrown away when they're the whole transcript.
const SILENCE_PHRASES = /^(sure|okay|ok|you|thank you|thanks|thank you for watching|thanks for watching|bye|bye bye|yes|no|hmm|um|uh|so|oh|ah|music|silence|\.+)[.!?]*$/i;
export function looksMadeUp(text) {
  const t = String(text).replace(/[\s"“”]+/g, ' ').trim();
  return !t || SILENCE_PHRASES.test(t) || !/[a-z]/i.test(t);
}

const EXT = { 'audio/mp4': 'mp4', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024; // about 3 minutes of phone audio; Vercel caps the request at 4.5 MB

// audio: the recording as base64; type: its MIME type from the browser (e.g. "audio/mp4" on iPhone).
export async function transcribe(audio, type) {
  const mime = String(type || '').split(';')[0].trim().toLowerCase();
  const ext = EXT[mime];
  if (!ext) throw Object.assign(new Error('Unsupported audio format'), { status: 400 });
  const bytes = Buffer.from(String(audio || ''), 'base64');
  if (!bytes.length) throw Object.assign(new Error('Empty recording'), { status: 400 });
  if (bytes.length > MAX_AUDIO_BYTES) throw Object.assign(new Error('That recording is too long. Try a shorter one.'), { status: 413 });
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), `voice.${ext}`);
  form.append('model', MODEL());
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
  if (!res.ok) {
    console.error('transcription failed', res.status, (await res.text().catch(() => '')).slice(0, 300));
    throw Object.assign(new Error("Couldn't turn that into text. Please try again."), { status: 502 });
  }
  const data = await res.json();
  const text = String(data.text || '').trim().slice(0, 4000);
  return looksMadeUp(text) ? '' : text;
}
