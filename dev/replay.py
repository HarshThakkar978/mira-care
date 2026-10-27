# Replays test conversations against the LIVE Cura (uses real Claude credits, a fraction of a cent each),
# prints the replies and what got saved, then erases the test data.
# Test users get ids starting with "claude-" so the admin page can clean up any leftovers.
# Run: python3 dev/replay.py            (or: python3 dev/replay.py elsie)
import datetime, json, sys, urllib.request, uuid

API = "https://mira-care.vercel.app/api/app"
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
}


def call(dev, action, **kw):
    req = urllib.request.Request(API, data=json.dumps({"id": dev, "action": action, **kw}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


for name, msgs in SCENARIOS.items():
    if len(sys.argv) > 1 and name not in sys.argv[1:]:
        continue
    dev = f"claude-replay-{name}-{uuid.uuid4().hex[:8]}"
    print(f"\n===== {name} =====")
    try:
        for m in msgs:
            if isinstance(m, tuple):
                _, tool, inp = m
                inp = dict(inp); days = inp.pop("days_ago", 0)
                inp["date"] = (datetime.date.today() - datetime.timedelta(days=days)).isoformat()
                call(dev, "tool", name=tool, input=inp)
                continue
            d = call(dev, "chat", text=m)
            ui = (d["user"]["transcript"][-1] or {}).get("ui")
            print(f"USER: {m}\nCURA ({len(d['reply'].split())} words): {d['reply']}" + (f"\nBUTTONS: {ui}" if ui else "") + "\n")
        u = d["user"]
        print("SAVED symptoms:", [(s["name"], s.get("severity"), s.get("impact"), s["date"]) for s in u["symptoms"]])
        print("SAVED periods:", [c["date"] for c in u["cycleStarts"]], "| checkins:", [c["feeling"] for c in u["checkins"]], "| name:", u["profile"]["name"])
    finally:
        call(dev, "reset")
