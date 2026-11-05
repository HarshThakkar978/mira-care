# Working on Cura

Cura is a perimenopause companion web app (installable on the iPhone Home Screen) at **https://curadaily.com**.
People text Cura (Claude) how they feel; she logs symptoms, periods and check-ins, prepares doctor visits, and
matches people into small peer groups (the Circle). Early users are live, so every change is tested before it
reaches them. This file is for anyone on the team and their Claude Code.

## How we work (the important part)

- **Two branches.** `main` is the live site (every push deploys to curadaily.com). `staging` is where changes
  are tested; every push makes a private Vercel preview copy.
- **Never push untested work to `main`.** Make a branch from `staging` (e.g. `priya/voice-tweaks`), test it
  locally, open a pull request into `staging`, check it on the preview link, then merge `staging` into `main`
  to go live. Pull (`git pull`) before you start, so you have everyone's latest work.
- **The preview shares the live database.** Test users must have ids starting with `claude-` (the replay
  scripts do this) and be erased afterwards. Never test the Circle on a preview with a fake user: it would
  join a real group. Test the Circle locally instead.
- **Secrets never go in the code.** Keys live in Vercel → Project → Settings → Environment Variables. You don't
  need any to work locally (the mock server fakes the backend).
- **Check the screen at phone size after every UI change** (light and dark), and walk the whole flow, not
  just the part you changed. Things like the keyboard layout, sheets and tips interact.
- Plain, friendly wording in the app. Cura never diagnoses or suggests medicines; see her prompt in
  `api/_lib/mira.js`.

## Run it locally (no keys needed)

```bash
SEED=1 VOICE=1 CIRCLE_OPEN=1 python3 dev/mock-server.py . 8795
```

Then open http://localhost:8795 (use your browser's phone view). `SEED=1` adds sample data and a sample Circle,
`VOICE=1` fakes voice transcription, `CIRCLE_OPEN=1` opens the Circle straight away, `STORY=off` hides "your
story". The admin page is http://localhost:8795/admin.html with password `test123` (local only). Replies from
Cura are canned here; real AI replies need a preview (below).

## Tests

```bash
sh dev/syntax-check.sh
cd dev && for t in *.test.mjs; do /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc -m $t; done
```

(`node dev/<name>.test.mjs` works too.) Real-AI conversations against a deployment: `python3 dev/replay.py
[scenario ...]` (live site), or for a protected preview set `CURA_URL=<preview url>` and
`CURA_COOKIE=_vercel_jwt=<cookie>` (open the preview's share link once to get the cookie). It prints Cura's
replies and what she saved, then erases the test users.

## Where things are

- `index.html`, `app.js`, `styles.css`, `sw.js`: the whole app (no build step). Bump `CACHE` in `sw.js` when
  you change these so phones pick up the new version.
- `api/app.js`: the app's API. `api/_lib/mira.js`: Cura's prompt, tools and chat loop. `api/_lib/respond.js`:
  runs a chat turn. `api/_lib/story.js`: "your story" questions (with "why I ask" sources) and the timing A/B
  test. `api/_lib/community*.js`: the Circle. `api/_lib/voice.js`: voice → text (OpenAI). `api/admin.js` +
  `admin.html`/`admin.js`: the admin page.
- Model: `claude-sonnet-5-5` (set in `api/_lib/respond.js`, override with `MIRA_MODEL`). Data: Upstash Redis.
- Old addresses (mira-care.vercel.app, curadaily.vercel.app) forward to curadaily.com with the person's data
  (top of `app.js`). Keep that code.
