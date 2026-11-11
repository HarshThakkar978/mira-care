// Voice: the made-up-transcript filter, and that the transcriber's setup is all there (catches a missing format list).
// Run: /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m dev/voice.test.mjs
import { looksMadeUp, transcribe, MAX_AUDIO_BYTES } from '../api/_lib/voice.js';

const log = (...a) => (globalThis.print || console.log)(a.join(' '));
let fail = 0;
const check = (c, msg) => { if (!c) { fail++; log('FAIL', msg); } else log('ok', msg); };

(async () => {
  for (const t of ['', 'Sure!', 'Thank you.', 'Thanks for watching!', 'you', '...']) check(looksMadeUp(t), `invented from silence, thrown away: "${t}"`);
  for (const t of ['Night sweats and hot flashes again last night', 'I had hot flashes night sweats brain fog all week', 'So I slept badly, maybe a seven.', 'Yes, twice last night', 'Thank you for the tip, it helped'])
    check(!looksMadeUp(t), `real speech kept: "${t}"`);
  check(MAX_AUDIO_BYTES > 1e6, 'size limit is set');
  const err = await transcribe('AAAA', 'video/x-nope').catch(e => e);
  check(err && /Unsupported audio format/.test(err.message), 'unknown formats are refused cleanly (format list present)');
  log(fail ? `${fail} FAILED` : 'ALL PASSED');
})().catch(e => log('CRASH', String(e), e.stack));
