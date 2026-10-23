# Mira Care

A mobile-first, customer-only website for cycle and symptom notes and visit preparation. The first screen is a guided daily check-in that feels like a short text conversation. A dashboard and the original cycle, symptom, appointment-prep, agenda, and after-visit views remain available.

## What works

- Guided check-in with quick replies, optional free-text answers, skip paths, a date picker, and symptom intensity/context
- Save a period start and symptom records from the conversation into the same history used by the dashboard and tracker
- Review cycle history, symptoms, visit details, prep notes, editable agenda items, and after-visit notes
- Export a local JSON copy, print the agenda, or clear browser data from Privacy
- Responsive website navigation with a mobile bottom bar and large touch targets
- Gemini and all network AI calls are disabled; the guided conversation is a deterministic local form

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

From the project folder:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. The app stores entries in browser local storage under `mira-care-local-v2`. Each browser profile and deployed site origin has separate data. The existing storage key keeps prior Mira Care entries intact. There is no login, cloud database, cross-device sync, or backup.

## Deploy to Vercel

1. Import this GitHub repository into Vercel.
2. Choose **Other** for the framework preset if asked.
3. Use the repository root. Leave build and install commands blank; use `.` as the output directory if prompted.
4. Deploy a **Preview** for evaluation.

This is a static site with no build step, server function, database, or account system. Health notes remain in each visitor’s browser and do not reach the server.

## Gemini placeholder

[`.env.example`](.env.example) contains a blank `GEMINI_API_KEY=` marker only. Do not paste a real key into this file, `index.html`, or any committed client-side source. If a compliant server-side integration is approved in a future version, set the secret in **Vercel → Project → Settings → Environment Variables** using the exact name `GEMINI_API_KEY`. This version does not read that variable, and adding it in Vercel will not enable AI. All AI drafting controls remain off; the daily chat is a scripted form and does not transmit or interpret health information.

Before adding any AI service, review the provider’s current terms and confirm that the intended consumer health-notes use is permitted. This prototype is not a clinical service and does not provide medical advice.

## Data and privacy limits

Entries are stored only in the current browser profile on the current device. Anyone with access to that profile may be able to see them. There is no sign-in, database, synchronization, or server-side backup. Use fictional information for demonstrations. Mira Care organizes personal notes; confirm health questions and next steps directly with a qualified clinician.
