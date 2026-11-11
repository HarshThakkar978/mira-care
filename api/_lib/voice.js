// Voice notes → text, for the mic button in the chat and the Circle. Claude doesn't take audio, so this uses
// OpenAI's most accurate transcription model (about $0.006 a minute; it adds punctuation and capitals itself). Turned on by adding OPENAI_API_KEY in Vercel; without it
// the app falls back to the browser's own speech recognition where that exists.
const MODEL = () => process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
export const voiceConfigured = () => !!process.env.OPENAI_API_KEY;

// Words people say to Cura, so the transcript spells them right.
// Only spellings, not sentences: on silence the model can echo its prompt, so the prompt must be nothing a person would say.
const PROMPT = 'Hot flashes, night sweats, brain fog, HRT, progesterone, estrogen, perimenopause.';
const PROMPT_SEQ = PROMPT.toLowerCase().match(/[a-z]+/g);
// Nothing was really said: an empty result, or the model echoing its prompt (9+ of its 10 words in the same order,
// which nobody says in real speech). Ordinary sentences that mention these symptoms are kept.
export function looksMadeUp(text) {
  const words = String(text).toLowerCase().match(/[a-z]+/g) || [];
  if (!words.length) return true;
  for (let i = 0; i < words.length; i++) {
    const j = PROMPT_SEQ.indexOf(words[i]);
    if (j < 0) continue;
    let n = 0;
    while (words[i + n] && words[i + n] === PROMPT_SEQ[j + n]) n++;
    if (n >= 9) return true;
  }
  return false;
}

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
  form.append('prompt', PROMPT);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
  if (!res.ok) {
    console.error('transcription failed', res.status, (await res.text().catch(() => '')).slice(0, 300));
    throw Object.assign(new Error("Couldn't turn that into text. Please try again."), { status: 502 });
  }
  const data = await res.json();
  const text = String(data.text || '').trim().slice(0, 4000);
  return looksMadeUp(text) ? '' : text;
}
