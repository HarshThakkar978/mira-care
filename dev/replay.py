# Replays test conversations against the LIVE Cura (uses real Claude credits, a fraction of a cent each),
# prints the replies and what got saved, then erases the test data.
# Test users get ids starting with "claude-" so the admin page can clean up any leftovers.
# Run: python3 dev/replay.py            (or: python3 dev/replay.py elsie)
import datetime, json, sys, urllib.request, uuid

import os
# CURA_URL points the tests at a preview copy of the site instead of the live one.
API = os.environ.get("CURA_URL", "https://curadaily.vercel.app").rstrip("/") + "/api/app"
COOKIE = os.environ.get("CURA_COOKIE", "")  # for a protected preview: the _vercel_jwt cookie
SCENARIOS = {
    "elsie": ["Heyy I've been having crazy cramps and wierd heat flashes, something's I don't ususallt experience",
              "Cramps were a solid 8, and heat flashes were flunctuatinf from 4 to 9",
              "Yeah everything",
              "Nothing in particular"],
    "light": ["hi! I'm Maya, feeling pretty good today actually",
              "slept badly though, woke up sweaty twice",
              "that's all for now"],
    "period": ["my period started yesterday, heavier than usual",
               "what have I logged this week?"],
    "toughday": ["Hey! Tough day today at work. Very exhausted.",
                 "yeah I haven't been sleeping well, keep waking up hot",
                 "ok thanks, that's all for now"],
    # Two earlier tired days are saved first, so Cura should connect today's message to them.
    "tiredagain": [("setup", "log_symptoms", {"days_ago": 2, "symptoms": [{"name": "fatigue", "severity": 6}]}),
                    ("setup", "log_symptoms", {"days_ago": 1, "symptoms": [{"name": "fatigue", "severity": 7}, {"name": "night sweats", "severity": 6}]}),
                    "so tired again today ugh"],
    # Early-user cases: first contact, questions, safety, corrections, off-topic.
    "firsthello": ["hi", "what can you do?", "ok cool. hot flashes are killing me lately"],
    "medq": ["is it normal to get periods every 2 weeks at 47?", "should I start HRT?"],
    "redflag": ["I've been soaking through a pad every hour since this morning and I feel dizzy"],
    "lowmood": ["I just feel so low lately. I cry over nothing and I'm snapping at everyone", "no i'm safe, just tired of feeling like this"],
    "appt": ["I have a doctor's appointment next friday with Dr. Lee", "yes please, mainly I want to ask about my sleep and the mood swings"],
    "fix": ["hot flash this afternoon, an 8", "oops I meant a 5 not 8"],
    "multi": ["night sweats 7 last night, brain fog all day today and my knees ache"],
    "offtopic": ["can you write me a cover letter for a marketing job?"],
    "spanish": ["Hola, tengo sofocos muy fuertes por la noche, como un 8"],
    # "Your story": Cura asks about their background one question at a time and saves it.
    "story": [("action", "story-start"),
              "ugh where do I start. my periods got weird about two years ago, sometimes 3 weeks apart sometimes 2 months. the hot flashes and not sleeping are the worst. tried magnesium, didn't do much",
              "my last one was early october",
              "no surgeries. I'm on levothyroxine for my thyroid",
              "my mom went through it at like 50",
              "I'd just like to know if HRT is an option for me",
              "47"],
    # One long voice-note style answer: Cura should pull out several fields at once and only ask what's missing.
    "storyvoice": [("action", "story-start"),
                   "okay so um it started maybe a year and a half ago when I was 46, my periods went from every 28 days to like every 40 or 50, last one was about six weeks ago. night sweats are the worst and the anxiety, I never used to be anxious. I tried cutting caffeine which helped a little. my mum had early menopause I think around 45. I had my gallbladder out years ago but nothing else",
                   "mainly I just want to sleep through the night again",
                   "thanks that's everything"],
    # Tapping the buttons all the way through, with one typed answer in the middle.
    "storytaps": [("action", "story-start"), "1–2 years ago", "Gaps of 2+ months", "1–2 months ago",
                  "Hot flashes, Trouble sleeping, Brain fog", "Supplements, Exercise", "magnesium helped my sleep a bit, exercise not really",
                  "Thyroid condition", "I'd rather not say", "45–49", "Sleeping better, Talking to my doctor"],
    # Questions about the app itself: Cura must know her own features (see APP_GUIDE in api/_lib/mira.js).
    "appqs": ["can you remind me every day to check in?", "how do I show all this to my doctor?", "what's the circle?",
              "can I talk instead of typing?", "how do I delete everything?", "can I import my data from Flo?"],
    # Tips should come with a trusted source link.
    # The conversation from the first phone test: name known, mood button, then sleep.
    "harsh": [("setup", "save_profile", {"name": "Harsh"}),
              "Feeling okay today", "Slept badly", "Woke up and couldn't go back",
              "yeah it's been like that most of this week", "thanks"],
    "tips": ["any tips for night sweats? I'm soaked every night", "what is perimenopause exactly?"],
    "deleteit": ["headache today, a 4", "actually delete that, it was just from not drinking water"],
}


