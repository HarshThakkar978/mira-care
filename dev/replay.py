# Replays test conversations against the LIVE Mira (uses real Claude credits, a fraction of a cent each),
# prints the replies and what got saved, then erases the test data.
# Test users get ids starting with "claude-" so the admin page can clean up any leftovers.
# Run: python3 dev/replay.py            (or: python3 dev/replay.py elsie)
import json, sys, urllib.request, uuid

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
            d = call(dev, "chat", text=m)
            print(f"USER: {m}\nMIRA ({len(d['reply'].split())} words): {d['reply']}\n")
        u = d["user"]
        print("SAVED symptoms:", [(s["name"], s.get("severity"), s.get("impact"), s["date"]) for s in u["symptoms"]])
        print("SAVED periods:", [c["date"] for c in u["cycleStarts"]], "| checkins:", [c["feeling"] for c in u["checkins"]], "| name:", u["profile"]["name"])
    finally:
        call(dev, "reset")
