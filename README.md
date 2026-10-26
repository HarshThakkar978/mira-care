# Mira Care

A perimenopause companion you text. Open the app (or add it to your iPhone Home Screen) and it goes straight to an iMessage-style chat with Mira, who uses Claude to log how you feel, period starts and symptoms from plain messages. The other tabs show what you've logged:

- **Chat**: talk to Mira; quick replies for common check-ins
- **Today**: days since your last period, average gap between periods, next appointment, a 30-day symptom strip and your most frequent symptoms
- **Cycle**: month calendar of period starts and symptoms; tap a day to view, add or remove entries
- **Visits**: notes to bring up, an editable agenda Mira drafts from your data, after-visit notes and a follow-up list
- **Me**: your name, a daily reminder notification at an hour you pick, add-to-Home-Screen help, a private link to open Mira on another device, export and erase

Daily reminders use web push (`api/_lib/push.js`). Vercel's Hobby plan only allows once-a-day cron jobs, so `vercel.json` defines 24 daily jobs, one per hour, that all call `/api/reminders`. It sends each person one reminder after their chosen local hour, and skips days they've already logged something. On iPhone, notifications only work once Mira is added to the Home Screen.

**Admin page:** `/admin.html` shows every user, their entries and their full chat with Mira, plus usage stats. It's read-only and protected by the `ADMIN_PASSWORD` setting in Vercel.

Data lives in Upstash Redis, keyed by a random device id stored in the browser (`/api/app`). Entries saved by the older browser-only version are imported automatically the first time the app loads.

## Mira on WhatsApp

Text Mira on WhatsApp instead of opening the site. Mira uses Claude to understand messages like "hot flashes last night, maybe a 7" and saves them as structured symptoms, period starts, check-ins and visit notes.

- `api/twilio.js` receives WhatsApp messages through Twilio (works with Twilio's free WhatsApp Sandbox, no business verification). Set the sandbox's "When a message comes in" URL to `https://mira-care.vercel.app/api/twilio`.
- `api/whatsapp.js` is the same thing for Meta's WhatsApp Cloud API directly, which needs Meta business verification.
- Visit `/api/twilio` or `/api/whatsapp` in a browser to see which settings are still missing.
- `api/_lib/respond.js` loads a person's data, gets Mira's reply and saves it. Every channel calls it.
- `api/_lib/mira.js` holds Mira's prompt, tools and conversation loop. It doesn't depend on the channel, so an iMessage bridge can reuse it later.
- `api/_lib/store.js` saves each person's data (keyed by phone number) in Upstash Redis.

Settings are listed in [`.env.example`](.env.example). Text **DELETE ALL** to Mira to erase your saved data.

## Run locally

The app needs the `/api` functions, so run it with the Vercel CLI (`vercel dev`) after linking the project and pulling its environment variables.

## Deploy to Vercel

Pushing to `main` deploys automatically. The project needs an Upstash Redis store connected (Vercel → Storage) and the environment variables listed in [`.env.example`](.env.example). Mira Care organizes personal notes and does not give medical advice.
