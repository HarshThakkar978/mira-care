(() => {
  // ---------- Storage & identity ----------
  const ID_KEY = 'mira-device-id', CACHE_KEY = 'mira-cache-v3', OLD_KEY = 'mira-care-local-v2', TIP_KEY = 'mira-install-tip';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} }
  };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  const ID_RE = /^[A-Za-z0-9-]{16,64}$/;

  // "?device=<id>" opens the same Mira on another phone or computer.
  const linked = new URLSearchParams(location.search).get('device');
  if (linked && ID_RE.test(linked)) { store.set(ID_KEY, linked); store.del(CACHE_KEY); history.replaceState(null, '', location.pathname + location.hash); }
  let deviceId = store.get(ID_KEY);
  if (!deviceId || !ID_RE.test(deviceId)) { deviceId = newId(); store.set(ID_KEY, deviceId); }

  const emptyUser = () => ({ profile: { name: '', appointmentDate: '', clinician: '' }, cycleStarts: [], symptoms: [], checkins: [], preNotes: [], postNotes: [], agenda: { summary: '', topics: [], questions: [] }, followup: { summary: '', steps: [], questions: [] }, reminder: { enabled: false, hour: 20, devices: 0 }, transcript: [] });
  let user = (() => { try { return { ...emptyUser(), ...JSON.parse(store.get(CACHE_KEY) || '{}') }; } catch { return emptyUser(); } })();
  const saveCache = () => store.set(CACHE_KEY, JSON.stringify(user));

  // ---------- Helpers ----------
  const $ = (s, root = document) => root.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => iso(new Date());
  const parse = s => new Date(s + 'T12:00:00');
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const fmt = (s, opts = { month: 'short', day: 'numeric' }) => (s ? parse(s).toLocaleDateString(undefined, opts) : '');
  const fmtLong = s => fmt(s, { weekday: 'short', month: 'short', day: 'numeric' });
  const sevClass = v => (v ? 's' + Math.min(5, Math.ceil(Number(v) / 2)) : '');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const hasData = u => u.symptoms.length + u.cycleStarts.length + u.checkins.length + u.preNotes.length + u.postNotes.length + u.transcript.length > 0;
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const hourLabel = h => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const b64ToBytes = s => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  let toastTimer;
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  async function api(action, payload = {}, { keepUser = false } = {}) {
    const res = await fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: deviceId, action, ...payload }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not reach Mira. Check your connection.');
    if (data.user && !keepUser) { user = { ...emptyUser(), ...data.user }; saveCache(); }
    return data;
  }
  const tool = (name, input) => api('tool', { name, input });

  // ---------- Routing ----------
  const ROUTES = ['chat', 'today', 'cycle', 'visit', 'me'];
  let route = ROUTES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'chat';
  const ui = { sending: false, pending: '', failed: '', month: today().slice(0, 7), selDay: today(), visitTab: 'before', drafting: false, confirmReset: false, showSymForm: false };
  function go(to) { route = to; if (location.hash.slice(1) !== to) history.replaceState(null, '', '#' + to); render(); }
  window.addEventListener('hashchange', () => { const r = location.hash.slice(1); if (ROUTES.includes(r) && r !== route) { route = r; render(); } });

  function render() {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.route === route));
    const view = $('#view');
    view.innerHTML = { chat: renderChat, today: renderToday, cycle: renderCycle, visit: renderVisit, me: renderMe }[route]();
    if (route === 'chat') { afterChatRender(); } else view.scrollTop = 0;
    document.querySelectorAll('textarea.ag-text').forEach(autoGrow);
  }

  // ---------- Chat ----------
  const fmtMsg = t => esc(t).replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>').replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?)])/g, '$1<em>$2</em>').replace(/\n/g, '<br>');
  const stampText = at => {
    const d = new Date(at), now = new Date();
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const sameDay = d.toDateString() === now.toDateString();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    const day = sameDay ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return `<b>${day}</b> ${time}`;
  };
  const WELCOME = "Hi, I'm Mira 💚 Text me whenever you like: how you're feeling, a symptom, or when your period starts. I'll keep track of it all and help you get ready for appointments.";

  function threadHtml() {
    const msgs = [...(user.transcript || [])];
    let html = '';
    if (!msgs.length) html += `<div class="stamp"><b>Mira</b></div><div class="msg them tail">${fmtMsg(WELCOME)}</div>`;
    msgs.forEach((m, i) => {
      const prev = msgs[i - 1], next = msgs[i + 1];
      if (!prev || new Date(m.at) - new Date(prev.at) > 3600000) html += `<div class="stamp">${stampText(m.at)}</div>`;
      const tail = !next || next.from !== m.from || new Date(next.at) - new Date(m.at) > 3600000;
      html += `<div class="msg ${m.from === 'you' ? 'me' : 'them'}${tail ? ' tail' : ''}">${fmtMsg(m.text)}</div>`;
    });
    if (ui.pending) html += `<div class="msg me tail">${fmtMsg(ui.pending)}</div><div class="typing" aria-label="Mira is typing"><i></i><i></i><i></i></div>`;
    else if (ui.failed) html += `<div class="msg me tail failed">${fmtMsg(ui.failed)}</div><div class="msg-status error" data-action="retry">Not delivered · Tap to try again</div>`;
    else if (msgs.length && msgs[msgs.length - 1].from === 'mira') html += `<div class="msg-status">Delivered</div>`;
    return html;
  }
  function chipsHtml() {
    const first = !(user.transcript || []).length;
    const list = first
      ? ['Feeling okay today', 'Rough day today', 'My period started today', 'I had hot flashes last night']
      : ['Feeling good today', 'Rough day today', 'My period started today', 'How has my week been?', 'Help me prep for my appointment'];
    return list.map(t => `<button class="chip" data-chip="${esc(t)}">${esc(t)}</button>`).join('');
  }
  function renderChat() {
    const tip = isIOS() && !isStandalone() && !store.get(TIP_KEY)
      ? `<div class="install no-print"><span>📲</span><span><b>Keep Mira on your Home Screen.</b> Tap the Share button, then <b>Add to Home Screen</b>.</span><button class="icon-btn" data-action="dismiss-tip" aria-label="Dismiss">×</button></div>` : '';
    return `<section class="chat">
      <header class="chat-head"><div class="avatar">m</div><div class="chat-name">Mira</div><div class="chat-status">Your perimenopause companion</div></header>
      ${tip}
      <div class="thread" id="thread" aria-live="polite">${threadHtml()}</div>
      <div class="chips no-print" id="chips">${chipsHtml()}</div>
      <form class="composer no-print" id="composer">
        <label class="sr-only" for="msgInput">Message Mira</label>
        <textarea id="msgInput" rows="1" placeholder="Message Mira" enterkeyhint="send" autocomplete="off"></textarea>
        <button class="send" id="sendBtn" type="submit" aria-label="Send" disabled><svg viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg></button>
      </form>
    </section>`;
  }
  function afterChatRender() { scrollThread(); }
  function scrollThread() { const t = $('#thread'); if (t) t.scrollTop = t.scrollHeight; }
  function refreshThread() { const t = $('#thread'); if (!t) return; t.innerHTML = threadHtml(); const c = $('#chips'); if (c) c.innerHTML = chipsHtml(); scrollThread(); }
  function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, el.classList.contains('ag-text') ? 400 : 140) + 'px'; }

  async function sendMessage(text) {
    text = text.trim();
    if (!text || ui.sending) return;
    ui.sending = true; ui.pending = text; ui.failed = '';
    refreshThread();
    try { await api('chat', { text }); }
    catch (e) { ui.failed = text; toast(e.message); }
    ui.sending = false; ui.pending = '';
    if (route === 'chat') refreshThread();
  }

  // ---------- Data views ----------
  const sortedStarts = () => [...user.cycleStarts].sort((a, b) => a.date.localeCompare(b.date));
  const lastStart = () => sortedStarts().slice(-1)[0];
  function cycleGaps() { const s = sortedStarts(); return s.slice(1).map((x, i) => diffDays(s[i].date, x.date)).filter(n => n > 0); }
  function symptomsSince(days) { const from = addDays(today(), -days + 1); return user.symptoms.filter(s => s.date >= from && s.date <= today()); }
  function topSymptoms(list) {
    const map = new Map();
    for (const s of list) {
      const key = String(s.name || '').trim().toLowerCase(); if (!key) continue;
      const e = map.get(key) || { name: s.name.trim(), count: 0, sevSum: 0, sevN: 0, days: new Set() };
      e.count++; e.days.add(s.date); if (Number(s.severity)) { e.sevSum += Number(s.severity); e.sevN++; }
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => b.days.size - a.days.size || b.count - a.count);
  }
  function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }

  function renderToday() {
    const name = user.profile.name;
    const ls = lastStart(), gaps = cycleGaps();
    const avg = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
    const since = ls ? diffDays(ls.date, today()) + 1 : null;
    const appt = user.profile.appointmentDate, apptIn = appt ? diffDays(today(), appt) : null;
    const s30 = symptomsSince(30), top = topSymptoms(s30).slice(0, 6), maxDays = Math.max(1, ...top.map(t => t.days.size));
    const logged = new Set([...s30.map(s => s.date), ...user.checkins.filter(c => c.date >= addDays(today(), -29)).map(c => c.date)]);
    const daySev = {}; s30.forEach(s => { daySev[s.date] = Math.max(daySev[s.date] || 0, Number(s.severity) || 3); });
    const starts = new Set(user.cycleStarts.map(c => c.date));
    const strip = Array.from({ length: 30 }, (_, i) => {
      const d = addDays(today(), i - 29), sev = daySev[d];
      const bg = sev ? `background:var(--sev-${Math.min(5, Math.ceil(sev / 2))})` : '';
      const label = `${fmt(d)}${sev ? `: symptoms up to ${sev}/10` : ''}${starts.has(d) ? ', period started' : ''}`;
      return `<span style="${bg}" class="${starts.has(d) ? 'p' : ''}${d === today() ? ' today' : ''}" title="${esc(label)}" aria-label="${esc(label)}"></span>`;
    }).join('');
    const lastCheck = [...user.checkins].sort((a, b) => (b.savedAt || b.date).localeCompare(a.savedAt || a.date))[0];
    const checkedToday = user.checkins.some(c => c.date === today()) || user.symptoms.some(s => s.date === today());
    return `<div class="page">
      <div class="page-head"><div class="eyebrow">${esc(fmt(today(), { weekday: 'long', month: 'long', day: 'numeric' }))}</div><h1 class="title">${greeting()}${name ? ', ' + esc(name) : ''}</h1></div>
      <button class="cta" data-route="chat"><span style="font-size:28px">💬</span><span><strong>${checkedToday ? 'Anything else today?' : 'How are you feeling today?'}</strong><small>${checkedToday ? 'You checked in today. Tell Mira if anything changes.' : 'Text Mira, it takes 10 seconds.'}</small></span><span class="arrow">›</span></button>
      ${user.reminder && user.reminder.enabled ? '' : `<button class="btn ghost no-print" data-route="me" style="width:100%;margin:-4px 0 14px">🔔 Get a gentle daily check-in reminder</button>`}
      <div class="grid three">
        <div class="card stat"><div class="stat-label">Since last period</div><div class="stat-value">${since ? plural(since, 'day') : '—'}</div><div class="stat-note">${ls ? 'Started ' + fmt(ls.date) : 'Tell Mira when it starts'}</div></div>
        <div class="card stat"><div class="stat-label">Average gap</div><div class="stat-value">${avg ? avg + ' days' : '—'}</div><div class="stat-note">${gaps.length ? `Across ${plural(gaps.length + 1, 'period')} · last ${gaps[gaps.length - 1]} days` : 'Needs two period starts'}</div></div>
        <div class="card stat"><div class="stat-label">Next appointment</div><div class="stat-value">${appt ? (apptIn > 0 ? `In ${plural(apptIn, 'day')}` : apptIn === 0 ? 'Today' : fmt(appt)) : '—'}</div><div class="stat-note">${appt ? fmtLong(appt) + (user.profile.clinician ? ' · ' + esc(user.profile.clinician) : '') : '<a href="#visit" data-route="visit">Add a date</a>'}</div></div>
      </div>
      <div class="card" style="margin-top:14px">
        <div class="row"><h2 class="card-title">Last 30 days</h2><span class="pill">${plural(logged.size, 'day')} logged</span></div>
        <div class="strip" role="img" aria-label="Symptom intensity over the last 30 days">${strip}</div>
        <div class="row small muted"><span>${fmt(addDays(today(), -29))}</span><span>Today</span></div>
        <div class="legend"><span><i style="background:var(--sev-1)"></i>Mild</span><span><i style="background:var(--sev-3)"></i>Moderate</span><span><i style="background:var(--sev-5)"></i>Strong</span><span><i style="background:var(--rose);border-radius:50%"></i>Period started</span></div>
      </div>
      <div class="grid two" style="margin-top:14px">
        <div class="card"><h2 class="card-title">Most frequent symptoms</h2><p class="card-sub">Last 30 days · days noticed and average intensity</p>
          ${top.length ? top.map(t => `<div class="bar-row"><span>${esc(t.name)}</span><span class="bar"><i style="width:${Math.round(t.days.size / maxDays * 100)}%"></i></span><span class="val">${plural(t.days.size, 'day')}${t.sevN ? ' · ' + (t.sevSum / t.sevN).toFixed(1) + '/10' : ''}</span></div>`).join('') : `<div class="empty"><strong>No symptoms yet</strong>Tell Mira things like “hot flashes last night, a 6”.</div>`}
        </div>
        <div class="card"><h2 class="card-title">Recent</h2><p class="card-sub">The latest things you told Mira</p>${recentList()}</div>
      </div>
      ${lastCheck ? `<p class="note">Last check-in: “${esc(lastCheck.feeling)}” · ${fmtLong(lastCheck.date)}</p>` : ''}
      <p class="note">Mira organizes your own notes. It doesn't diagnose or replace care from a clinician.</p>
    </div>`;
  }
  function recentList() {
    const items = [
      ...user.symptoms.map(s => ({ date: s.date, title: s.name, meta: [s.severity ? s.severity + '/10' : '', s.impact].filter(Boolean).join(' · '), icon: '🌡️' })),
      ...user.cycleStarts.map(c => ({ date: c.date, title: 'Period started', meta: '', icon: '🩸' })),
      ...user.checkins.map(c => ({ date: c.date, title: c.feeling, meta: 'Check-in', icon: '💭' })),
      ...user.preNotes.map(n => ({ date: n.date, title: n.text, meta: 'For your next visit', icon: '📝' }))
    ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    if (!items.length) return `<div class="empty"><strong>Nothing yet</strong>Your entries will show up here.</div>`;
    return items.map(i => `<div class="list-item"><span aria-hidden="true">${i.icon}</span><div class="li-main"><div class="li-title">${esc(i.title)}</div><div class="li-meta">${fmtLong(i.date)}${i.meta ? ' · ' + esc(i.meta) : ''}</div></div></div>`).join('');
  }

  function renderCycle() {
    const [y, m] = ui.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1), startDow = first.getDay();
    const gridStart = new Date(y, m - 1, 1 - startDow);
    const starts = new Set(user.cycleStarts.map(c => c.date));
    const symByDay = {}; user.symptoms.forEach(s => { (symByDay[s.date] = symByDay[s.date] || []).push(s); });
    const dows = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div class="dow">${d}</div>`).join('');
    const days = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); const s = iso(d);
      const n = (symByDay[s] || []).length;
      const cls = ['day', d.getMonth() !== m - 1 ? 'out' : '', s === today() ? 'today' : '', s === ui.selDay ? 'sel' : '', starts.has(s) ? 'period' : ''].filter(Boolean).join(' ');
      return `<button class="${cls}" data-day="${s}" aria-label="${esc(fmtLong(s))}${starts.has(s) ? ', period started' : ''}${n ? ', ' + plural(n, 'symptom') : ''}">${d.getDate()}${n ? `<span class="dots">${'<i></i>'.repeat(Math.min(3, n))}</span>` : ''}</button>`;
    }).join('');
    const sel = ui.selDay, selSyms = symByDay[sel] || [], selStart = user.cycleStarts.find(c => c.date === sel);
    const selCheck = user.checkins.filter(c => c.date === sel);
    const gaps = sortedStarts();
    return `<div class="page">
      <div class="page-head"><div class="eyebrow">Your cycle</div><h1 class="title">Cycle & symptoms</h1><p class="sub">Tap a day to see or add what happened. Anything you tell Mira in chat shows up here too.</p></div>
      <div class="card">
        <div class="cal-head"><button class="icon-btn" data-action="month" data-dir="-1" aria-label="Previous month">‹</button><div class="cal-title">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div><button class="icon-btn" data-action="month" data-dir="1" aria-label="Next month">›</button></div>
        <div class="cal">${dows}${days}</div>
        <div class="legend"><span><i style="background:var(--rose)"></i>Period started</span><span><i style="background:var(--brand);border-radius:50%"></i>Symptoms logged</span></div>
      </div>
      <div class="card">
        <div class="row"><h2 class="card-title">${esc(fmtLong(sel))}</h2>${sel <= today() ? (selStart ? `<span class="pill rose">Period started</span>` : `<button class="btn small ghost" data-action="period-on" data-date="${sel}">🩸 Period started this day</button>`) : ''}</div>
        ${selCheck.map(c => `<p class="li-meta">💭 “${esc(c.feeling)}”</p>`).join('')}
        ${selSyms.length ? selSyms.map(symItem).join('') : `<p class="card-sub" style="margin-top:8px">No symptoms logged for this day.</p>`}
        ${sel <= today() ? (ui.showSymForm ? symptomForm(sel) : `<button class="btn ghost" data-action="sym-form" style="margin-top:8px">+ Add a symptom</button>`) : ''}
      </div>
      <div class="card">
        <h2 class="card-title">Period history</h2><p class="card-sub">Days between period starts are counted for you.</p>
        ${gaps.length ? [...gaps].reverse().map((c, i, arr) => { const prev = arr[i + 1]; return `<div class="list-item"><span aria-hidden="true">🩸</span><div class="li-main"><div class="li-title">${esc(fmtLong(c.date))}</div><div class="li-meta">${prev ? diffDays(prev.date, c.date) + ' days after the previous start' : 'First one logged'}</div></div><button class="icon-btn" data-action="del" data-kind="period_start" data-id="${esc(c.id)}" aria-label="Remove">×</button></div>`; }).join('') : `<div class="empty"><strong>No period dates yet</strong>Tap a day above, or tell Mira “my period started today”.</div>`}
      </div>
    </div>`;
  }
  function symItem(s) {
    return `<div class="list-item"><span class="sev-badge ${sevClass(s.severity)}">${s.severity ? s.severity + '/10' : '—'}</span><div class="li-main"><div class="li-title">${esc(s.name)}</div>${s.impact ? `<div class="li-meta">${esc(s.impact)}</div>` : ''}${s.notes ? `<div class="li-note">${esc(s.notes)}</div>` : ''}</div><button class="icon-btn" data-action="del" data-kind="symptom" data-id="${esc(s.id)}" aria-label="Delete ${esc(s.name)}">×</button></div>`;
  }
  function symptomForm(date) {
    return `<form data-form="symptom" class="form-grid" style="margin-top:12px">
      <input type="hidden" name="date" value="${date}">
      <div class="field full"><label for="symName">What did you notice?</label><input class="input" id="symName" name="name" required maxlength="80" placeholder="e.g. hot flashes, brain fog, joint pain"></div>
      <div class="field full"><label for="symSev">Intensity <output id="sevOut">5</output>/10</label><input id="symSev" name="severity" type="range" min="1" max="10" value="5"><div class="sev-row"><span>Mild</span><span>Strong</span></div></div>
      <div class="field full"><label for="symImpact">How it affected your day (optional)</label><input class="input" id="symImpact" name="impact" maxlength="200" placeholder="e.g. woke up twice"></div>
      <div class="row full"><button type="button" class="btn ghost" data-action="sym-cancel">Cancel</button><button class="btn primary" type="submit">Save symptom</button></div>
    </form>`;
  }

  function renderVisit() {
    const tabs = [['before', 'Before'], ['agenda', 'Agenda'], ['after', 'After']];
    const body = ui.visitTab === 'before' ? visitBefore() : ui.visitTab === 'agenda' ? visitAgenda() : visitAfter();
    return `<div class="page">
      <div class="page-head"><div class="eyebrow">Appointments</div><h1 class="title">Your visits</h1><p class="sub">Collect what you want to raise, let Mira turn it into an agenda, and keep track of next steps.</p></div>
      <div class="seg no-print" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${ui.visitTab === k}" class="${ui.visitTab === k ? 'on' : ''}" data-visit="${k}">${l}</button>`).join('')}</div>
      ${body}
    </div>`;
  }
  function visitBefore() {
    const p = user.profile;
    const notes = [...user.preNotes].sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="card">
        <h2 class="card-title">Next appointment</h2><p class="card-sub">Optional. Mira uses this to remind you what to bring up.</p>
        <div class="form-grid"><div class="field"><label for="apptDate">Date</label><input class="input" id="apptDate" type="date" data-profile="appointment_date" value="${esc(p.appointmentDate)}"></div>
        <div class="field"><label for="clinician">Clinician or clinic</label><input class="input" id="clinician" data-profile="clinician" value="${esc(p.clinician)}" placeholder="e.g. Dr. Patel"></div></div>
      </div>
      <div class="card">
        <h2 class="card-title">Things to bring up</h2><p class="card-sub">Questions, worries, or changes you've noticed. You can also just tell Mira in chat.</p>
        <form data-form="pre-note" class="stack"><textarea class="textarea" name="text" required placeholder="e.g. My sleep has been much worse since August"></textarea><div class="row"><span class="small muted">${plural(notes.length, 'note')}</span><button class="btn primary" type="submit">Add note</button></div></form>
        <div style="margin-top:8px">${notes.map(n => `<div class="list-item"><span aria-hidden="true">📝</span><div class="li-main"><div class="li-note" style="margin-top:0">${esc(n.text)}</div><div class="li-meta">${fmtLong(n.date)}</div></div><button class="icon-btn" data-action="del" data-kind="visit_note" data-id="${esc(n.id)}" aria-label="Delete note">×</button></div>`).join('')}</div>
      </div>
      <button class="btn primary sparkle" style="width:100%;margin-top:14px" data-action="draft" data-mode="prep" ${ui.drafting ? 'disabled' : ''}>${ui.drafting ? 'Mira is writing…' : '✨ Turn my notes into an agenda'}</button>`;
  }
  function listEditor(field, key, items, placeholder) {
    return `<div>${items.map((t, i) => `<div class="ag-item"><span class="ag-num">${i + 1}</span><textarea class="ag-text" rows="1" data-edit="${field}.${key}" data-index="${i}" aria-label="${esc(placeholder)} ${i + 1}">${esc(t)}</textarea><span class="ag-tools no-print"><button class="icon-btn" data-action="move" data-field="${field}" data-key="${key}" data-index="${i}" data-dir="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="icon-btn" data-action="remove" data-field="${field}" data-key="${key}" data-index="${i}" aria-label="Remove">×</button></span></div>`).join('')}
      <button class="btn small ghost no-print" style="margin-top:10px" data-action="add-item" data-field="${field}" data-key="${key}">+ Add</button></div>`;
  }
  function visitAgenda() {
    const a = user.agenda, empty = !a.summary && !a.topics.length && !a.questions.length;
    const when = user.profile.appointmentDate ? `For ${fmtLong(user.profile.appointmentDate)}${user.profile.clinician ? ' with ' + esc(user.profile.clinician) : ''}` : 'Add your appointment date under Before';
    return `<div class="card">
      <div class="row"><div><h2 class="card-title">Visit agenda</h2><p class="card-sub" style="margin:0">${when}</p></div>
      <button class="btn small sparkle no-print" data-action="draft" data-mode="prep" ${ui.drafting ? 'disabled' : ''}>${ui.drafting ? 'Writing…' : empty ? '✨ Draft' : '✨ Redraft'}</button></div>
      ${empty ? `<div class="empty" style="margin-top:14px"><strong>No agenda yet</strong>Mira can draft one from your symptoms, cycle and notes. You can edit every line.</div>` : `
      <div class="section-kicker">Opening summary</div><textarea class="textarea" data-edit="agenda.summary" aria-label="Opening summary">${esc(a.summary)}</textarea>
      <div class="section-kicker">Topics</div>${listEditor('agenda', 'topics', a.topics, 'Topic')}
      <div class="section-kicker">Questions to ask</div>${listEditor('agenda', 'questions', a.questions, 'Question')}
      <div class="row-wrap no-print" style="margin-top:18px"><button class="btn ghost" data-action="share-agenda">Share</button><button class="btn ghost" data-action="copy-agenda">Copy</button><button class="btn ghost" data-action="print">Print</button></div>`}
    </div><p class="note">Drafts use only what you've logged. Check medical questions with your clinician.</p>`;
  }
  function visitAfter() {
    const f = user.followup, notes = [...user.postNotes].sort((a, b) => b.date.localeCompare(a.date));
    const empty = !f.summary && !f.steps.length && !f.questions.length;
    return `<div class="card">
        <h2 class="card-title">After your appointment</h2><p class="card-sub">Write down what you remember while it's fresh: what was said, what to do next.</p>
        <form data-form="post-note" class="stack"><textarea class="textarea" name="text" required placeholder="e.g. Doctor suggested tracking sleep for 4 weeks and coming back in December"></textarea><div class="row"><span class="small muted">${plural(notes.length, 'note')}</span><button class="btn primary" type="submit">Save note</button></div></form>
        <div style="margin-top:8px">${notes.map(n => `<div class="list-item"><span aria-hidden="true">🗒️</span><div class="li-main"><div class="li-note" style="margin-top:0">${esc(n.text)}</div><div class="li-meta">${fmtLong(n.date)}</div></div><button class="icon-btn" data-action="del" data-kind="after_note" data-id="${esc(n.id)}" aria-label="Delete note">×</button></div>`).join('')}</div>
      </div>
      <div class="card">
        <div class="row"><h2 class="card-title">Follow-up list</h2><button class="btn small sparkle no-print" data-action="draft" data-mode="after" ${ui.drafting || !notes.length ? 'disabled' : ''}>${ui.drafting ? 'Writing…' : '✨ Draft from notes'}</button></div>
        ${empty ? `<div class="empty" style="margin-top:12px"><strong>No follow-up list yet</strong>${notes.length ? 'Tap Draft to turn your notes into next steps.' : 'Save a note above first.'}</div>` : `
        <div class="section-kicker">Summary</div><textarea class="textarea" data-edit="followup.summary" aria-label="Summary">${esc(f.summary)}</textarea>
        <div class="section-kicker">Next steps</div>${listEditor('followup', 'steps', f.steps, 'Step')}
        <div class="section-kicker">Questions for next time</div>${listEditor('followup', 'questions', f.questions, 'Question')}`}
      </div>`;
  }

  function renderMe() {
    const p = user.profile, link = `${location.origin}/?device=${deviceId}`;
    const counts = [[user.symptoms.length, 'symptom'], [user.cycleStarts.length, 'period start'], [user.checkins.length, 'check-in'], [user.preNotes.length + user.postNotes.length, 'visit note']];
    return `<div class="page">
      <div class="page-head"><div class="eyebrow">Settings</div><h1 class="title">${p.name ? esc(p.name) : 'You'}</h1><p class="sub">${counts.map(([n, w]) => plural(n, w)).join(' · ')}</p></div>
      <div class="card"><h2 class="card-title">Your name</h2><p class="card-sub">What Mira calls you.</p><input class="input" data-profile="name" value="${esc(p.name)}" placeholder="Your first name" maxlength="60"></div>
      ${isStandalone() ? '' : `<div class="card"><h2 class="card-title">📲 Add Mira to your Home Screen</h2><p class="card-sub" style="margin:0">On iPhone: open this site in <b>Safari</b>, tap <b>Share</b> (the square with an arrow), then <b>Add to Home Screen</b>. Mira then opens straight into the chat, like an app.</p></div>`}
      <div class="card"><h2 class="card-title">🔔 Daily reminder</h2>${reminderCard()}</div>
      <div class="card"><h2 class="card-title">Use Mira on another device</h2><p class="card-sub">Open this private link on your other phone or computer to see the same chat and data. Don't share it with anyone else.</p>
        <div class="row-wrap"><button class="btn ghost" data-action="copy-link" data-link="${esc(link)}">Copy my link</button></div></div>
      <div class="card"><h2 class="card-title">Your data</h2><p class="card-sub">Download a copy of everything, or erase it all.</p>
        <div class="row-wrap"><button class="btn ghost" data-action="export">Download my data</button>
        <button class="btn danger" data-action="reset">${ui.confirmReset ? 'Tap again to erase everything' : 'Erase everything'}</button></div></div>
      <p class="note">Mira Care is a student project. It organizes your own notes and doesn't give medical advice. <a href="/privacy.html">Privacy & data deletion</a></p>
    </div>`;
  }

  function reminderCard() {
    const r = user.reminder || { enabled: false, hour: 20 };
    if (!pushSupported() || (isIOS() && !isStandalone())) {
      return `<p class="card-sub" style="margin:0">${isIOS() ? 'iPhone only allows reminders for apps on your Home Screen. Add Mira to your Home Screen (above), open it from there, and turn this on.' : "This browser can't show notifications. Try Chrome, Edge or Safari, or add Mira to your Home Screen."}</p>`;
    }
    if (Notification.permission === 'denied') {
      return `<p class="card-sub" style="margin:0">Notifications are blocked for Mira. Turn them on in your phone's Settings → Notifications → Mira (or in your browser's site settings), then come back here.</p>`;
    }
    const hours = Array.from({ length: 18 }, (_, i) => i + 6).map(h => `<option value="${h}" ${h === r.hour ? 'selected' : ''}>${hourLabel(h)}</option>`).join('');
    return `<p class="card-sub">A gentle nudge once a day to check in with Mira. It's skipped on days you've already logged something.</p>
      <div class="form-grid"><div class="field"><label for="remHour">Remind me around</label><select class="select" id="remHour" data-reminder-hour>${hours}</select></div></div>
      <div class="row-wrap" style="margin-top:12px">${r.enabled
        ? `<span class="pill">On · around ${hourLabel(r.hour)}</span><button class="btn small ghost" data-action="test-push">Send a test</button><button class="btn small ghost" data-action="reminder-off">Turn off</button>`
        : `<button class="btn primary" data-action="reminder-on" ${ui.reminderBusy ? 'disabled' : ''}>${ui.reminderBusy ? 'Turning on…' : 'Turn on daily reminder'}</button>`}</div>`;
  }
  async function enableReminders() {
    // Ask for permission first, straight from the tap (iPhone requires that).
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications were not allowed. You can allow them in Settings → Notifications → Mira.');
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api('push-key', {}, { keepUser: true });
    let sub = await reg.pushManager.getSubscription();
    if (sub) { try { await sub.unsubscribe(); } catch {} }
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    const hour = Number($('#remHour')?.value || user.reminder?.hour || 20);
    await api('reminder', { enabled: true, hour, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, subscription: sub.toJSON() });
  }

  // ---------- Agenda editing ----------
  const patchSoon = debounce(async field => { try { await api('patch', { [field]: user[field] }, { keepUser: true }); saveCache(); } catch (e) { toast(e.message); } }, 600);
  function agendaText() {
    const a = user.agenda;
    return [a.summary, a.topics.length ? '\nTopics:\n' + a.topics.map((t, i) => `${i + 1}. ${t}`).join('\n') : '', a.questions.length ? '\nQuestions:\n' + a.questions.map((t, i) => `${i + 1}. ${t}`).join('\n') : ''].filter(Boolean).join('\n');
  }
  async function copy(text, done) {
    try { await navigator.clipboard.writeText(text); toast(done); }
    catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); toast(done); }
  }

  // ---------- Events ----------
  async function guarded(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message); } render(); }

  document.addEventListener('click', async e => {
    const r = e.target.closest('[data-route]');
    if (r) { e.preventDefault(); go(r.dataset.route); return; }
    const chip = e.target.closest('[data-chip]');
    if (chip) { sendMessage(chip.dataset.chip); return; }
    const day = e.target.closest('[data-day]');
    if (day) { ui.selDay = day.dataset.day; ui.showSymForm = false; render(); return; }
    const vt = e.target.closest('[data-visit]');
    if (vt) { ui.visitTab = vt.dataset.visit; render(); return; }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act !== 'reset') ui.confirmReset = false;
    if (act === 'retry') { const t = ui.failed; ui.failed = ''; sendMessage(t); }
    else if (act === 'dismiss-tip') { store.set(TIP_KEY, '1'); render(); }
    else if (act === 'month') { const [y, m] = ui.month.split('-').map(Number); const d = new Date(y, m - 1 + Number(a.dataset.dir), 1); ui.month = iso(d).slice(0, 7); render(); }
    else if (act === 'period-on') guarded(() => tool('log_period_start', { date: a.dataset.date }), 'Period start saved');
    else if (act === 'sym-form') { ui.showSymForm = true; render(); $('#symName')?.focus(); }
    else if (act === 'sym-cancel') { ui.showSymForm = false; render(); }
    else if (act === 'del') guarded(() => tool('delete_entry', { kind: a.dataset.kind, id: a.dataset.id }), 'Removed');
    else if (act === 'draft') {
      ui.drafting = true; render();
      try { await api('draft', { mode: a.dataset.mode }); if (a.dataset.mode === 'prep') ui.visitTab = 'agenda'; toast('Draft ready. Edit anything you like.'); }
      catch (err) { toast(err.message); }
      ui.drafting = false; render();
    }
    else if (act === 'add-item' || act === 'remove' || act === 'move') {
      const list = user[a.dataset.field][a.dataset.key], i = Number(a.dataset.index);
      if (act === 'add-item') list.push('');
      if (act === 'remove') list.splice(i, 1);
      if (act === 'move' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      saveCache(); patchSoon(a.dataset.field); render();
      if (act === 'add-item') document.querySelectorAll(`[data-edit="${a.dataset.field}.${a.dataset.key}"]`).forEach((el, idx, all) => { if (idx === all.length - 1) el.focus(); });
    }
    else if (act === 'copy-agenda') copy(agendaText(), 'Agenda copied');
    else if (act === 'share-agenda') { if (navigator.share) navigator.share({ title: 'My visit agenda', text: agendaText() }).catch(() => {}); else copy(agendaText(), 'Agenda copied'); }
    else if (act === 'print') window.print();
    else if (act === 'copy-link') copy(a.dataset.link, 'Private link copied');
    else if (act === 'reminder-on') {
      ui.reminderBusy = true; render();
      try { await enableReminders(); toast(`Reminder on: around ${hourLabel(user.reminder.hour)} each day`); } catch (err) { toast(err.message); }
      ui.reminderBusy = false; render();
    }
    else if (act === 'reminder-off') guarded(() => api('reminder', { enabled: false }), 'Daily reminder turned off');
    else if (act === 'test-push') guarded(async () => { const d = await api('test-push'); if (!d.sent) throw new Error('No device to send to. Turn the reminder off and on again.'); }, 'Test sent. It should arrive in a few seconds.');
    else if (act === 'export') {
      const blob = new Blob([JSON.stringify(user, null, 2)], { type: 'application/json' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `mira-care-${today()}.json`; link.click(); URL.revokeObjectURL(link.href);
    }
    else if (act === 'reset') {
      if (!ui.confirmReset) { ui.confirmReset = true; render(); return; }
      ui.confirmReset = false; guarded(() => api('reset'), 'Everything erased');
    }
  });

  document.addEventListener('submit', e => {
    const form = e.target;
    if (form.id === 'composer') { e.preventDefault(); const box = $('#msgInput'); const t = box.value; box.value = ''; autoGrow(box); $('#sendBtn').disabled = true; sendMessage(t); return; }
    const kind = form.dataset.form; if (!kind) return;
    e.preventDefault();
    const d = new FormData(form);
    if (kind === 'symptom') { ui.showSymForm = false; guarded(() => tool('log_symptoms', { date: d.get('date'), symptoms: [{ name: d.get('name'), severity: Number(d.get('severity')), impact: d.get('impact') }] }), 'Symptom saved'); }
    if (kind === 'pre-note') guarded(() => tool('add_visit_note', { text: d.get('text') }), 'Note added');
    if (kind === 'post-note') guarded(() => tool('add_after_visit_note', { text: d.get('text') }), 'Note saved');
  });

  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'msgInput') { autoGrow(el); $('#sendBtn').disabled = !el.value.trim(); }
    if (el.id === 'symSev') $('#sevOut').textContent = el.value;
    if (el.dataset.edit) {
      const [field, key] = el.dataset.edit.split('.');
      if (el.dataset.index !== undefined) user[field][key][Number(el.dataset.index)] = el.value; else user[field][key] = el.value;
      if (el.classList.contains('ag-text')) autoGrow(el);
      saveCache(); patchSoon(field);
    }
  });
  document.addEventListener('keydown', e => {
    if (e.target.id === 'msgInput' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover)').matches) { e.preventDefault(); $('#composer').requestSubmit(); }
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.profile) guarded(() => tool('save_profile', { [el.dataset.profile]: el.value }), 'Saved');
    if (el.matches('[data-reminder-hour]') && user.reminder && user.reminder.enabled) guarded(() => api('reminder', { hour: Number(el.value), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }), `Reminder moved to around ${hourLabel(Number(el.value))}`);
  });

  // ---------- Start ----------
  render();
  (async () => {
    try {
      await api('load');
      // Bring over entries saved by the old browser-only version of the site.
      const old = store.get(OLD_KEY);
      if (old && !hasData(user)) {
        try { const data = await api('import', { state: JSON.parse(old) }); if (data.imported) { store.set(OLD_KEY + '-imported', old); store.del(OLD_KEY); toast('Your earlier notes were moved into Mira'); } } catch {}
      }
      // On the chat screen only refresh the messages, so a half-typed message isn't wiped.
      if (route === 'chat') refreshThread(); else render();
    } catch (e) { toast('Offline: showing your last saved data'); }
  })();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
})();
