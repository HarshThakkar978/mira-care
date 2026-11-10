// Checks Cura knows her own app: every row in the Me tab and every bottom tab must appear in her app guide,
// and the app channel actually sends the guide. Fails when a feature is added without telling Cura.
// Run: /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m dev/app-guide.test.mjs (repo or dev folder)
import { APP_GUIDE, handleIncoming, freshUser } from '../api/_lib/mira.js';

const log = (...a) => (globalThis.print || console.log)(a.join(' '));
let fail = 0;
const check = (c, msg) => { if (!c) { fail++; log('FAIL', msg); } else log('ok', msg); };
const readText = async p => (globalThis.read ? globalThis.read(p) : (await import('node:fs')).readFileSync(p, 'utf8'));

(async () => {
  const app = await readText('app.js').catch(() => readText('../app.js')); // works from the repo or dev folder
  const rows = [...app.matchAll(/meRow\('[^']*', '([^']+)'/g)].map(m => m[1]);
  check(rows.length >= 12, `found the Me tab's rows (${rows.length})`);
  const guide = APP_GUIDE.toLowerCase();
  // A few rows are named differently in plain speech.
  const say = { 'notes and agenda': 'notes and agenda', 'show app tips again': 'app tips', 'welcome tour': 'welcome tour' };
  for (const r of rows) check(guide.includes((say[r.toLowerCase()] || r).toLowerCase()), `Cura's guide mentions "${r}"`);
  for (const tab of ['Chat', 'Today', 'Circle', 'Me']) check(guide.includes(tab.toLowerCase()), `guide mentions the ${tab} tab`);
  check(/yes, cura can remind them/i.test(APP_GUIDE) && /home screen/i.test(APP_GUIDE), 'guide says reminders exist and need the Home Screen on iPhone');

  let sys = null;
  const claude = async p => { sys = p.system; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }; };
  await handleIncoming(freshUser(), 'can you remind me?', '2026-11-09', { claude, model: 'x', effort: 'low', channel: 'app' });
  check(sys.some(b => b.text === APP_GUIDE), 'the app sends Cura her guide');
  await handleIncoming(freshUser(), 'hi', '2026-11-09', { claude, model: 'x', effort: 'low', channel: 'whatsapp' });
  check(!sys.some(b => b.text === APP_GUIDE), 'WhatsApp does not');
  log(fail ? `${fail} FAILED` : 'ALL PASSED');
})().catch(e => log('CRASH', String(e), e.stack));
