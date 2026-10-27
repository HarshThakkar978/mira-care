# Cura

A perimenopause companion you text. Open the app (or add it to your iPhone Home Screen) and it goes straight to an iMessage-style chat with Cura, who uses Claude to log how you feel, period starts and symptoms from plain messages. The other tabs show what you've logged:

- **Chat**: talk to Cura (replies stream in word by word); quick replies, and a ➕ quick-log sheet for feelings, symptoms and period starts in two taps
- **Today**: a short weekly insight from Cura, your daily plan (ideas from the community you chose to try, with a one-week "did it help?" check-in), days since your last period, average gap between periods, next appointment, a 30-day symptom strip and your most frequent symptoms
- **Community**: a small group chat with people whose symptoms are like yours, and "Ideas for you" (see below)
- **Cycle**: month calendar of period starts and symptoms; tap a day to view, add or remove entries
- **Visits**: a printable doctor summary (save as PDF), notes to bring up, an editable agenda Cura drafts from your data, after-visit notes and a follow-up list
- **Me**: your name, a daily reminder notification at an hour you pick, add-to-Home-Screen help, a private link to open Cura on another device, export and erase

Daily reminders use web push (`api/_lib/push.js`). Vercel's Hobby plan only allows once-a-day cron jobs, so `vercel.json` defines 24 daily jobs, one per hour, that all call `/api/reminders`. It sends each person one reminder after their chosen local hour, and skips days they've already logged something. On iPhone, notifications only work once Cura is added to the Home Screen.

**Community** (`api/_lib/community.js`, pure logic in `community-logic.js`): people opt in, pick the symptoms they want to talk about (pre-filled from what they've logged) and choose to appear by first name or a nickname. Claude places each newcomer in the closest existing group, and once a day (the 14:00 UTC reminder run) re-sorts everyone by symptoms and intensity, keeping groups stable, splitting big mixed ones and never leaving anyone alone, then posts a question of the day. Members just chat; after each post Claude quietly pulls out "what worked for me" tips into structured fields (and privately asks the author how much it helped if they didn't say). The team approves tips on the admin page, Claude writes "why it may help", and Cura offers them to people with matching symptoms in Ideas for you and in chat, with an "Add to my plan" button. Plans show on Today and in a private calendar feed (`/cal/<token>.ics`, `api/calendar.js`) people can subscribe to from Apple or Google Calendar.

**Admin page:** `/admin.html` shows every user, their entries and their full chat with Cura, plus usage stats. It's protected by the `ADMIN_PASSWORD` setting in Vercel. You can delete a single user (two taps) or remove all of Claude's test users at once (ids starting with `web-claude-`). The Community tab lists tips to review, lets the team add starter tips in plain words, and shows each group, its members and messages.

Data lives in Upstash Redis, keyed by a random device id stored in the browser (`/api/app`). Entries saved by the older browser-only version are imported automatically the first time the app loads.

## Cura on WhatsApp

Text Cura on WhatsApp instead of opening the site. Cura uses Claude to understand messages like "hot flashes last night, maybe a 7" and saves them as structured symptoms, period starts, check-ins and visit notes.

- `api/twilio.js` receives WhatsApp messages through Twilio (works with Twilio's free WhatsApp Sandbox, no business verification). Set the sandbox's "When a message comes in" URL to `https://mira-care.vercel.app/api/twilio`.
- `api/whatsapp.js` is the same thing for Meta's WhatsApp Cloud API directly, which needs Meta business verification.
- Visit `/api/twilio` or `/api/whatsapp` in a browser to see which settings are still missing.
- `api/_lib/respond.js` loads a person's data, gets Cura's reply and saves it. Every channel calls it.
- `api/_lib/mira.js` holds Cura's prompt, tools and conversation loop. It doesn't depend on the channel, so an iMessage bridge can reuse it later.
- `api/_lib/store.js` saves each person's data (keyed by phone number) in Upstash Redis.

Settings are listed in [`.env.example`](.env.example). Text **DELETE ALL** to Cura to erase your saved data.

## Run locally

The app needs the `/api` functions, so run it with the Vercel CLI (`vercel dev`) after linking the project and pulling its environment variables.

## Developer tools (`dev/`, not deployed)

- `sh dev/syntax-check.sh`: syntax-checks all JavaScript using macOS's built-in JavaScriptCore.
- `jsc -m dev/mira-logic.test.mjs` (or `node dev/mira-logic.test.mjs`): tests Cura's conversation logic with a fake Claude.
- `jsc -m dev/community-logic.test.mjs`: tests the community's grouping rules, idea ranking, plan and calendar file.
- `SEED=1 python3 dev/mock-server.py . 8790`: runs the app locally with a fake backend, sample data and a sample community (`DUE=1` makes plan check-ins due right away; admin password `test123`).
- `python3 dev/replay.py`: replays sample conversations against the live Cura, then erases them.

## Deploy to Vercel

Pushing to `main` deploys automatically. The project needs an Upstash Redis store connected (Vercel → Storage) and the environment variables listed in [`.env.example`](.env.example). Cura organizes personal notes and does not give medical advice.
