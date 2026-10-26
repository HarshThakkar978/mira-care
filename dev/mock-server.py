# Local test server: serves the site and fakes /api/app and /api/admin (no Claude, no database).
# Run from the project folder:  SEED=1 python3 dev/mock-server.py . 8790
# Admin test password: test123 (local only).
import datetime, json, os, sys, time, uuid, http.server, socketserver

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
PORT = int(os.environ.get("PORT") or (sys.argv[2] if len(sys.argv) > 2 else 8790))
USERS = {}
PAGE = 80


def fresh():
    return {"profile": {"name": "", "appointmentDate": "", "clinician": ""}, "cycleStarts": [], "symptoms": [], "checkins": [],
            "preNotes": [], "postNotes": [], "agenda": {"summary": "", "topics": [], "questions": []},
            "followup": {"summary": "", "steps": [], "questions": []}, "reminder": {"enabled": False, "hour": 20, "devices": 0},
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
        return {"user": view(u)}
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
    if a == "reset": USERS[uid] = fresh(); return {"user": view(USERS[uid])}
    if a == "import": return {"user": view(u), "imported": False}
    if a == "push-key": return {"publicKey": "BCdummy"}
    return {"error": "unknown"}


def chat_stream(h, body):
    u = USERS.setdefault(body.get("id", ""), fresh())
    text = body["text"]
    reply = "Oof, that sounds rough. I've noted it for today. How strong was it, roughly 1 to 10?"
    h.send_response(200); h.send_header("Content-Type", "application/x-ndjson"); h.end_headers()
    def send(o): h.wfile.write((json.dumps(o) + "\n").encode()); h.wfile.flush()
    send({"t": "round"}); time.sleep(0.6)
    for word in reply.split(" "):
        send({"t": "delta", "text": word + " "}); time.sleep(0.05)
    at = now().isoformat()
    u["transcript"] += [{"from": "you", "text": text, "at": at}, {"from": "mira", "text": reply, "at": at}]
    send({"t": "done", "reply": reply, "user": view(u)})


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=ROOT, **k)

    def do_POST(s):
        if s.path != "/api/app": s.send_error(404); return
        body = json.loads(s.rfile.read(int(s.headers["Content-Length"])) or "{}")
        if body.get("action") == "chat" and body.get("stream"): chat_stream(s, body); return
        out = json.dumps(handle(body)).encode()
        s.send_response(200); s.send_header("Content-Type", "application/json"); s.send_header("Content-Length", str(len(out))); s.end_headers(); s.wfile.write(out)

    def end_headers(s):
        s.send_header("Cache-Control", "no-store"); super().end_headers()

    def log_message(s, *a): pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), H) as srv: srv.serve_forever()