def call(dev, action, **kw):
    req = urllib.request.Request(API, data=json.dumps({"id": dev, "action": action, **kw}).encode(), headers={"Content-Type": "application/json", **({"Cookie": COOKIE} if COOKIE else {})})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


for name, msgs in SCENARIOS.items():
    if len(sys.argv) > 1 and name not in sys.argv[1:]:
        continue
    dev = f"claude-replay-{name}-{uuid.uuid4().hex[:8]}"
    print(f"\n===== {name} =====")
    try:
        for m in msgs:
            if isinstance(m, tuple) and m[0] == "action":
                d = call(dev, m[1]); t = d['user']['transcript'][-1]; print(f"[{m[1]}] CURA: {t['text']}" + (f"\nBUTTONS: {t['ui']}" if t.get('ui') else "") + "\n"); continue
            if isinstance(m, tuple):
                _, tool, inp = m
                inp = dict(inp); days = inp.pop("days_ago", 0)
                if tool == "save_profile": call(dev, "tool", name=tool, input=inp); continue
                inp["date"] = (datetime.date.today() - datetime.timedelta(days=days)).isoformat()
                call(dev, "tool", name=tool, input=inp)
                continue
            d = call(dev, "chat", text=m)
            last = [x for x in d["user"]["transcript"] if x["from"] == "mira" and x.get("text") == d["reply"]][-1:] or [{}]
            ui, src, sv = last[0].get("ui"), last[0].get("source"), last[0].get("saved")
            tr = d["user"]["transcript"]; idx = max(i for i, x in enumerate(tr) if x["from"] == "mira" and x.get("text") == d["reply"])
            extra = "".join(f"\nTHEN CURA: {x['text']}" + (f" [buttons: {x['ui']['options']}]" if x.get("ui") else "") + (f" [why: {x['why']['text']}]" if x.get("why") else "") for x in tr[idx + 1:])
            print(f"USER: {m}\nCURA ({len(d['reply'].split())} words): {d['reply']}" + extra + (f"\nBUTTONS: {ui}" if ui else "") + (f"\nSOURCE: {src['site']} · {src['title']}" if src else "") + (f"\nSAVED LINE: {', '.join(sv)}" if sv else "") + "\n")
        u = d["user"]
        print("SAVED symptoms:", [(s["name"], s.get("severity"), s.get("impact"), s["date"]) for s in u["symptoms"]])
        print("SAVED periods:", [c["date"] for c in u["cycleStarts"]], "| checkins:", [c["feeling"] for c in u["checkins"]], "| name:", u["profile"]["name"])
        if u.get("story", {}).get("startedAt"): print("SAVED story:", u["story"]["fields"], "| finished:", bool(u["story"].get("completedAt")))
        print("SAVED visit notes:", [n["text"] for n in u["preNotes"]], "| appointment:", u["profile"].get("appointmentDate"), u["profile"].get("clinician"))
    finally:
        call(dev, "reset")
