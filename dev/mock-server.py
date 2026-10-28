# Local test server: serves the site and fakes /api/app and /api/admin (no Claude, no database).
# Includes a fake community: one group with a few members, tips to review, and ideas.
# Run from the project folder:  SEED=1 python3 dev/mock-server.py . 8790
# Admin test password: test123 (local only).
import datetime, json, os, sys, time, uuid, http.server, socketserver

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
PORT = int(os.environ.get("PORT") or (sys.argv[2] if len(sys.argv) > 2 else 8790))
USERS = {}
PAGE = 80
GROUP = {"id": "g1", "name": "Sleep & night sweats", "focus": "For people whose nights are broken by heat and sweats.", "members": ["Hazel", "Juniper", "Maya"]}
GMSGS = []
TIPS = [
    {"id": "t1", "status": "approved", "source": "member", "symptom": "night sweats", "title": "Keep a fan by your bed", "details": "A small fan pointed at the bed, on all night.", "when": "bedtime", "kind": "everyday", "why": "Moving air helps sweat evaporate, which cools your skin faster when a sweat hits.", "shared": 3, "tried": 4, "helped": 3, "howWell": "a_lot", "quote": "Honestly a little fan by the bed changed everything for me", "authorName": "Hazel"},
    {"id": "t2", "status": "approved", "source": "team", "symptom": "night sweats", "title": "Sleep in cotton or bamboo layers", "details": "", "when": "bedtime", "kind": "everyday", "why": "Breathable fabrics wick moisture away, so you're less likely to wake up damp and cold.", "shared": 0, "tried": 0, "helped": 0, "howWell": "unclear", "quote": ""},
    {"id": "t3", "status": "approved", "source": "member", "symptom": "anxiety", "title": "Try slow box breathing", "details": "Breathe in for 4, hold 4, out 4, hold 4.", "when": "anytime", "kind": "everyday", "why": "Slow, even breathing can calm your body's stress response within a few minutes.", "shared": 2, "tried": 1, "helped": 1, "howWell": "some", "quote": "box breathing helps me when the panic comes", "authorName": "Juniper"},
    {"id": "t4", "status": "approved", "source": "member", "symptom": "hot flashes", "title": "Ask about hormone therapy", "details": "", "when": "anytime", "kind": "medical", "why": "Some members found this helpful. It's a decision to talk through with your clinician.", "shared": 2, "tried": 0, "helped": 0, "howWell": "a_lot", "quote": "HRT has been a game changer for my flashes", "authorName": "Maya"},
    {"id": "t5", "status": "pending", "source": "member", "symptom": "trouble sleeping", "title": "Keep the bedroom cool", "details": "Window cracked open, thermostat at 65.", "when": "bedtime", "kind": "everyday", "why": "", "shared": 1, "tried": 0, "helped": 0, "howWell": "unclear", "quote": "I crack the window and keep it at 65, sleeping a bit better", "authorName": "Juniper"},
]


