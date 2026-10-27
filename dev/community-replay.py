# Tries the community against the LIVE Cura with two throwaway members, prints what happened, then erases them
# (which also removes their group, messages and tips). Uses real Claude credits, a few cents in all.
# Test members get ids starting with "claude-" so the admin page can clean up any leftovers.
# Run: python3 dev/community-replay.py            (add "daily" to also run today's community job once)
import datetime, json, sys, time, urllib.request, uuid

HOST = "https://mira-care.vercel.app"
API = HOST + "/api/app"


def call(dev, action, **kw):
    req = urllib.request.Request(API, data=json.dumps({"id": dev, "action": action, **kw}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def day(n): return (datetime.date.today() - datetime.timedelta(days=n)).isoformat()


a = f"claude-cm-a-{uuid.uuid4().hex[:10]}"
b = f"claude-cm-b-{uuid.uuid4().hex[:10]}"
try:
    call(a, "tool", name="log_symptoms", input={"date": day(1), "symptoms": [{"name": "night sweats", "severity": 7}, {"name": "trouble sleeping", "severity": 6}]})
    call(b, "tool", name="log_symptoms", input={"date": day(1), "symptoms": [{"name": "hot flashes", "severity": 8}]})
    ja = call(a, "community-join", focus=["Night sweats", "Trouble sleeping"], anonymous=False, name="Ana")
    jb = call(b, "community-join", focus=["Hot flashes", "Night sweats"], anonymous=True)
    print("A joined:", ja["group"]["name"], "| reason:", ja["user"]["community"]["reason"])
    print("B joined:", jb["group"]["name"], "as", jb["user"]["community"]["alias"], "| same group:", ja["group"]["id"] == jb["group"]["id"])

    call(a, "group-post", text="Hi all! I've started keeping a little fan by my bed for the night sweats.")
    call(b, "group-post", text="A cool shower right before bed has helped my hot flashes a lot, honestly a game changer.")
    print("\nWaiting 30s for Claude to read the posts…")
    time.sleep(30)
    g = call(a, "group")
    print("\nGROUP as A sees it:")
    for m in g["messages"]:
        print(f"  {m['name']}{' (me)' if m['mine'] else ''}: {m['text']}")

    last = call(a, "load")["user"]["transcript"][-1]
    print("\nPrivate question to A:", last["text"] if last.get("ui", {}).get("tipAsk") else "(none)", "|", last.get("ui"))
    if last.get("ui", {}).get("tipAsk"):
        d = call(a, "chat", text="Helped a lot")
        print("A answers 'Helped a lot' → Cura:", d["reply"])
    print("Unread for B:", call(b, "load").get("communityUnread"))

    call(a, "tool", name="save_profile", input={"appointment_date": day(-5), "clinician": "Dr. Test"})
    url = call(a, "calendar-link")["url"]
    with urllib.request.urlopen(url, timeout=30) as r:
        ics = r.read().decode()
    print("\nCalendar feed:", r.status, r.headers.get("Content-Type"), "| has appointment:", "SUMMARY:Appointment with Dr. Test" in ics)

    if "daily" in sys.argv[1:]:
        with urllib.request.urlopen(HOST + "/api/reminders?h=14", timeout=300) as r:
            print("\nDaily job:", json.load(r).get("community"))
        print("Newest group message:", call(a, "group")["messages"][-1]["text"])

    print("\nIdeas for A:", [i["title"] for i in call(a, "ideas")["ideas"]] or "(none approved yet)")
finally:
    for dev in (a, b):
        call(dev, "reset")
    print("\nErased both test members.")