def fresh():
    return {"profile": {"name": "", "appointmentDate": "", "clinician": ""}, "cycleStarts": [], "symptoms": [], "checkins": [],
            "preNotes": [], "postNotes": [], "agenda": {"summary": "", "topics": [], "questions": []},
            "followup": {"summary": "", "steps": [], "questions": []}, "reminder": {"enabled": False, "hour": 20, "devices": 0},
            "community": {"joined": False, "anonymous": False, "alias": "", "focus": [], "groupId": "", "reason": "", "notice": None, "hidden": []}, "plan": [],
            "transcript": [], "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}


def nid(): return uuid.uuid4().hex[:8]
def today(): return datetime.date.today().isoformat()
def now(): return datetime.datetime.now(datetime.timezone.utc)


def seed(u):
    t = datetime.date.today()
    d = lambda n: (t - datetime.timedelta(days=n)).isoformat()
    u["profile"].update(name="Priya", appointmentDate=(t + datetime.timedelta(days=6)).isoformat(), clinician="Dr. Patel")
    u["cycleStarts"] = [{"id": nid(), "date": d(70)}, {"id": nid(), "date": d(36)}, {"id": nid(), "date": d(4)}]
    names = [("hot flashes", 6), ("night sweats", 7), ("brain fog", 4), ("hot flashes", 5), ("joint pain", 3), ("hot flashes", 8), ("trouble sleeping", 6)]
    u["symptoms"] = [{"id": nid(), "date": d(i * 2 + 1), "name": n, "severity": s, "impact": "woke up twice" if i % 2 else "", "notes": ""} for i, (n, s) in enumerate(names)]
    u["checkins"] = [{"id": nid(), "date": d(1), "feeling": "tired but okay"}]
    u["preNotes"] = [{"id": nid(), "date": d(2), "text": "Sleep has been much worse since August"}]
    base = now() - datetime.timedelta(days=3)
    # 120 older messages so "Load earlier messages" can be tested
    for i in range(60):
        at = (base + datetime.timedelta(minutes=i * 7)).isoformat()
        u["transcript"] += [{"from": "you", "text": f"old message {i + 1}", "at": at}, {"from": "mira", "text": f"Reply {i + 1}, noted.", "at": at}]
    at = (now() - datetime.timedelta(hours=26)).isoformat()
    u["transcript"] += [{"from": "you", "text": "hot flashes last night, maybe a 6", "at": at},
                        {"from": "mira", "text": "Oof, sorry. Logged the *hot flashes* at 6. Did they wake you up?", "at": at}]


def seed_group():
    if GMSGS: return
    base = now() - datetime.timedelta(hours=5)
    for i, (who, text) in enumerate([("cura", "💬 Question of the day: What's one small thing that makes your nights a little easier?"),
                                     ("Hazel", "Honestly a little fan by the bed changed everything for me"),
                                     ("Juniper", "I crack the window and keep it at 65, sleeping a bit better"),
                                     ("Maya", "Waking up soaked again last night. So tired of it"),
                                     ("Hazel", "Ugh, sending hugs Maya. Cotton pyjamas helped me a bit too")]):
        GMSGS.append({"id": nid(), "from": who, "text": text, "at": (base + datetime.timedelta(minutes=i * 20)).isoformat()})


def group_view(u, since=""):
    seed_group()
    me = alias(u)
    msgs = [{"id": m["id"], "at": m["at"], "text": m["text"], "kind": "", "cura": m["from"] == "cura", "mine": m["from"] == "me",
             "name": "Cura" if m["from"] == "cura" else me if m["from"] == "me" else m["from"]} for m in GMSGS if not since or m["at"] >= since]
    return {"group": {**{k: GROUP[k] for k in ("id", "name", "focus")}, "size": len(GROUP["members"]) + 1, "members": GROUP["members"] + [me + " (you)"]},
            "messages": msgs, "notice": u["community"].get("notice"), "reason": u["community"].get("reason", "")}


def alias(u):
    c = u["community"]
    return c["alias"] if c.get("anonymous") or not u["profile"]["name"] else u["profile"]["name"]


def card(t, u):
    mine = {s["name"].lower() for s in u["symptoms"]} | {f.lower() for f in u["community"]["focus"]}
    return {"id": t["id"], "title": t["title"], "symptom": t["symptom"], "why": t["why"], "details": t["details"], "when": t["when"], "kind": t["kind"],
            "team": t["source"] == "team", "stats": {"shared": t["shared"], "tried": t["tried"], "helped": t["helped"]},
            "personal": f"You've logged {t['symptom']} on 3 of the last 14 days." if t["symptom"] in mine else "", "match": t["symptom"] in mine}


def ideas(u):
    skip = set(u["community"]["hidden"]) | {p["tipId"] for p in u["plan"] if p["status"] != "removed"}
    out = [card(t, u) for t in TIPS if t["status"] == "approved" and t["id"] not in skip]
    return sorted(out, key=lambda c: not c["match"])


def view(u):
    v = {k: x for k, x in u.items() if k not in ("history", "actionLog")}
    v["transcript"] = u["transcript"][-PAGE:]
    v["transcriptTotal"] = len(u["transcript"])
    return v


def handle(body):
    uid = body.get("id", ""); a = body.get("action")
    u = USERS.setdefault(uid, fresh())
    if a == "load":
        if os.environ.get("SEED") and not u["symptoms"] and not u.get("_seeded"):
            seed(u); u["_seeded"] = True
        return {"user": view(u), "communityUnread": 2 if u["community"]["joined"] else 0, "googleClientId": os.environ.get("GOOGLE_ID", "")}
    if a == "transcript":
        loaded = int(body.get("loaded") or 0); end = max(0, len(u["transcript"]) - loaded)
        return {"messages": u["transcript"][max(0, end - PAGE):end], "remaining": max(0, end - PAGE)}
    if a == "insight":
        return {"insight": "Hot flashes showed up on 3 nights this week, mostly around 6–8, and they often came with broken sleep."}
    if a == "tool":
        n, i = body["name"], body.get("input", {})
        date = i.get("date") or today()
        if n == "log_symptoms":
            for s in i.get("symptoms", []): u["symptoms"].append({"id": nid(), "date": date, "name": s["name"], "severity": s.get("severity", ""), "impact": s.get("impact", ""), "notes": ""})
        elif n == "log_period_start": u["cycleStarts"].append({"id": nid(), "date": date})
        elif n == "log_feeling": u["checkins"].append({"id": nid(), "date": date, "feeling": i.get("feeling", "")})
        elif n == "save_profile":
            if "name" in i: u["profile"]["name"] = i["name"]
            if "appointment_date" in i: u["profile"]["appointmentDate"] = i["appointment_date"]
            if "clinician" in i: u["profile"]["clinician"] = i["clinician"]
        elif n == "add_visit_note": u["preNotes"].append({"id": nid(), "date": today(), "text": i["text"]})
        elif n == "add_after_visit_note": u["postNotes"].append({"id": nid(), "date": today(), "text": i["text"]})
        elif n == "delete_entry":
            k = {"symptom": "symptoms", "period_start": "cycleStarts", "checkin": "checkins", "visit_note": "preNotes", "after_note": "postNotes"}[i["kind"]]
            u[k] = [x for x in u[k] if x["id"] != i["id"]]
        return {"result": {"ok": True}, "user": view(u)}
    if a == "patch":
        for f in ("agenda", "followup"):
            if body.get(f): u[f] = body[f]
        return {"user": view(u)}
    if a == "draft":
        if body.get("mode") == "after": u["followup"] = {"summary": "We talked about sleep.", "steps": ["Track sleep for 4 weeks"], "questions": ["Is a follow-up needed?"]}
        else: u["agenda"] = {"summary": "I've had hot flashes most nights lately, often around 6-8/10, and my sleep is worse.", "topics": ["Hot flashes at night", "Sleep", "Brain fog"], "questions": ["What could help my sleep?"]}
        return {"user": view(u)}
    if a == "community-join":
        c = u["community"]
        if body.get("name") and not body.get("anonymous"): u["profile"]["name"] = body["name"]
        c.update(joined=True, anonymous=bool(body.get("anonymous")) or not u["profile"]["name"], alias="Willow", focus=body.get("focus", []), groupId="g1",
                 reason="You're with others who've been having a lot of night sweats and broken sleep.")
        seed_group()
        GMSGS.append({"id": nid(), "from": "cura", "text": f"Say hi to {alias(u)} 💚 {alias(u)}'s here to talk about {', '.join(f.lower() for f in c['focus'][:3])}. Has anyone found something that helps?", "at": now().isoformat()})
        return {"user": view(u), **group_view(u)}
    if a == "community-settings":
        if body.get("clearNotice"): u["community"]["notice"] = None
        if isinstance(body.get("anonymous"), bool): u["community"]["anonymous"] = body["anonymous"]
        if isinstance(body.get("focus"), list): u["community"]["focus"] = body["focus"]
        return {"user": view(u)}
    if a == "community-leave":
        u["community"] = fresh()["community"]; return {"user": view(u)}
    if a == "group": return group_view(u, body.get("since", ""))
    if a == "group-post":
        GMSGS.append({"id": nid(), "from": "me", "text": body["text"], "at": now().isoformat()})
        if "?" in body["text"]:
            GMSGS.append({"id": nid(), "from": "Hazel", "text": "Good question! For me it was the fan, and no screens after 10.", "at": (now() + datetime.timedelta(seconds=1)).isoformat()})
        return group_view(u, body.get("since", ""))
    if a == "ideas": return {"ideas": ideas(u)}
    if a == "tip-hide": u["community"]["hidden"].append(body["tipId"]); return {"user": view(u), "ideas": ideas(u)}
    if a == "plan-add":
        t = next(x for x in TIPS if x["id"] == body["tipId"])
        u["plan"].append({"id": nid(), "tipId": t["id"], "title": t["title"], "symptom": t["symptom"], "why": t["why"], "when": t["when"],
                          "start": (datetime.date.today() - datetime.timedelta(days=7 if os.environ.get("DUE") else 0)).isoformat(),
                          "checkOn": (datetime.date.today() + datetime.timedelta(days=0 if os.environ.get("DUE") else 7)).isoformat(), "done": [], "status": "active", "outcome": ""})
        return {"user": view(u)}
    if a in ("plan-done", "plan-outcome", "plan-remove"):
        p = next((x for x in u["plan"] if x["id"] == body["item"]), None)
        if a == "plan-remove": u["plan"] = [x for x in u["plan"] if x["id"] != body["item"]]
        elif a == "plan-done": p["done"] = [d for d in p["done"] if d != body["date"]] if body["date"] in p["done"] else p["done"] + [body["date"]]
        else: p.update(outcome=body["how"], status="stopped" if body["how"] == "not_much" else "active", kept=body["how"] != "not_much")
        return {"user": view(u)}
    if a == "calendar-link": return {"url": f"http://localhost:{PORT}/cal/0123456789abcdef0123456789abcdef.ics", "user": view(u)}
    if a == "reset": USERS[uid] = fresh(); return {"user": view(USERS[uid])}
    if a == "import": return {"user": view(u), "imported": False}
    if a == "push-key": return {"publicKey": "BCdummy"}
    return {"error": "unknown"}


def chat_stream(h, body):
    u = USERS.setdefault(body.get("id", ""), fresh())
    text = body["text"]
    low = text.lower()
    idea = None
    if "sweat" in low:
        reply, ui = "Ugh, that's rough. A few members found a fan by the bed really helps. Did they wake you up?", {"kind": "options", "options": ["Yes, a few times", "Once", "Not really"]}
        idea = card(TIPS[0], u)
    elif "sleep" in low:
        reply, ui = "That sounds exhausting. Did you wake up hot or sweaty?", {"kind": "options", "options": ["Yes, a few times", "Once", "Not really"]}
    elif "symptom" in low or "else" in low:
        reply, ui = "Anything else today? Tap any that fit.", {"kind": "multi", "options": ["Headache", "Brain fog", "Joint pain", "Mood swings", "Bloating"]}
    elif "/10" in low or low.strip().isdigit():
        reply, ui = "Thanks, noted. Try a warm heat pad and an easy evening if you can.", None
    else:
        reply, ui = "Oof, that sounds rough. I've noted it for today. How strong was it, 1 to 10?", {"kind": "scale", "low": "Barely there", "high": "Worst ever"}
    h.send_response(200); h.send_header("Content-Type", "application/x-ndjson"); h.end_headers()
    def send(o): h.wfile.write((json.dumps(o) + "\n").encode()); h.wfile.flush()
    send({"t": "round"}); time.sleep(0.6)
    for word in reply.split(" "):
        send({"t": "delta", "text": word + " "}); time.sleep(0.05)
    at = now().isoformat()
    m = {"from": "mira", "text": reply, "at": at}
    if ui: m["ui"] = ui
    if idea: m["idea"] = idea
    u["transcript"] += [{"from": "you", "text": text, "at": at}, m]
    send({"t": "done", "reply": reply, "user": view(u)})


def admin(body):
    if body.get("password") != "test123": return {"error": "Wrong password"}, 401
    a = body.get("action")
    if a == "list":
        users = [{"id": f"web-{k[:12]}", "channel": "App", "name": u["profile"]["name"], "createdAt": u["createdAt"], "lastActive": u["createdAt"], "messages": len(u["transcript"]) // 2,
                  "symptoms": len(u["symptoms"]), "periods": len(u["cycleStarts"]), "checkins": len(u["checkins"]), "notes": 0, "reminder": None, "lastMessage": "", "test": False} for k, u in USERS.items()]
        days = [{"date": (datetime.date.today() - datetime.timedelta(days=13 - i)).isoformat(), "messages": i % 4} for i in range(14)]
        return {"stats": {"users": len(users), "active1": len(users), "active7": len(users), "messages7": 9, "messagesAll": 30, "symptoms": 7, "reminders": 0, "perDay": days}, "users": users}, 200
    if a == "community":
        seed_group()
        tips = [{**t, "reports": max(0, t["shared"] - 1), "createdAt": now().isoformat(), "groupName": GROUP["name"], "stats": {"added": 2, "tried": t["tried"], "helped": t["helped"]}} for t in TIPS]
        return {"groups": [{"id": "g1", "name": GROUP["name"], "focus": GROUP["focus"], "createdAt": now().isoformat(), "messages": len(GMSGS),
                            "common": [{"name": "night sweats", "members": 3, "avg": 6.5}, {"name": "trouble sleeping", "members": 2, "avg": 5.0}],
                            "members": [{"key": "web-x", "name": n, "joinedAt": now().isoformat(), "focus": ["Night sweats"]} for n in GROUP["members"]], "questions": []}], "tips": tips}, 200
    if a == "group-msgs":
        seed_group(); return {"messages": [{**m, "name": "Cura" if m["from"] == "cura" else m["from"]} for m in GMSGS]}, 200
    if a == "msg-delete":
        GMSGS[:] = [m for m in GMSGS if m["id"] != body["msgId"]]; return {"deleted": 1}, 200
    if a == "tip-save":
        t = next((x for x in TIPS if x["id"] == body["id"]), None)
        if not t: return {"error": "Tip not found"}, 404
        if body.get("remove"): TIPS.remove(t); return {"tip": t}, 200
        t.update({k: v for k, v in (body.get("fields") or {}).items() if k in ("title", "symptom", "details", "why", "when", "kind")})
        if body.get("status"): t["status"] = body["status"]
        if t["status"] == "approved" and not t["why"]: t["why"] = "A cooler room can make it easier to fall and stay asleep."
        return {"tip": t}, 200
    if a == "tip-add":
        for line in [x for x in body["text"].splitlines() if x.strip()]:
            TIPS.append({"id": nid(), "status": "approved", "source": "team", "symptom": "night sweats", "title": line.strip()[:60], "details": "", "when": "bedtime", "kind": "everyday",
                         "why": "This may help you stay cooler at night.", "shared": 0, "tried": 0, "helped": 0, "howWell": "unclear", "quote": line})
        return {"added": 1}, 200
    if a == "regroup": return {"result": {"changed": False, "members": 4}}, 200
    if a == "questions": return {"posted": 0}, 200
    return {"error": "unknown"}, 400


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=ROOT, **k)

    def do_POST(s):
        if s.path not in ("/api/app", "/api/admin"): s.send_error(404); return
        body = json.loads(s.rfile.read(int(s.headers["Content-Length"])) or "{}")
        if s.path == "/api/admin": result, code = admin(body)
        elif body.get("action") == "chat" and body.get("stream"): chat_stream(s, body); return
        else: result, code = handle(body), 200
        out = json.dumps(result).encode()
        s.send_response(code); s.send_header("Content-Type", "application/json"); s.send_header("Content-Length", str(len(out))); s.end_headers(); s.wfile.write(out)

    def end_headers(s):
        s.send_header("Cache-Control", "no-store"); super().end_headers()

    def log_message(s, *a): pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), H) as srv: srv.serve_forever()
