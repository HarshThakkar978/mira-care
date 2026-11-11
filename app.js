(() => {
  // ---------- Storage & identity ----------
  const ID_KEY = 'mira-device-id', CACHE_KEY = 'mira-cache-v3', OLD_KEY = 'mira-care-local-v2', TIP_KEY = 'mira-install-tip', OB_KEY = 'mira-onboarded', THEME_KEY = 'mira-theme', ACCT_KEY = 'mira-account-prompt', TIPS_KEY = 'mira-tips-seen', INSTALL_KEY = 'mira-install-asked';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} }
  };
  // Cura's home is curadaily.com (before: mira-care.vercel.app, then curadaily.vercel.app). The old addresses send
  // people on with their device code (so their data comes too), their theme and whether they've seen the tour.
  // A Home Screen app can't move itself (leaving its address would open a browser inside it), so it keeps working
  // where it is and shows a one-time note on how to re-add Cura from the new address.
  const OLD_HOSTS = ['mira-care.vercel.app', 'curadaily.vercel.app'], NEW_HOST = 'curadaily.com';
  const onOldHost = OLD_HOSTS.includes(location.hostname);
  const moveLink = () => {
    const q = new URLSearchParams(location.search); // keeps a "?device=" link someone opened (Use on another device)
    q.set('moved', '1');
    const carry = { device: ID_KEY, theme: THEME_KEY, ob: OB_KEY, acct: ACCT_KEY }; // not the install tip: they need to re-add Cura to the Home Screen
    for (const [param, key] of Object.entries(carry)) { const v = store.get(key); if (v && !q.get(param)) q.set(param, v); }
    return `https://${NEW_HOST}${location.pathname}?${q}${location.hash}`;
  };
  if (onOldHost && !(matchMedia('(display-mode: standalone)').matches || navigator.standalone === true)) { location.replace(moveLink()); return; }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  // First open of a Home Screen app added from Safari: trade the one-time code in the address for this person's
  // device code (see the "handoff" actions in api/app.js), so they don't start over as a stranger.
  const handoff = new URLSearchParams(location.search).get('h');
  if (handoff && standalone && !store.get(ID_KEY)) {
    fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'handoff-' + Date.now().toString(36) + 'xxxxxxxx', action: 'handoff-claim', token: handoff }) })
      .then(r => r.json()).then(d => location.replace(d.device ? `/?device=${encodeURIComponent(d.device)}&from=home#chat` : '/#chat'))
      .catch(() => location.replace('/#chat'));
    return;
  }
  const arrived = new URLSearchParams(location.search);
  if (arrived.get('moved')) {
    for (const [param, key] of [['theme', THEME_KEY], ['ob', OB_KEY], ['acct', ACCT_KEY]]) if (arrived.get(param)) store.set(key, arrived.get(param));
    if (!arrived.get('device')) history.replaceState(null, '', location.pathname + location.hash);
  }
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  const ID_RE = /^[A-Za-z0-9-]{16,64}$/;

  // "?device=<id>" opens the same Cura on another phone or computer.
  const linked = new URLSearchParams(location.search).get('device');
  if (linked && ID_RE.test(linked)) { store.set(ID_KEY, linked); store.del(CACHE_KEY); history.replaceState(null, '', location.pathname + location.hash); }
  let deviceId = store.get(ID_KEY);
  if (!deviceId || !ID_RE.test(deviceId)) { deviceId = newId(); store.set(ID_KEY, deviceId); }
  // Opened from the Home Screen icon for the first time: they already did the welcome in Safari (see api/manifest.js).
  if (arrived.get('from') === 'home' && linked) {
    store.set(OB_KEY, '1');
    if (['light', 'dark', 'system'].includes(arrived.get('theme'))) store.set(THEME_KEY, arrived.get('theme'));
  }
  // In a browser tab, get ready for "Add to Home Screen": iPhone opens the new app at the page's address, so it
  // carries a one-time code (h=…) that only a Home Screen app can trade for this person. Also point the install
  // details at them, for phones that read those instead.
  if (!standalone) {
    const mf = document.querySelector('link[rel="manifest"]');
    if (mf) mf.href = `/api/manifest?d=${encodeURIComponent(deviceId)}&t=${encodeURIComponent(store.get(THEME_KEY) || '')}`;
    fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: deviceId, action: 'handoff-create' }) })
      .then(r => r.json()).then(d => { if (d.token && !location.search.includes('device=')) history.replaceState(null, '', `/?h=${d.token}${location.hash}`); })
      .catch(() => {});
  }

  const emptyUser = () => ({ profile: { name: '', appointmentDate: '', clinician: '' }, cycleStarts: [], symptoms: [], checkins: [], preNotes: [], postNotes: [], agenda: { summary: '', topics: [], questions: [] }, followup: { summary: '', steps: [], questions: [] }, reminder: { enabled: false, hour: 20, devices: 0 }, community: { joined: false, anonymous: false, alias: '', focus: [], groupId: '', reason: '', notice: null, hidden: [] }, plan: [], transcript: [] });
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
  const avgText = (sum, n) => `${Number((sum / n).toFixed(1))}/10`;
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

  const msgKey = m => `${m.at}|${m.from}|${m.text.length}`;
  // The server sends only the latest chat messages; anything that scrolls out of that window
  // stays in ui.older so "Load earlier" pages never leave a gap.
  function setUser(next) {
    const prev = user.transcript || [];
    user = { ...emptyUser(), ...next };
    const keep = new Set(user.transcript.map(msgKey));
    ui.older = dedupe([...ui.older, ...prev.filter(m => !keep.has(msgKey(m)))]);
    saveCache();
  }
  const dedupe = list => { const seen = new Set(); return list.filter(m => { const k = msgKey(m); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const allMsgs = () => dedupe([...ui.older, ...(user.transcript || [])]);

  async function api(action, payload = {}, { keepUser = false } = {}) {
    const res = await fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: deviceId, action, ...payload }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not reach Cura. Check your connection.');
    if (data.user && !keepUser) setUser(data.user);
    return data;
  }
  const tool = (name, input) => api('tool', { name, input });

  // ---------- Routing ----------
  const ROUTES = ['chat', 'today', 'community', 'cycle', 'visit', 'me', 'report'];
  let route = ROUTES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'chat';
  const ui = { multi: [], sending: false, pending: '', live: '', failed: '', older: [], loadingOlder: false, seen: null, loaded: false, month: today().slice(0, 7), selDay: today(), visitTab: 'before', drafting: false, confirmReset: false, showSymForm: false, sheet: null, log: null, ob: 0, insightLoading: false, insightTried: false, cm: freshCm(), unread: 0, calUrl: '', calLoading: false, calTried: false, pushHere: 'unknown', pushEndpoint: '', googleId: '', signingIn: false, confirmSignOut: false };
  function freshCm() { return { tab: 'group', group: null, messages: [], reactions: {}, reactFor: '', loaded: false, fetching: false, posting: '', ideas: null, ideasLoading: false, join: null, focusEdit: null, confirmLeave: false }; }
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Screen changes cross-fade where the browser supports View Transitions.
  function go(to) {
    if (to === route) { $('#view').scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' }); return; }
    const swap = () => { route = to; if (location.hash.slice(1) !== to) history.replaceState(null, '', '#' + to); render(); };
    if (document.startViewTransition && !reduceMotion()) document.startViewTransition(swap); else swap();
  }
  // Redraw without jumping back to the top (for toggles further down a page).
  function renderInPlace() { const v = $('#view'), top = v.scrollTop; render(); v.scrollTop = top; }
  window.addEventListener('hashchange', () => { const r = location.hash.slice(1); if (ROUTES.includes(r) && r !== route) { route = r; render(); } });

  function render() {
    const tab = { cycle: 'today', visit: 'today', report: 'today' }[route] || route;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.route === tab));
    const view = $('#view');
    if (rec) stopVoice(true);
    view.innerHTML = { chat: renderChat, today: renderToday, community: renderCommunity, cycle: renderCycle, visit: renderVisit, me: renderMe, report: renderReport }[route]();
    if (route === 'chat') { afterChatRender(); } else view.scrollTop = 0;
    if (route === 'community') scrollThread();
    document.querySelectorAll('textarea.ag-text, textarea[data-edit]').forEach(autoGrow);
    if (route === 'today') maybeLoadInsight();
    renderSheet();
    syncPoll(); updateBadge(); renderGoogleButtons();
    if (coach && coach.screen !== route) { coach = null; drawCoach(); }
    maybeTips();
    if (route === 'community' && joined()) {
      if (!ui.cm.loaded) loadGroup(true);
      if (ui.cm.tab === 'ideas' && ui.cm.ideas === null) loadIdeas();
    }
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
  // Cura's first message, built from what they picked in the welcome tour.
  function welcomeText() {
    const name = user.profile.name ? ` ${user.profile.name}` : '';
    const picks = (user.community && user.community.focus || []).map(x => x.toLowerCase()).slice(0, 3);
    const list = picks.length <= 1 ? picks.join('') : `${picks.slice(0, -1).join(', ')} and ${picks[picks.length - 1]}`;
    return picks.length
      ? `Hi${name}, I'm Cura 💜 ${list[0].toUpperCase() + list.slice(1)} can be so draining. Tell me how things have been, and I'll suggest what might help.`
      : `Hi${name}, I'm Cura 💜 Tell me how you feel, a symptom, or when your period starts. I'll keep track, suggest what might help, and get you ready for your doctor.`;
  }
  const checkedInToday = () => user.checkins.some(c => c.date === today()) || user.symptoms.some(s => s.date === today());
  // Once a day, until they check in, Cura's question and the five faces sit at the end of the chat.
  function dailyAsk(msgs) {
    if (ui.pending || ui.failed || checkedInToday()) return '';
    const last = msgs[msgs.length - 1];
    if (last && (last.ui || last.from === 'you' || new Date(last.at).toDateString() === new Date().toDateString())) return '';
    const h = new Date().getHours(), name = user.profile.name ? `, ${user.profile.name}` : '';
    const hello = msgs.length ? `${h < 12 ? 'Morning' : h < 18 ? 'Hi' : 'Evening'}${name} ${h < 18 ? '☀️' : '🌙'} How are you feeling today?` : '';
    return `${hello ? `<div class="msg them tail">${fmtMsg(hello)}</div>` : ''}<div class="mood-row" role="group" aria-label="How are you feeling today?">${MOODS.map(m => `<button class="mood-btn" data-chip="Feeling ${m.toLowerCase()} today">${moodFace(m, 30)}<span>${m}</span></button>`).join('')}</div>`;
  }

  function threadHtml() {
    const msgs = allMsgs();
    const total = Math.max(user.transcriptTotal || 0, msgs.length);
    // Only messages that arrived since the last render get the entrance animation.
    const fresh = ui.seen === null ? msgs.length : ui.seen;
    let html = total > msgs.length ? `<button class="load-older no-print" data-action="older" ${ui.loadingOlder ? 'disabled' : ''}>${ui.loadingOlder ? 'Loading…' : 'Load earlier messages'}</button>` : '';
    // Cura's hello stays at the top of the chat (it isn't saved on the server, so it would vanish after the first message).
    if (!msgs.length || (total === msgs.length && msgs[0].from === 'you')) html += `<div class="stamp"><b>Cura</b></div><div class="msg them tail">${fmtMsg(welcomeText())}</div>`;
    msgs.forEach((m, i) => {
      const prev = msgs[i - 1], next = msgs[i + 1];
      if (!prev || new Date(m.at) - new Date(prev.at) > 3600000) html += `<div class="stamp">${stampText(m.at)}</div>`;
      const tail = !next || next.from !== m.from || new Date(next.at) - new Date(m.at) > 3600000;
      html += `<div class="msg ${m.from === 'you' ? 'me' : 'them'}${tail ? ' tail' : ''}${i >= fresh ? ' pop' : ''}">${fmtMsg(m.text)}</div>`;
      const why = m.why && m.why.text ? `<span class="msg-why">${INFO_SVG}<span>Why I ask: ${esc(m.why.text)}${m.why.url ? ` <a href="${esc(m.why.url)}" target="_blank" rel="noopener">${esc(m.why.site)} ↗</a>` : ''}</span></span>` : '';
      if (m.saved || m.source || why) html += `<div class="msg-meta${i >= fresh ? ' pop' : ''}">${why}${m.saved && m.saved.length ? `<span class="msg-saved">${CHECK_SVG}Saved: ${esc(m.saved.join(', '))}</span>` : ''}${m.source ? `<a class="msg-src" href="${esc(m.source.url)}" target="_blank" rel="noopener">${BOOK_SVG}${esc(m.source.site)} · ${esc(m.source.title)}</a>` : ''}</div>`;
      if (m.idea) html += ideaCardHtml(m.idea, true);
      const ctaDone = (m.cta && m.cta.route === 'community' && joined()) || (m.cta && m.cta.action === 'story-start' && user.story && user.story.startedAt);
      if (m.cta && !ctaDone) html += m.cta.action
        ? `<button class="msg-cta" data-cta-action="${esc(m.cta.action)}">${esc(m.cta.label)} ›</button>`
        : `<button class="msg-cta" data-route="${esc(m.cta.route)}">${esc(m.cta.label)} ›</button>`;
    });
    ui.seen = msgs.length;
    if (ui.pending) html += `<div class="msg me tail pop">${fmtMsg(ui.pending)}</div>` + (ui.live
      ? `<div class="msg them tail live" id="live">${fmtMsg(ui.live)}</div>`
      : `<div class="typing" aria-label="Cura is typing"><i></i><i></i><i></i></div>`);
    else if (ui.failed) html += `<div class="msg me tail failed">${fmtMsg(ui.failed)}</div><div class="msg-status error" data-action="retry">Not delivered · Tap to try again</div>`;
    else if (msgs.length && msgs[msgs.length - 1].from === 'mira') html += quickRepliesHtml(pendingAsk(msgs)) || dailyAsk(msgs);
    else html += dailyAsk(msgs);
    return html;
  }
  // Cura's latest message with answer buttons since they last wrote, so a note she adds after her question
  // (like the Circle invitation) doesn't hide the buttons.
  function pendingAsk(msgs) {
    for (let i = msgs.length - 1; i >= 0 && msgs[i].from === 'mira'; i--) if (msgs[i].ui) return msgs[i];
    return {};
  }
  // Tap-to-answer buttons Cura attached to her latest question (scale, options or pick-several).
  function quickRepliesHtml(m) {
    const q = m.ui;
    if (!q) return '';
    if (q.kind === 'scale') return `<div class="qr qr-scale pop" role="group" aria-label="Pick a number from 1 to 10">
      <div class="qr-nums">${Array.from({ length: 10 }, (_, i) => `<button class="qr-num s${Math.ceil((i + 1) / 2)}" data-qr="${i + 1}/10" aria-label="${i + 1} out of 10">${i + 1}</button>`).join('')}</div>
      <div class="qr-ends"><span>${esc(q.low)}</span><span>${esc(q.high)}</span></div></div>`;
    if (q.kind === 'options') return `<div class="qr pop">${q.options.map(o => `<button class="qr-opt" data-qr="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
    if (q.kind === 'multi') {
      const picked = ui.multi.filter(o => q.options.includes(o));
      return `<div class="qr pop">${q.options.map(o => `<button class="qr-opt ${picked.includes(o) ? 'on' : ''}" data-qr-toggle="${esc(o)}" aria-pressed="${picked.includes(o)}">${picked.includes(o) ? '✓ ' : ''}${esc(o)}</button>`).join('')}
        <button class="qr-done" data-qr-done ${picked.length ? '' : 'disabled'}>Send${picked.length ? ` (${picked.length})` : ''}</button></div>`;
    }
    return '';
  }
  function chipsHtml() {
    const last = allMsgs().slice(-1)[0];
    if (last && last.from === 'mira' && pendingAsk(allMsgs()).ui && !ui.pending) return ''; // Cura's own answer buttons take over
    if (dailyAsk(allMsgs())) return ''; // so do the mood faces
    if (user.story && user.story.startedAt && !user.story.completedAt) return ''; // and Cura's story questions
    const first = !(user.transcript || []).length;
    const list = first
      ? ['Feeling okay today', 'Rough day today', 'My period started today', 'I had hot flashes last night']
      : ['Feeling good today', 'Rough day today', 'My period started today', 'How has my week been?', 'Help me prep for my appointment'];
    return list.map(t => `<button class="chip" data-chip="${esc(t)}">${esc(t)}</button>`).join('');
  }
  function renderChat() {
    const tip = isIOS() && !isStandalone() && !store.get(TIP_KEY)
      ? `<div class="install no-print"><span>📲</span><span><b>Keep Cura on your Home Screen.</b> <button class="linkish" data-action="install-open">Show me how</button></span><button class="icon-btn" data-action="dismiss-tip" aria-label="Dismiss">×</button></div>` : '';
    return `<section class="chat">
      <header class="chat-head"><div class="avatar logo" aria-hidden="true"><img src="/icons/logo-256.png" alt=""></div><div class="ch-main"><div class="chat-name">Cura</div><div class="chat-status">Here for you, day or night</div></div>
        <button class="head-plus no-print" type="button" data-action="quick-log" aria-label="Quick check-in"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></header>
      ${tip}
      <div class="thread" id="thread" aria-live="polite">${threadHtml()}</div>
      <div class="chips no-print" id="chips">${chipsHtml()}</div>
      <form class="composer no-print${voiceMode() ? ' can-voice' : ''}" id="composer">
        <label class="sr-only" for="msgInput">Message Cura</label>
        <textarea id="msgInput" rows="1" placeholder="Message Cura" enterkeyhint="send" autocomplete="off"></textarea>
        ${micBtn('msgInput')}<button class="send send-go" id="sendBtn" type="submit" aria-label="Send" disabled><svg viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg></button>
      </form>
    </section>`;
  }
  function afterChatRender() { scrollThread(); }
  function scrollThread() { const t = $('#thread') || $('#gthread'); if (t) t.scrollTop = t.scrollHeight; }
  function refreshThread() { const t = $('#thread'); if (!t) return; t.innerHTML = threadHtml(); const c = $('#chips'); if (c) c.innerHTML = chipsHtml(); scrollThread(); }
  // Updates only the streaming bubble, so the rest of the thread doesn't flicker.
  function updateLive() {
    const live = $('#live');
    if (live && ui.live) { live.innerHTML = fmtMsg(ui.live); scrollThread(); } else refreshThread();
  }
  async function loadOlder() {
    ui.loadingOlder = true; refreshThread();
    try {
      const t = $('#thread'), before = t ? t.scrollHeight : 0;
      const d = await api('transcript', { loaded: allMsgs().length }, { keepUser: true });
      ui.older = dedupe([...d.messages, ...ui.older]);
      ui.seen = null; ui.loadingOlder = false;
      if (t) { t.innerHTML = threadHtml(); t.scrollTop = t.scrollHeight - before; } // keep your place
    } catch (e) { ui.loadingOlder = false; toast(e.message); refreshThread(); }
  }
  function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, el.classList.contains('ag-text') || el.dataset.edit ? 400 : 140) + 'px'; }

  // Sends a message and shows Cura's reply word by word as it streams in.
  async function sendMessage(text) {
    text = text.trim();
    if (!text || ui.sending) return;
    ui.sending = true; ui.pending = text; ui.live = ''; ui.failed = '';
    refreshThread();
    try {
      const res = await fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: deviceId, action: 'chat', text, stream: true }) });
      if (!res.ok || !res.body) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Could not reach Cura. Check your connection.'); }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '', finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.t === 'delta') { ui.live += ev.text; if (route === 'chat') updateLive(); }
          else if (ev.t === 'round') { ui.live = ''; }
          else if (ev.t === 'done') { ui.pending = ''; ui.live = ''; setUser(ev.user); finished = true; }
          else if (ev.t === 'error') throw new Error(ev.error);
        }
      }
      if (!finished) throw new Error('The connection dropped. Tap to try again.');
    } catch (e) { ui.failed = text; toast(e.message); }
    ui.sending = false; ui.pending = ''; ui.live = '';
    if (route === 'chat') refreshThread();
    setTimeout(showStoryPopup, 1800); // after they've had a moment to read Cura's reply
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
    const ls = lastStart(), since = ls ? diffDays(ls.date, today()) + 1 : null;
    const appt = user.profile.appointmentDate, apptIn = appt ? diffDays(today(), appt) : null;
    const hasAgenda = user.agenda.summary || user.agenda.topics.length;
    // This week: one circle per day, darker for stronger symptoms, rose when a period started, dashed if nothing logged.
    const starts = new Set(user.cycleStarts.map(c => c.date));
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(today(), i - 6);
      const sev = Math.max(0, ...user.symptoms.filter(x => x.date === d).map(x => Number(x.severity) || 3));
      const any = sev || user.checkins.some(c => c.date === d);
      const cls = starts.has(d) ? 'p' : sev ? 's' + Math.min(5, Math.ceil(sev / 2)) : any ? 's1' : 'none';
      const label = `${fmtLong(d)}: ${starts.has(d) ? 'period started' : sev ? `symptoms up to ${sev}/10` : any ? 'checked in' : 'nothing logged'}`;
      return { d, cls, label, letter: parse(d).toLocaleDateString(undefined, { weekday: 'narrow' }), today: d === today() };
    });
    const showedUp = days.filter(x => x.cls !== 'none').length;
    return `<div class="page today-page">
      <div class="page-head"><div class="eyebrow">${esc(fmt(today(), { weekday: 'long', month: 'short', day: 'numeric' }))}</div><h1 class="title">${greeting()}${name ? ', ' + esc(name) : ''}</h1></div>
      ${circleInviteCard()}
      ${circleProgressCard()}
      ${storyCard()}
      <div class="card week-card">
        <div class="row"><h2 class="card-title">This week</h2>${showedUp ? `<span class="pill peach">${plural(showedUp, 'check-in')} 🌟</span>` : `<button class="btn small soft" data-action="quick-log">Check in</button>`}</div>
        <div class="week" role="list">${days.map(x => `<div class="wday" role="listitem" aria-label="${esc(x.label)}"><span class="${x.today ? 'now' : ''}">${x.letter}</span><i class="${x.cls}${x.today ? ' today' : ''}"></i></div>`).join('')}</div>
        <p class="small muted" style="margin:0">Deeper color = stronger symptoms · rose = period started</p>
      </div>
      ${planCard()}
      ${insightCard()}
      <div class="grid two tiles">
        <a class="card tile-link" href="#visit" data-route="visit"><span class="small muted">Next visit</span><span class="tile-big">${appt ? (apptIn > 0 ? `In ${plural(apptIn, 'day')}` : apptIn === 0 ? 'Today' : fmt(appt)) : 'Not set'}</span><span class="tile-go">${appt ? (hasAgenda ? 'Agenda ready ›' : 'Prepare ›') : 'Add a date ›'}</span></a>
        ${since ? `<a class="card tile-link" href="#cycle" data-route="cycle"><span class="small muted">Cycle</span><span class="tile-big">Day ${since}</span><span class="tile-go">Calendar ›</span></a>`
          : `<button class="card tile-link" data-action="quick-log" data-period="1"><span class="small muted">Cycle</span><span class="tile-big">—</span><span class="tile-go">Log a period ›</span></button>`}
      </div>
      <p class="note">Cura organizes your own notes. It doesn't diagnose or replace care from a clinician.</p>
    </div>`;
  }
  // The 30-day strip and most frequent symptoms, shown on the Cycle screen.
  function trendsHtml() {
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
    return `<div class="card">
        <div class="row"><h2 class="card-title">Last 30 days</h2><span class="pill">${plural(logged.size, 'day')} logged</span></div>
        <div class="strip" role="img" aria-label="Symptom intensity over the last 30 days">${strip}</div>
        <div class="row small muted"><span>${fmt(addDays(today(), -29))}</span><span>Today</span></div>
      </div>
      <div class="card"><h2 class="card-title">Most frequent symptoms</h2><p class="card-sub">Last 30 days · days noticed and average intensity</p>
        ${top.length ? top.map(t => `<div class="bar-row"><span>${esc(cap(t.name))}</span><span class="bar"><i style="width:${Math.round(t.days.size / maxDays * 100)}%"></i></span><span class="val">${plural(t.days.size, 'day')}${t.sevN ? ' · ' + avgText(t.sevSum, t.sevN) : ''}</span></div>`).join('') : `<div class="empty"><strong>No symptoms yet</strong>Tell Cura things like “hot flashes last night, a 6”.</div>`}
      </div>`;
  }
  function insightCard() {
    const text = ui.insight || (user.insight && user.insight.text);
    if (!text && !ui.insightLoading) return '';
    return `<div class="card insight"><div class="insight-kicker">Cura noticed</div>
      ${text ? `<p class="insight-text">${esc(text)}</p>` : '<div class="skel" style="width:92%"></div><div class="skel" style="width:70%"></div>'}</div>`;
  }
  // Asks Cura for a short read of the last 7 days once per visit to Today (the server caches it).
  function maybeLoadInsight() {
    if (ui.insightTried) return;
    const since = addDays(today(), -6);
    const recent = user.symptoms.filter(x => x.date >= since).length + user.checkins.filter(x => x.date >= since).length + user.cycleStarts.filter(x => x.date >= since).length;
    if (recent < 2) return;
    ui.insightTried = true; ui.insightLoading = true;
    const card = $('.insight'); if (!card && route === 'today') render();
    api('insight', {}, { keepUser: true })
      .then(d => { ui.insight = d.insight || ''; })
      .catch(() => {})
      .finally(() => { ui.insightLoading = false; if (route === 'today') render(); });
  }
  function recentList() {
    const items = [
      ...user.symptoms.map(s => ({ date: s.date, title: cap(s.name), meta: [s.severity ? s.severity + '/10' : '', s.impact].filter(Boolean).join(' · '), icon: '🌡️' })),
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
      <button class="back no-print" data-route="today">‹ Today</button>
      <div class="page-head"><div class="eyebrow">Your cycle</div><h1 class="title">Cycle & symptoms</h1><p class="sub">Tap a day to see or add things.</p></div>
      <div class="card">
        <div class="cal-head"><button class="icon-btn" data-action="month" data-dir="-1" aria-label="Previous month">‹</button><div class="cal-title">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div><button class="icon-btn" data-action="month" data-dir="1" aria-label="Next month">›</button></div>
        <div class="cal">${dows}${days}</div>
        <div class="legend"><span><i style="background:var(--rose)"></i>Period started</span><span><i style="background:var(--brand);border-radius:50%"></i>Symptoms logged</span></div>
      </div>
      <div class="card">
        <div class="row"><h2 class="card-title">${esc(fmtLong(sel))}</h2>${sel <= today() ? (selStart ? `<span class="pill rose">Period started</span>` : `<button class="btn small ghost" data-action="period-on" data-date="${sel}">🩸 Period started this day</button>`) : ''}</div>
        ${selCheck.map(c => `<p class="li-meta">💭 “${esc(c.feeling)}”</p>`).join('')}
        ${selSyms.length ? selSyms.map(symItem).join('') : `<p class="card-sub" style="margin-top:8px">No symptoms logged for this day.</p>`}
        ${sel <= today() ? (ui.showSymForm ? symptomForm(sel) : `<div class="row-wrap" style="margin-top:8px"><button class="btn ghost" data-action="sym-form">+ Add a symptom</button><button class="btn ghost" data-action="quick-log" data-date="${sel}">➕ Quick log</button></div>`) : ''}
      </div>
      <div class="card">
        <h2 class="card-title">Period history</h2><p class="card-sub">Days between period starts are counted for you.</p>
        ${gaps.length ? [...gaps].reverse().map((c, i, arr) => { const prev = arr[i + 1]; return `<div class="list-item"><span aria-hidden="true">🩸</span><div class="li-main"><div class="li-title">${esc(fmtLong(c.date))}</div><div class="li-meta">${prev ? diffDays(prev.date, c.date) + ' days after the previous start' : 'First one logged'}</div></div><button class="icon-btn" data-action="del" data-kind="period_start" data-id="${esc(c.id)}" aria-label="Remove">×</button></div>`; }).join('') : `<div class="empty"><strong>No period dates yet</strong>Tap a day above, or tell Cura “my period started today”.</div>`}
      </div>
      ${trendsHtml()}
    </div>`;
  }
  function symItem(s) {
    return `<div class="list-item"><span class="sev-badge ${sevClass(s.severity)}">${s.severity ? s.severity + '/10' : '—'}</span><div class="li-main"><div class="li-title">${esc(cap(s.name))}</div>${s.impact ? `<div class="li-meta">${esc(s.impact)}</div>` : ''}${s.notes ? `<div class="li-note">${esc(s.notes)}</div>` : ''}</div><button class="icon-btn" data-action="del" data-kind="symptom" data-id="${esc(s.id)}" aria-label="Delete ${esc(s.name)}">×</button></div>`;
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
      <button class="back no-print" data-route="today">‹ Today</button>
      <div class="page-head"><div class="eyebrow">Appointments</div><h1 class="title">Your visits</h1><p class="sub">Notes, an agenda Cura drafts, and next steps.</p>
        <button class="btn ghost no-print" data-route="report" style="margin-top:12px">📄 Summary for my doctor</button></div>
      <div class="seg no-print" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${ui.visitTab === k}" class="${ui.visitTab === k ? 'on' : ''}" data-visit="${k}">${l}</button>`).join('')}</div>
      ${body}
    </div>`;
  }
  function visitBefore() {
    const p = user.profile;
    const notes = [...user.preNotes].sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="card">
        <h2 class="card-title">Next appointment</h2><p class="card-sub">Optional. Cura uses this to remind you what to bring up.</p>
        <div class="form-grid"><div class="field"><label for="apptDate">Date</label><input class="input" id="apptDate" type="date" data-profile="appointment_date" value="${esc(p.appointmentDate)}"></div>
        <div class="field"><label for="clinician">Clinician or clinic</label><input class="input" id="clinician" data-profile="clinician" value="${esc(p.clinician)}" placeholder="e.g. Dr. Patel"></div></div>
      </div>
      <div class="card">
        <h2 class="card-title">Things to bring up</h2><p class="card-sub">Questions or changes to bring up.</p>
        <form data-form="pre-note" class="stack"><textarea class="textarea" name="text" required placeholder="e.g. My sleep has been much worse since August"></textarea><div class="row"><span class="small muted">${plural(notes.length, 'note')}</span><button class="btn primary" type="submit">Add note</button></div></form>
        <div style="margin-top:8px">${notes.map(n => `<div class="list-item"><span aria-hidden="true">📝</span><div class="li-main"><div class="li-note" style="margin-top:0">${esc(n.text)}</div><div class="li-meta">${fmtLong(n.date)}</div></div><button class="icon-btn" data-action="del" data-kind="visit_note" data-id="${esc(n.id)}" aria-label="Delete note">×</button></div>`).join('')}</div>
      </div>
      <button class="btn primary sparkle" style="width:100%;margin-top:14px" data-action="draft" data-mode="prep" ${ui.drafting ? 'disabled' : ''}>${ui.drafting ? 'Cura is writing…' : '✨ Turn my notes into an agenda'}</button>`;
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
      ${empty ? `<div class="empty" style="margin-top:14px"><strong>No agenda yet</strong>Cura can draft one from your symptoms, cycle and notes. You can edit every line.</div>` : `
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
        <h2 class="card-title">After your appointment</h2><p class="card-sub">What was said, and what to do next.</p>
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

  // Me: short rows grouped like a phone's Settings app. Details and explanations live in the sheet each row opens.
  const meRow = (icon, label, value, attrs, cls = '') => `<button class="me-row ${cls}" type="button" ${attrs}><span class="me-ico" aria-hidden="true">${icon}</span><span class="me-label">${label}</span>${value ? `<span class="me-val">${value}</span>` : ''}<span class="me-chev" aria-hidden="true">›</span></button>`;
  const meGroup = (title, rows) => `<section class="me-group">${title ? `<h2 class="me-group-title">${title}</h2>` : ''}<div class="me-list">${rows.filter(Boolean).join('')}</div></section>`;
  const themeName = () => ({ light: 'Light', dark: 'Dark', system: 'Automatic' })[currentTheme()];
  function renderMe() {
    const p = user.profile, r = user.reminder || {}, days = checkinDays();
    const storyDone = storyRows().length;
    const reminderVal = !r.enabled ? 'Off' : ui.pushHere === 'no' ? 'Not on this phone' : hourLabel(r.hour);
    return `<div class="page me-page">
      <div class="me-head"><div class="me-avatar" aria-hidden="true">${esc((p.name || 'C')[0].toUpperCase())}</div>
        <div><h1 class="title" style="margin:0">${p.name ? esc(p.name) : 'You'}</h1><p class="sub">${days ? `${plural(days, 'day')} checked in` : 'Welcome to Cura'}${user.account ? ' · signed in' : ''}</p></div></div>
      ${meGroup('', [
        meRow('👤', 'Name', p.name ? esc(p.name) : 'Add', 'data-me="name"'),
        ui.googleId ? meRow('🔒', 'Account', user.account ? 'Google' : 'Not signed in', 'data-me="account"') : '',
        ui.storyOn ? meRow('📖', 'Your story', storyDone ? 'Shared' : 'Not yet', 'data-me="story"') : ''
      ])}
      ${meGroup('Every day', [
        meRow('🔔', 'Daily reminder', reminderVal, 'data-me="reminder"'),
        meRow('📅', 'Calendar', '', 'data-action="cal-open"'),
        meRow('👥', 'Circle', joined() ? esc((ui.cm.group && ui.cm.group.name) || 'Joined') : 'Not joined', joined() ? 'data-action="cm-settings"' : 'data-route="community"')
      ])}
      ${meGroup('Visits', [
        meRow('📝', 'Notes and agenda', '', 'data-route="visit"'),
        meRow('📄', 'Doctor summary', '', 'data-route="report"'),
        meRow('🗓️', 'Cycle calendar', '', 'data-route="cycle"')
      ])}
      ${meGroup('App', [
        meRow('🎨', 'Appearance', themeName(), 'data-me="theme"'),
        isStandalone() ? '' : meRow('📲', 'Add to Home Screen', '', 'data-action="install-open"'),
        meRow('💻', 'Use on another device', '', 'data-me="device"'),
        meRow('💡', 'Show app tips again', '', 'data-action="tips-again"'),
        meRow('👋', 'Welcome tour', '', 'data-action="show-welcome"')
      ])}
      ${meGroup('Your data', [
        meRow('⬇️', 'Download my data', '', 'data-action="export"'),
        meRow('🗑️', 'Erase everything', '', 'data-me="erase"', 'danger')
      ])}
      <p class="note" style="text-align:center">Cura organizes your own notes. It isn't medical advice. <a href="/privacy.html">Privacy</a></p>
    </div>`;
  }
  // The sheet behind each Me row.
  const sheetHead = title => `<div class="sheet-head"><h2 id="sheetTitle" class="sheet-title">${title}</h2><button class="icon-btn soft" data-action="sheet-close" aria-label="Close">×</button></div>`;
  function meSheetHtml() {
    const kind = ui.sheet.slice(3), p = user.profile;
    if (kind === 'name') return `${sheetHead('Your name')}<label class="sr-only" for="meName">Your first name</label>
      <input class="input" id="meName" data-me-name maxlength="60" autocomplete="given-name" enterkeyhint="done" placeholder="Your first name" value="${esc(p.name)}">
      <p class="small muted">What Cura calls you.</p><button class="btn primary" data-action="me-name-save" style="width:100%">Save</button>`;
    if (kind === 'reminder') return `${sheetHead('Daily reminder')}${reminderCard()}`;
    if (kind === 'theme') return `${sheetHead('Appearance')}${themeSeg()}`;
    if (kind === 'device') {
      const link = `${location.origin}/?device=${deviceId}`;
      return `${sheetHead('Use on another device')}<p class="card-sub">${user.account ? 'Easiest: open Cura on the other device and sign in with the same Google account.' : 'Open this private link on your other phone or computer.'} Keep the link to yourself.</p>
        <button class="btn ghost" data-action="copy-link" data-link="${esc(link)}" style="width:100%">Copy my private link</button>`;
    }
    if (kind === 'story') {
      const rows = storyRows();
      return `${sheetHead('Your story')}${rows.length
        ? `<dl class="story-list">${rows.map(([l, v]) => `<div><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
        : '<p class="card-sub">Helps Cura tailor her tips and match your Circle.</p>'}
        <button class="btn primary" data-action="story-go" style="width:100%">${rows.length ? 'Tell Cura more' : 'Tell Cura my story'}</button>
        ${ui.preview ? `<div class="test-box"><p class="small"><b>Test copy only.</b> Pick when the "your story" pop-up should appear for you (group now: ${esc((user.story && user.story.arm) || 'not set')}).</p>
          <div class="row"><button class="btn small soft" data-action="story-test" data-arm="early">After 2 messages</button><button class="btn small soft" data-action="story-test" data-arm="later">Next visit</button></div></div>` : ''}`;
    }
    if (kind === 'erase') return `${sheetHead('Erase everything')}<p class="card-sub">Deletes everything, including your chat and Circle messages. This can't be undone.</p>
      <button class="btn danger" data-action="reset" style="width:100%">${ui.confirmReset ? 'Tap again to erase everything' : 'Erase everything'}</button>`;
    return '';
  }

  // Whether this phone itself is set up for reminders (they can be on for the account but set up on another
  // device, like the old mira-care address). 'unknown' until checked.
  async function checkPushHere() {
    if (!pushSupported() || (isIOS() && !isStandalone())) { ui.pushHere = 'no'; return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      ui.pushEndpoint = sub ? sub.endpoint : '';
      ui.pushHere = sub && Notification.permission === 'granted' ? 'yes' : 'no';
    } catch { ui.pushHere = 'no'; }
    if (route === 'me' || route === 'today') render();
  }
  function reminderCard() {
    const r = user.reminder || { enabled: false, hour: 20 };
    if (!pushSupported() || (isIOS() && !isStandalone())) {
      return `<p class="card-sub" style="margin:0">${isIOS() ? 'iPhone only allows reminders for apps on your Home Screen. Add Cura to your Home Screen (above), open it from there, and turn this on.' : "This browser can't show notifications. Try Chrome, Edge or Safari, or add Cura to your Home Screen."}</p>`;
    }
    if (Notification.permission === 'denied') {
      return `<p class="card-sub" style="margin:0">Notifications are off for Cura. Turn them on in Settings → Notifications → Cura.</p>`;
    }
    const hours = Array.from({ length: 18 }, (_, i) => i + 6).map(h => `<option value="${h}" ${h === r.hour ? 'selected' : ''}>${hourLabel(h)}</option>`).join('');
    return `<p class="card-sub">A gentle nudge once a day, skipped if you've checked in.</p>
      <div class="form-grid"><div class="field"><label for="remHour">Remind me around</label><select class="select" id="remHour" data-reminder-hour>${hours}</select></div></div>
      <div class="row-wrap" style="margin-top:12px">${r.enabled && ui.pushHere === 'no'
        ? `<p class="card-sub" style="margin:0 0 8px;width:100%">Your reminder isn't on for this phone yet.</p><button class="btn primary" data-action="reminder-on" ${ui.reminderBusy ? 'disabled' : ''}>${ui.reminderBusy ? 'Turning on…' : 'Turn on for this phone'}</button><button class="btn small ghost" data-action="reminder-off">Turn off</button>`
        : r.enabled
        ? `<span class="pill">On · around ${hourLabel(r.hour)}</span><button class="btn small ghost" data-action="test-push">Send a test</button><button class="btn small ghost" data-action="reminder-off">Turn off</button>`
        : `<button class="btn primary" data-action="reminder-on" ${ui.reminderBusy ? 'disabled' : ''}>${ui.reminderBusy ? 'Turning on…' : 'Turn on daily reminder'}</button>`}</div>`;
  }
  async function enableReminders(hourArg) {
    // Ask for permission first, straight from the tap (iPhone requires that).
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications were not allowed. You can allow them in Settings → Notifications → Cura.');
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api('push-key', {}, { keepUser: true });
    let sub = await reg.pushManager.getSubscription();
    if (sub) { try { await sub.unsubscribe(); } catch {} }
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    const hour = Number(hourArg || $('#remHour')?.value || user.reminder?.hour || 20);
    await api('reminder', { enabled: true, hour, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, subscription: sub.toJSON() });
    ui.pushHere = 'yes'; ui.pushEndpoint = sub.endpoint;
  }

  // ---------- Appearance (light by default; index.html applies it before the first paint) ----------
  const THEMES = [['light', '☀️ Light'], ['dark', '🌙 Dark'], ['system', '📱 Match phone']];
  const currentTheme = () => store.get(THEME_KEY) || 'light';
  function applyTheme(t) {
    store.set(THEME_KEY, t);
    document.documentElement.setAttribute('data-theme', t);
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    $('#themeColor')?.setAttribute('content', dark ? '#15111D' : '#F7F4FB');
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (currentTheme() === 'system') applyTheme('system'); });
  const themeSeg = () => `<div class="seg" role="radiogroup" aria-label="Appearance" style="margin:0">${THEMES.map(([k, l]) => `<button role="radio" aria-checked="${currentTheme() === k}" class="${currentTheme() === k ? 'on' : ''}" data-theme-pick="${k}">${l}</button>`).join('')}</div>`;

  // ---------- Install help ----------
  let installPrompt = null; // Chrome/Android offer their own install dialog; we keep it for an "Install" button
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (route === 'me') render(); });
  // iPhone has no way for a website to open "Add to Home Screen" itself, so we point at the exact button.
  // Android and desktop Chrome give us their own one-tap install dialog (installPrompt).
  const SHARE_ICON = '<svg class="share-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M7 11H5.5A1.5 1.5 0 0 0 4 12.5v7A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H17"/></svg>';
  function installSteps() {
    const ua = navigator.userAgent, v = Number((ua.match(/Version\/(\d+)/) || [])[1] || 0);
    if (/FBAN|FBAV|Instagram|Line\/|GSA\//.test(ua)) return { where: 'none', steps: ['Tap <b>•••</b> or the compass button and choose <b>Open in Safari</b>.', 'Then come back to this screen in Safari.'] };
    if (/CriOS/.test(ua)) return { where: 'top', steps: [`Tap the <b>Share</b> button ${SHARE_ICON} at the top right.`, 'Tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>.'] };
    if (v >= 26) return { where: 'right', steps: ['Tap <b>•••</b> at the bottom right.', `Tap <b>Share</b> ${SHARE_ICON}`, 'Tap <b>Add to Home Screen</b> (scroll down if you need to), then <b>Add</b>.'] };
    return { where: 'center', steps: [`Tap the <b>Share</b> button ${SHARE_ICON} at the bottom.`, 'Scroll down and tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b> at the top right.'] };
  }
  function installHelp() {
    if (installPrompt) return `<p class="card-sub">Install Cura so it opens straight into the chat, like an app.</p><button class="btn primary" data-action="install">Install Cura</button>`;
    if (isIOS()) { const g = installSteps(); return `<ol class="install-steps">${g.steps.map(x => `<li><span>${x}</span></li>`).join('')}</ol>`; }
    return `<p class="card-sub" style="margin:0">Browser menu <b>⋮</b> → <b>Install app</b>.</p>`;
  }
  const wantsInstall = () => !isStandalone() && (isIOS() || !!installPrompt) && !store.get(INSTALL_KEY);
  function installSheetHtml() {
    const g = isIOS() && !installPrompt ? installSteps() : null;
    return `<div class="ob"><div class="ob-art"><img src="/icons/logo-256.png" alt="" class="ob-icon"></div>
      <h2 id="sheetTitle" class="ob-title">Put Cura on your Home Screen</h2>
      <p class="ob-text">It opens straight into your chat, like an app${isIOS() ? ", and it's the only way iPhone allows Cura's daily reminders" : ''}.</p>
      ${installPrompt ? '<button class="btn primary" data-action="install" style="width:100%;max-width:320px">Install Cura</button>' : `<ol class="install-steps">${g.steps.map(x => `<li><span>${x}</span></li>`).join('')}</ol>`}</div>
      <div class="row" style="justify-content:center;margin-top:12px"><button class="btn ghost" data-action="install-later">Maybe later</button></div>
      ${g && g.where !== 'none' ? `<div class="install-arrow ${g.where}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4v15M6 13l6 6 6-6"/></svg></div>` : ''}`;
  }

  // ---------- Community: your group, ideas from it, and your daily plan ----------
  const WHEN_LABEL = { morning: 'Morning', midday: 'Midday', evening: 'Evening', bedtime: 'Bedtime', anytime: 'Any time' };
  const cap = t => (t ? t[0].toUpperCase() + t.slice(1) : '');
  const joined = () => !!(user.community && user.community.joined);
  // Same rule as the server: open after 3 check-in days, or early if the team opened it.
  const CIRCLE_DAYS = 3;
  const checkinDays = () => new Set([...user.checkins, ...user.symptoms].map(x => x.date)).size;
  const circleOpen = () => joined() || ui.circleOpenAll || !!user.circleEarly || checkinDays() >= CIRCLE_DAYS;
  function lockedHtml() {
    const n = Math.min(checkinDays(), CIRCLE_DAYS);
    return `<div class="page">
      <div class="page-head"><div class="eyebrow">Circle</div><h1 class="title">Your Circle is almost ready</h1>
        <p class="sub">A few check-ins first, so Cura can match you well.</p></div>
      <div class="card lock-card">
        <div class="lock-steps" aria-label="${n} of ${CIRCLE_DAYS} check-ins">${Array.from({ length: CIRCLE_DAYS }, (_, i) => `<i class="${i < n ? 'on' : ''}">${i < n ? '✓' : i + 1}</i>`).join('')}</div>
        <p class="lock-text"><b>${n} of ${CIRCLE_DAYS} check-ins.</b> ${CIRCLE_DAYS - n === 1 ? "One more day and you're in." : `${CIRCLE_DAYS - n} more days and you're in.`}</p>
        ${checkedInToday() ? '<p class="small muted" style="margin:0">You checked in today. Come back tomorrow 💜</p>' : '<button class="btn primary" data-action="quick-log" style="width:100%">Check in now</button>'}
        ${ui.storyOn && !(user.story && user.story.startedAt) ? '<button class="cp-story" data-action="story-go">Tell your story for a better match ›</button>' : ''}
      </div>
      <div class="card how-it-works">
        <div class="hiw"><span>1</span><p><b>Cura finds your people.</b></p></div>
        <div class="hiw"><span>2</span><p><b>Chat, or just read along.</b></p></div>
        <div class="hiw"><span>3</span><p><b>Try what's helped others.</b></p></div>
      </div>
    </div>`;
  }
  // Until 4 women have joined, the Circle is "forming": they can read, but the chat opens when it's not just them.
  function formingHtml(g) {
    const n = Math.min(g.size, g.openAt || 4), need = (g.openAt || 4);
    return `<div class="forming" role="status">
      <div class="forming-seats" aria-hidden="true">${Array.from({ length: need }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>
      <p><b>Your Circle is forming</b> · ${n} of ${need} here</p>
      <p class="small muted">Opens once ${need} women have joined. We'll let you know.</p>
    </div>`;
  }
  // A soft ring of members around Cura's logo, for the tour step and the "your Circle is ready" moment.
  function circleArt(ready) {
    const dots = ['#CDBBF7', '#F4C9B4', '#B9D3BC', '#F2B8C6', '#C9D8F2', '#E7D3A6'];
    return `<div class="circle-art${ready ? ' ready' : ''}" aria-hidden="true"><img src="/icons/logo-256.png" alt="">${dots.map((c, i) => `<i style="--a:${i * 60}deg;--c:${c};--d:${i * 0.12}s"></i>`).join('')}</div>`;
  }
  // On Today, before the Circle opens: how close they are, and that their story improves the match.
  function circleProgressCard() {
    if (joined() || circleOpen()) return '';
    const n = Math.min(checkinDays(), CIRCLE_DAYS), left = CIRCLE_DAYS - n;
    const storyTip = ui.storyOn && !(user.story && user.story.startedAt) ? '<button class="cp-story" data-action="story-go">Tell your story for a better match ›</button>' : '';
    return `<div class="card circle-progress"><a class="cp-main" href="#community" data-route="community">
        <span class="cp-dots" aria-hidden="true">${Array.from({ length: CIRCLE_DAYS }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>
        <span class="cp-text"><b>Your Circle opens in ${left} check-in${left === 1 ? '' : 's'}</b><small>A small group of women going through the same thing</small></span><span class="arrow">›</span></a>${storyTip}</div>`;
  }
  // Once, the first time they open the app after their Circle opens (no chat message, just this moment).
  function maybeCircleReady() {
    if (!ui.loaded || ui.sheet || ui.bigMoment || route === 'community' || joined() || !circleOpen() || store.get('cura-circle-ready-seen') || $('#coach .coach-ring')) return;
    store.set('cura-circle-ready-seen', '1'); ui.bigMoment = true;
    ui.sheet = 'circle-ready'; renderSheet();
  }
  function circleReadyHtml() {
    return `<div class="ob">${circleArt(true)}
      <h2 id="sheetTitle" class="ob-title">You've unlocked your Circle</h2>
      <p class="ob-text">Join a small private group of women going through the same thing.</p></div>
      <div class="story-actions"><button class="btn primary" data-action="circle-meet">See my Circle</button><button class="btn ghost" data-action="sheet-close">Later</button></div>`;
  }
  // On Today, once the Circle opens and they haven't joined yet.
  function circleInviteCard() {
    if (joined() || !circleOpen()) return '';
    return `<button class="cta soft" data-route="community"><span class="cta-ico" aria-hidden="true">👥</span><span><strong>You've unlocked your Circle</strong><small>A small private group of women going through the same thing.</small></span><span class="arrow">›</span></button>`;
  }
  const inPlan = tipId => (user.plan || []).some(p => p.tipId === tipId && p.status === 'active');
  const activePlan = () => (user.plan || []).filter(p => p.status === 'active');
  const defaultFocus = () => topSymptoms(user.symptoms).slice(0, 4).map(t => cap(t.name));
  // Their chosen symptoms first, then ones they've logged, then common ones.
  function focusChoices(selected) {
    const known = new Set(selected.map(x => x.toLowerCase()));
    const extra = [...defaultFocus(), ...COMMON_SYMPTOMS].filter(n => { const k = n.toLowerCase(); if (known.has(k)) return false; known.add(k); return true; });
    return [...selected, ...extra].slice(0, 18);
  }

  function joinHtml() {
    // Start from what they've logged, once their data has loaded.
    const start = () => ({ focus: defaultFocus(), anonymous: !user.profile.name, name: user.profile.name || '', busy: false });
    if (!ui.cm.join && ui.loaded) ui.cm.join = start();
    const J = ui.cm.join || start();
    return `<div class="page">
      <div class="page-head"><div class="eyebrow">Circle</div><h1 class="title">You're not alone in this</h1>
        <p class="sub">Swap what's helped with women going through the same thing.</p></div>
      <div class="card"><h2 class="card-title">What would you like to talk about?</h2>
        <p class="card-sub">${defaultFocus().length ? "We picked these from what you've told Cura. Change them if you like." : 'Pick any that fit. Cura uses them to find your group.'}</p>
        <div class="chipset">${focusChoices(J.focus).map(n => `<button class="chip ${J.focus.includes(n) ? 'on' : ''}" data-cm-focus="${esc(n)}" aria-pressed="${J.focus.includes(n)}">${esc(n)}</button>`).join('')}</div></div>
      <div class="card"><h2 class="card-title">How should you appear?</h2><p class="card-sub">You can change this anytime.</p>
        <div class="seg" role="radiogroup" aria-label="How you appear">
          <button role="radio" aria-checked="${!J.anonymous}" class="${!J.anonymous ? 'on' : ''}" data-cm-anon="0">By first name</button>
          <button role="radio" aria-checked="${J.anonymous}" class="${J.anonymous ? 'on' : ''}" data-cm-anon="1">Anonymously</button></div>
        ${J.anonymous ? `<p class="small muted" style="margin:0">You'll appear as a nickname, like Willow.</p>` : `<label class="sr-only" for="cmName">Your first name</label><input class="input" id="cmName" data-cm-name maxlength="60" placeholder="Your first name" value="${esc(J.name)}" autocomplete="given-name">`}
      </div>
      <div class="card how-it-works">
        <div class="hiw"><span>1</span><p><b>Cura finds your people.</b> It matches you with others whose symptoms and intensity are like yours, and keeps adjusting as the community grows.</p></div>
        <div class="hiw"><span>2</span><p><b>Just chat.</b> Share what you're going through and what's helped. No forms.</p></div>
        <div class="hiw"><span>3</span><p><b>Try what worked.</b> Cura picks out tips, says why they may help, and adds the ones you choose to your daily plan.</p></div>
      </div>
      <button class="btn primary" data-action="cm-join" style="width:100%;margin-top:14px" ${J.busy ? 'disabled' : ''}>${J.busy ? 'Finding your group…' : 'Join my group'}</button>
      <p class="note">Be kind, and share your own experience rather than medical advice. The Cura team reads the groups to keep them safe. You can leave anytime.</p>
    </div>`;
  }

  function renderCommunity() {
    if (!joined()) return circleOpen() ? joinHtml() : lockedHtml();
    const g = ui.cm.group, notice = user.community.notice;
    const tabs = [['group', 'Group'], ['ideas', 'Ideas for you']];
    return `<section class="chat community">
      <header class="chat-head group-head">
        <button class="icon-btn head-btn" data-action="cm-settings" aria-label="Group settings">⋯</button>
        <div class="avatar group-avatar" aria-hidden="true">👥</div>
        <div class="chat-name">${esc(g ? g.name : 'Your group')}</div>
        <div class="chat-status">${g ? `${plural(g.size, 'member')}${g.focus ? ' · ' + esc(g.focus) : ''}` : 'Loading…'}</div>
      </header>
      <div class="seg cm-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${ui.cm.tab === k}" class="${ui.cm.tab === k ? 'on' : ''}" data-cm-tab="${k}">${l}</button>`).join('')}</div>
      ${ui.cm.tab === 'ideas' ? `<div class="cm-scroll" id="ideas">${ideasHtml()}</div>` : `
      ${notice ? `<div class="install notice"><span>🔀</span><span>${esc(notice.text)}</span><button class="icon-btn" data-action="cm-notice" aria-label="Dismiss">×</button></div>` : ''}
      <div class="thread" id="gthread" aria-live="polite">${groupThreadHtml()}</div>
      ${g && g.open === false ? formingHtml(g) : `<form class="composer${voiceMode() ? ' can-voice' : ''}" id="groupComposer">
        <label class="sr-only" for="groupInput">Message your group</label>
        <textarea id="groupInput" rows="1" placeholder="Message your group" enterkeyhint="send" autocomplete="off"></textarea>
        ${micBtn('groupInput')}<button class="send send-go" id="groupSend" type="submit" aria-label="Send" disabled><svg viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg></button>
      </form>`}`}
    </section>`;
  }

  function groupThreadHtml() {
    if (!ui.cm.loaded) return '<div class="typing" aria-label="Loading"><i></i><i></i><i></i></div>';
    const msgs = ui.cm.messages;
    const gap = (a, b) => new Date(b.at) - new Date(a.at) > 3600000;
    const same = (a, b) => a && b && a.name === b.name && a.mine === b.mine && !gap(a, b);
    let html = `<p class="cm-hint">Share what you're going through and what's helped. Cura quietly picks out tips to pass on to people like you.</p>`;
    msgs.forEach((m, i) => {
      const prev = msgs[i - 1], next = msgs[i + 1];
      if (!prev || gap(prev, m)) html += `<div class="stamp">${stampText(m.at)}</div>`;
      if (!m.mine && !same(prev, m)) html += `<div class="sender${m.cura ? ' cura' : ''}">${esc(m.name)}</div>`;
      // Tap someone else's message to react; reactions show underneath.
      html += m.mine
        ? `<div class="msg me${same(m, next) ? '' : ' tail'}">${fmtMsg(m.text)}</div>`
        : `<button class="msg them${m.cura ? ' cura' : ''}${same(m, next) ? '' : ' tail'}" data-react-open="${esc(m.id)}" aria-label="${esc(m.name)}: ${esc(m.text)}. Tap to react">${fmtMsg(m.text)}</button>`;
      const rs = ui.cm.reactions[m.id] || [];
      if (rs.length || ui.cm.reactFor === m.id) html += `<div class="reacts ${m.mine ? 'mine' : ''}">${rs.map(r => `<button class="react-pill ${r.mine ? 'on' : ''}" data-react="${r.e}" data-msg="${esc(m.id)}" aria-pressed="${r.mine}" aria-label="${r.e} ${r.n}">${r.e} ${r.n}</button>`).join('')}${ui.cm.reactFor === m.id ? REACTS.filter(e => !rs.some(r => r.e === e && r.mine)).map(e => `<button class="react-add" data-react="${e}" data-msg="${esc(m.id)}" aria-label="React ${e}">${e}</button>`).join('') : ''}</div>`;
    });
    if (ui.cm.posting) html += `<div class="msg me tail sending">${fmtMsg(ui.cm.posting)}</div>`;
    return html;
  }
  const REACTS = ['💜', '🙌', '🤗'];
  // Reactions come back with every check for new messages; redraw only when they changed.
  function takeReactions(d) {
    if (!d || !d.reactions) return false;
    const changed = JSON.stringify(d.reactions) !== JSON.stringify(ui.cm.reactions);
    ui.cm.reactions = d.reactions;
    return changed;
  }
  async function react(msgId, emoji) {
    ui.cm.reactFor = '';
    // Show it straight away, then take the server's answer.
    const list = (ui.cm.reactions[msgId] || []).map(r => ({ ...r }));
    const r = list.find(x => x.e === emoji);
    if (r) { r.mine = !r.mine; r.n += r.mine ? 1 : -1; } else list.push({ e: emoji, n: 1, mine: true });
    ui.cm.reactions = { ...ui.cm.reactions, [msgId]: list.filter(x => x.n > 0) };
    refreshGroup(false);
    try {
      const last = ui.cm.messages[ui.cm.messages.length - 1];
      const d = await api('group-react', { msgId, emoji, since: last ? last.at : '' }, { keepUser: true });
      ui.cm.messages = mergeMsgs(ui.cm.messages, d.messages || []); takeReactions(d);
    } catch (e) { toast(e.message); }
    refreshGroup(false);
  }
  const mergeMsgs = (a, b) => { const seen = new Set(); return [...a, ...b].filter(m => !seen.has(m.id) && seen.add(m.id)); };

  // full: the whole recent history (first open); otherwise only what's new since the last message.
  async function loadGroup(full) {
    if (!joined() || ui.cm.fetching) return;
    ui.cm.fetching = true;
    try {
      const last = ui.cm.messages[ui.cm.messages.length - 1];
      const d = await api('group', full || !last ? {} : { since: last.at }, { keepUser: true });
      const first = !ui.cm.loaded;
      if (d.group) ui.cm.group = d.group;
      if (d.notice !== undefined) user.community.notice = d.notice;
      const next = mergeMsgs(full ? [] : ui.cm.messages, d.messages || []);
      const changed = takeReactions(d) || first || full || next.length !== ui.cm.messages.length;
      ui.cm.messages = next; ui.cm.loaded = true; ui.unread = 0; updateBadge();
      if (changed && route === 'community') refreshGroup(first || full);
      if (ui.sheet === 'cm') renderSheet();
    } catch (e) { if (full) toast(e.message); }
    ui.cm.fetching = false;
  }
  // Redraws the group without losing a half-typed message.
  function refreshGroup(whole) {
    const t = $('#gthread');
    if (!t || whole) {
      const box = $('#groupInput'), val = box ? box.value : '', focused = box && document.activeElement === box;
      render();
      const nb = $('#groupInput');
      if (nb && val) { nb.value = val; autoGrow(nb); $('#groupSend').disabled = !val.trim(); nb.form.classList.toggle('has-text', !!val.trim()); }
      if (nb && focused) nb.focus({ preventScroll: true });
      return;
    }
    const near = t.scrollHeight - t.scrollTop - t.clientHeight < 140;
    t.innerHTML = groupThreadHtml();
    if (near) t.scrollTop = t.scrollHeight;
  }
  // New group messages arrive by checking every few seconds while the group is on screen.
  let pollTimer = null;
  function syncPoll() {
    const want = route === 'community' && joined() && ui.cm.tab === 'group' && document.visibilityState === 'visible';
    if (want && !pollTimer) pollTimer = setInterval(() => loadGroup(false), 5000);
    if (!want && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  document.addEventListener('visibilitychange', () => { syncPoll(); if (document.visibilityState === 'visible' && route === 'community' && joined() && ui.cm.loaded) loadGroup(false); });
  function updateBadge() {
    const b = $('#cmBadge'); if (!b) return;
    const n = route === 'community' ? 0 : ui.unread;
    const ready = !n && route !== 'community' && circleOpen() && !joined() && !store.get('cura-circle-visited');
    if (route === 'community' && circleOpen()) store.set('cura-circle-visited', '1');
    b.hidden = !n && !ready; b.classList.toggle('dot', ready); b.textContent = n > 9 ? '9+' : n ? String(n) : '';
  }

  async function postToGroup(text) {
    text = text.trim();
    if (!text || ui.cm.posting) return;
    ui.cm.posting = text; refreshGroup(false); scrollThread();
    try {
      const last = ui.cm.messages[ui.cm.messages.length - 1];
      const d = await api('group-post', { text, since: last ? last.at : '' }, { keepUser: true });
      ui.cm.messages = mergeMsgs(ui.cm.messages, d.messages || []); takeReactions(d);
      if (d.group) ui.cm.group = d.group;
    } catch (e) {
      toast(e.message);
      const box = $('#groupInput'); if (box && !box.value) { box.value = text; autoGrow(box); $('#groupSend').disabled = false; box.form.classList.add('has-text'); }
    }
    ui.cm.posting = ''; refreshGroup(false); scrollThread();
  }

  function ideaCardHtml(i, inChat) {
    const stats = [i.stats && i.stats.shared ? `${plural(i.stats.shared, 'member')} shared that it helped` : '', i.stats && i.stats.tried ? `${i.stats.helped} of ${i.stats.tried} who tried it said it helped` : '', i.team ? 'From the Cura team' : ''].filter(Boolean).join(' · ');
    const action = i.kind === 'medical'
      ? `<button class="btn small ghost" data-action="idea-visit" data-tip="${esc(i.id)}" data-title="${esc(i.title)}" data-symptom="${esc(i.symptom)}">📝 Ask my clinician about it</button>`
      : inPlan(i.id) ? '<span class="pill">✓ In your plan</span>' : `<button class="btn small primary" data-action="plan-add" data-tip="${esc(i.id)}">Add to my plan</button>`;
    return `<div class="${inChat ? 'idea in-chat' : 'card idea'}">
      <div class="idea-kicker">${inChat ? '<span>🌿 From your Circle</span>' : ''}<span class="pill">${esc(cap(i.symptom))}</span><span>${esc(WHEN_LABEL[i.when] || 'Any time')}</span></div>
      <div class="idea-title">${esc(i.title)}</div>
      ${i.why ? `<p class="idea-why"><b>Why it may help:</b> ${esc(i.why)}</p>` : ''}
      ${!inChat && i.personal ? `<p class="idea-meta">${esc(i.personal)}</p>` : ''}
      ${stats && !inChat ? `<p class="idea-meta">${esc(stats)}</p>` : ''}
      <div class="row-wrap">${action}${inChat ? '' : `<button class="btn small ghost" data-action="tip-hide" data-tip="${esc(i.id)}">Not now</button>`}</div>
    </div>`;
  }
  function ideasHtml() {
    const plan = activePlan();
    const top = `<div class="card plan-mini"><div class="row"><div><h2 class="card-title">🌿 Your plan</h2><p class="card-sub" style="margin:0">${plan.length ? `${plural(plan.length, 'idea')} you're trying. Tick ${plan.length === 1 ? 'it' : 'them'} off on Today.` : 'Add an idea below and it shows up on Today each day.'}</p></div>${plan.length ? '<button class="btn small ghost" data-route="today">Open</button>' : ''}</div>
      ${plan.length ? '<div class="row-wrap" style="margin-top:10px"><button class="btn small ghost" data-action="cal-open">📅 Put my plan on my calendar</button></div>' : ''}</div>`;
    if (ui.cm.ideas === null) return top + '<div class="card"><div class="skel" style="width:60%"></div><div class="skel" style="width:90%"></div><div class="skel" style="width:75%"></div></div>';
    const list = ui.cm.ideas, mine = list.filter(i => i.match), more = list.filter(i => !i.match);
    if (!list.length) return top + `<div class="empty" style="margin-top:14px"><strong>No ideas yet</strong>As people share what's helped, the Cura team checks the tips and they show up here.</div>`;
    return top
      + (mine.length ? `<div class="section-kicker">For what you're dealing with</div>${mine.map(i => ideaCardHtml(i)).join('')}` : '')
      + (more.length ? `<div class="section-kicker">${mine.length ? 'Also popular' : 'Popular in the Circle'}</div>${more.map(i => ideaCardHtml(i)).join('')}` : '')
      + `<p class="note">Ideas come from members' own experience and are checked by the Cura team. They're everyday things to try, not medical advice.</p>`;
  }
  async function loadIdeas() {
    if (ui.cm.ideasLoading) return;
    ui.cm.ideasLoading = true;
    try { const d = await api('ideas', {}, { keepUser: true }); ui.cm.ideas = d.ideas || []; } catch (e) { ui.cm.ideas = ui.cm.ideas || []; toast(e.message); }
    ui.cm.ideasLoading = false;
    if (route === 'community' && ui.cm.tab === 'ideas') { const sc = $('#ideas'), top = sc ? sc.scrollTop : 0; render(); const n = $('#ideas'); if (n) n.scrollTop = top; }
  }

  function planCard() {
    const items = activePlan();
    if (!items.length) return joined()
      ? `<button class="cta soft" data-action="cm-ideas"><span class="cta-ico" aria-hidden="true">🌿</span><span><strong>Ideas from your Circle</strong><small>Things that helped people like you. Add one to your plan.</small></span><span class="arrow">›</span></button>`
      : '';
    return `<div class="card plan-card">
      <div class="row"><h2 class="card-title">Your plan</h2><span class="small muted">${items.filter(p => (p.done || []).includes(today())).length} of ${items.length} done</span></div>
      <p class="card-sub" style="margin-bottom:4px">Ideas you picked from your Circle. Tick them off each day.</p>
      ${items.map(planItemHtml).join('')}
      <button class="btn small ghost" data-action="cal-open" style="margin-top:8px">📅 Put it on my calendar</button>
    </div>`;
  }
  function planItemHtml(p) {
    const day = diffDays(p.start, today()) + 1, done = (p.done || []).includes(today());
    const due = !p.outcome && today() >= p.checkOn;
    const meta = [WHEN_LABEL[p.when] || 'Any time', `for ${p.symptom}`, p.kept ? 'it helped, keep it up' : due ? 'one week done' : `day ${Math.min(day, 7)} of 7`].join(' · ');
    return `<div class="plan-item">
      <button class="check ${done ? 'on' : ''}" data-action="plan-done" data-id="${esc(p.id)}" aria-pressed="${done}" aria-label="${done ? 'Done today' : 'Mark done today'}: ${esc(p.title)}">${done ? '✓' : ''}</button>
      <div class="li-main"><div class="li-title">${esc(p.title)}</div><div class="li-meta">${esc(meta)}</div>
        ${due ? `<div class="plan-check"><span>You've tried it for a week. Did it help?</span><div class="row-wrap">${[['a_lot', 'Helped a lot'], ['some', 'A little'], ['not_much', 'Not really']].map(([k, l]) => `<button class="qr-opt" data-action="plan-outcome" data-id="${esc(p.id)}" data-how="${k}">${l}</button>`).join('')}</div></div>` : ''}
      </div>
      <button class="icon-btn" data-action="plan-remove" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.title)} from your plan">×</button>
    </div>`;
  }

  function cmSettingsHtml() {
    const c = user.community, g = ui.cm.group;
    if (!ui.cm.focusEdit) ui.cm.focusEdit = [...(c.focus || [])];
    const F = ui.cm.focusEdit, changed = F.join('|') !== (c.focus || []).join('|');
    const anon = c.anonymous || !user.profile.name;
    return `<div class="sheet-head"><h2 id="sheetTitle" class="card-title">${esc(g ? g.name : 'Your group')}</h2><button class="icon-btn" data-action="sheet-close" aria-label="Close">×</button></div>
      ${g && g.focus ? `<p class="card-sub">${esc(g.focus)}</p>` : ''}
      ${c.reason ? `<div class="install" style="margin:0 0 6px"><span>💚</span><span>${esc(c.reason)}</span></div>` : ''}
      ${g ? `<div class="section-kicker">Members (${g.size})</div><p class="small" style="margin:0;line-height:1.6">${g.members.map(esc).join(', ')}</p>` : ''}
      <div class="section-kicker">How you appear</div>
      <div class="seg" role="radiogroup" aria-label="How you appear" style="margin-bottom:6px">
        <button role="radio" aria-checked="${!anon}" class="${!anon ? 'on' : ''}" data-cm-appear="0" ${user.profile.name ? '' : 'disabled'}>${user.profile.name ? 'As ' + esc(user.profile.name) : 'By first name'}</button>
        <button role="radio" aria-checked="${anon}" class="${anon ? 'on' : ''}" data-cm-appear="1">Anonymously${c.alias ? ' (' + esc(c.alias) + ')' : ''}</button></div>
      ${user.profile.name ? '' : '<p class="small muted" style="margin:0">Add your first name in <b>Me</b> to show it here.</p>'}
      <div class="section-kicker">What you talk about</div>
      <div class="chipset">${focusChoices(F).map(n => `<button class="chip ${F.includes(n) ? 'on' : ''}" data-cm-fedit="${esc(n)}" aria-pressed="${F.includes(n)}">${esc(n)}</button>`).join('')}</div>
      <p class="small muted">Cura uses these, and what you log, when it sorts the groups each day.</p>
      ${changed ? `<button class="btn primary small" data-action="cm-focus-save" ${F.length ? '' : 'disabled'}>Save</button>` : ''}
      <div class="divider"></div>
      <button class="btn danger" data-action="cm-leave" style="width:100%">${ui.cm.confirmLeave ? 'Tap again to leave the Circle' : 'Leave the Circle'}</button>`;
  }

  // ---------- Google sign-in ----------
  // The Google button is drawn by Google's script into each .g-btn placeholder.
  function accountBlock() {
    if (user.account) return `<p class="pill" style="margin:0 auto">✓ Signed in as ${esc(user.account.email)}</p>`;
    return ui.signingIn ? '<p class="small muted">Signing you in…</p>' : '<div class="g-btn" aria-label="Continue with Google"></div>';
  }
  function accountSheetHtml() {
    if (user.account) return `${sheetHead('Account')}<p class="card-sub">Signed in with Google as <b>${esc(user.account.email)}</b>. Sign in on any phone to see your Cura.</p>
      <button class="btn ghost" data-action="sign-out" style="width:100%">${ui.confirmSignOut ? 'Tap again to sign out of this phone' : 'Sign out'}</button>`;
    return `<div class="ob"><div class="ob-art">🔒</div><h2 id="sheetTitle" class="ob-title">Keep your Cura safe</h2>
      <p class="ob-text">Keep your notes if you change phones.</p>
      ${accountBlock()}</div>
      <div class="row" style="margin-top:16px;justify-content:center"><button class="btn ghost" data-action="account-later">Not now</button></div>`;
  }
  let googleReady = false;
  function loadGoogle() {
    if (!ui.googleId || document.getElementById('gsi')) return;
    const sc = document.createElement('script');
    sc.id = 'gsi'; sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
    sc.onload = () => {
      window.google.accounts.id.initialize({ client_id: ui.googleId, callback: onGoogleCredential, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true });
      googleReady = true; renderGoogleButtons();
    };
    document.head.appendChild(sc);
  }
  function renderGoogleButtons() {
    if (!googleReady) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (currentTheme() === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelectorAll('.g-btn:not([data-ready])').forEach(el => {
      el.dataset.ready = '1';
      window.google.accounts.id.renderButton(el, { type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', text: 'continue_with', shape: 'pill', logo_alignment: 'center', width: Math.min(320, Math.max(220, el.clientWidth || 300)) });
    });
  }
  // Google hands back a signed token; the server checks it and tells the app which saved data is theirs.
  async function onGoogleCredential(resp) {
    ui.signingIn = true; if (ui.sheet) renderSheet(); else render();
    try {
      const d = await api('google-signin', { credential: resp.credential }, { keepUser: true });
      if (d.deviceId && d.deviceId !== deviceId) { deviceId = d.deviceId; store.set(ID_KEY, deviceId); }
      user = emptyUser(); ui.older = []; ui.seen = null; ui.cm = freshCm(); ui.calUrl = ''; ui.insight = ''; ui.insightTried = false;
      setUser(d.user);
      store.set(ACCT_KEY, '1');
      const first = user.profile.name ? `, ${user.profile.name}` : '';
      toast(d.restored ? `Welcome back${first}! Your Cura is all here.` : `Signed in. Your Cura is saved to ${d.user.account.email}.`);
      if (ui.sheet === 'account' || (ui.sheet === 'welcome' && d.restored && hasData(user))) { if (ui.sheet === 'welcome') store.set(OB_KEY, '1'); ui.sheet = null; }
      api('load', {}, { keepUser: true }).then(x => { ui.unread = x.communityUnread || 0; updateBadge(); }).catch(() => {});
    } catch (e) { toast(e.message); }
    ui.signingIn = false;
    render();
  }

  // ---------- Short tips: one sentence, one thing at a time, once per screen, always skippable ----------
  const TIPS = {
    chat: [
      { sel: '.head-plus', text: () => 'Tap + for a quick check-in: your mood, symptoms and period in a few taps.' },
      { sel: '#composer', text: () => "Or just text Cura in your own words. She'll save it for you." }
    ],
    today: [{ sel: '.week-card', text: () => 'Your week at a glance: darker circles mean stronger symptoms. Your plan and next visit are below.' }],
    community: [{ sel: '.lock-card, .cm-tabs', text: () => (joined() ? "Share what's helped you, and tap anyone's message to react. Tips you'll like show up in Ideas for you." : 'After 3 check-ins your Circle opens: a small group of people with symptoms like yours.') }]
  };
  let coach = null; // { screen, i } while a tip is showing
  const tipsSeen = () => { try { return JSON.parse(store.get(TIPS_KEY) || '{}'); } catch { return {}; } };
  function maybeTips() {
    if (coach || ui.sheet || !ui.loaded || document.body.classList.contains('kb-open') || !TIPS[route] || tipsSeen()[route]) return;
    const screen = route;
    setTimeout(() => { if (!coach && !ui.sheet && route === screen && !tipsSeen()[screen]) { coach = { screen, i: 0 }; drawCoach(); } }, 500);
  }
  function drawCoach() {
    let root = document.getElementById('coach');
    if (!coach) { if (root) root.remove(); return; }
    const list = TIPS[coach.screen], tip = list[coach.i], el = document.querySelector(tip.sel);
    if (!el) { coach = null; drawCoach(); return; } // not on screen yet (e.g. the Circle before joining): try again next time
    const r = el.getBoundingClientRect(), pad = 6, w = Math.min(300, innerWidth - 24);
    const below = r.bottom + 190 < innerHeight;
    const left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    if (!root) { root = document.createElement('div'); root.id = 'coach'; document.body.appendChild(root); }
    root.innerHTML = `<div class="coach-ring" style="left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px"></div>
      <div class="coach-tip" role="dialog" aria-label="Tip" style="width:${w}px;left:${left}px;${below ? `top:${r.bottom + pad + 12}px` : `bottom:${innerHeight - r.top + pad + 12}px`}">
        <p>${esc(tip.text())}</p>
        <div class="row"><button class="coach-skip" data-coach="skip">Skip tips</button><span class="coach-count">${list.length > 1 ? `${coach.i + 1} of ${list.length}` : ''}</span><button class="btn small primary" data-coach="next">${coach.i < list.length - 1 ? 'Next' : 'Got it'}</button></div>
      </div>`;
    root.querySelector('[data-coach="next"]').focus({ preventScroll: true });
  }
  function endCoach(all) {
    const seen = tipsSeen();
    if (all) Object.keys(TIPS).forEach(k => { seen[k] = 1; }); else if (coach) seen[coach.screen] = 1;
    store.set(TIPS_KEY, JSON.stringify(seen));
    coach = null; drawCoach(); refreshTopBar();
    setTimeout(() => { maybeCircleReady(); showStoryPopup(); }, 600); // these wait until tips are out of the way
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-coach]');
    if (!b) return;
    e.stopPropagation();
    if (b.dataset.coach === 'skip') endCoach(true);
    else if (coach && coach.i < TIPS[coach.screen].length - 1) { coach.i++; drawCoach(); } else endCoach(false);
  }, true);
  window.addEventListener('resize', () => { if (coach) drawCoach(); });

  // ---------- Calendar subscription ----------
  function calLinks() {
    if (!ui.calUrl) return null;
    const webcal = ui.calUrl.replace(/^https?:/, 'webcal:');
    return { webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
  }
  async function ensureCalUrl() {
    if (ui.calUrl || ui.calLoading || ui.calTried) return;
    ui.calLoading = true; ui.calTried = true;
    try { const d = await api('calendar-link', {}, { keepUser: true }); ui.calUrl = d.url || ''; } catch (e) { toast(e.message); }
    ui.calLoading = false;
    if (ui.sheet) renderSheet();
  }
  function calButtons() {
    const L = calLinks();
    if (!L) return `<button class="btn primary" disabled>${ui.calLoading || !ui.calTried ? 'Getting your calendar link…' : 'Calendar link unavailable'}</button>`;
    return `<a class="btn primary" href="${esc(L.webcal)}">📅 Apple Calendar</a><a class="btn ghost" href="${esc(L.google)}" target="_blank" rel="noopener">Google Calendar</a>`;
  }
  function calSheetHtml() {
    return `<div class="sheet-head"><h2 id="sheetTitle" class="card-title">📅 Your plan on your calendar</h2><button class="icon-btn" data-action="sheet-close" aria-label="Close">×</button></div>
      <p class="card-sub">Your plan and next visit, in your phone's calendar.</p>
      <div class="cal-btns">${calButtons()}${ui.calUrl ? '<button class="btn ghost" data-action="cal-copy">Copy link</button>' : ''}</div>
      <p class="small muted" style="margin-top:12px;line-height:1.5">On iPhone: <b>Apple Calendar</b> → <b>Subscribe</b>. Keep the link private.</p>`;
  }

  // ---------- Bottom sheets: quick log and welcome tour ----------
  const COMMON_SYMPTOMS = ['Hot flashes', 'Night sweats', 'Trouble sleeping', 'Brain fog', 'Mood swings', 'Anxiety', 'Headache', 'Cramps', 'Joint pain', 'Fatigue', 'Bloating', 'Heavier flow'];
  const MOODS = ['Rough', 'Meh', 'Okay', 'Good', 'Great'];
  // Five faces that differ in shape as well as color.
  function moodFace(m, size) {
    const eyes = '<circle cx="12" cy="14" r="1.8" fill="#241B33"/><circle cx="22" cy="14" r="1.8" fill="#241B33"/>';
    const f = {
      Rough: ['#D2C3F4', eyes + '<path d="M11 24c3-3.5 9-3.5 12 0" fill="none" stroke="#241B33" stroke-width="2" stroke-linecap="round"/>'],
      Meh: ['#E8E0FA', eyes + '<path d="M12 23h10" fill="none" stroke="#241B33" stroke-width="2" stroke-linecap="round"/>'],
      Okay: ['#FDEBDF', eyes + '<path d="M12 21c2.5 2 7.5 2 10 0" fill="none" stroke="#241B33" stroke-width="2" stroke-linecap="round"/>'],
      Good: ['#FBD9C4', eyes + '<path d="M11 20c3 4 9 4 12 0" fill="none" stroke="#241B33" stroke-width="2" stroke-linecap="round"/>'],
      Great: ['#F4A97E', '<path d="M9.5 14.5l2.5-2 2.5 2M19.5 14.5l2.5-2 2.5 2" fill="none" stroke="#241B33" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 19.5c3 5 10 5 13 0z" fill="#241B33"/>']
    }[m];
    return `<svg width="${size}" height="${size}" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="15" fill="${f[0]}"/>${f[1]}</svg>`;
  }
  function symptomChoices() {
    // Their most-logged and chosen symptoms first, then the common ones.
    const mine = [...topSymptoms(user.symptoms).map(t => t.name), ...((user.community && user.community.focus) || [])].slice(0, 6).map(n => n[0].toUpperCase() + n.slice(1));
    const seen = new Set();
    return [...mine, ...COMMON_SYMPTOMS].filter(n => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  function openQuickLog(date, period = false) {
    ui.log = { date: date || today(), mood: '', syms: [], other: '', sev: 5, period, saving: false };
    ui.sheet = 'log'; renderSheet();
  }
  function closeSheet() {
    const wasTour = ui.sheet === 'welcome';
    // Nobody stays nameless: finishing (or closing) the welcome needs a name or a Google sign-in.
    if (wasTour && needsName()) {
      ui.ob = obSteps().length - 1; ui.obNameErr = true; renderSheet();
      const f = $('#obName'); if (f) f.focus();
      return;
    }
    if (wasTour) { saveObName(); store.set(OB_KEY, '1'); }
    if (ui.sheet === 'cm') { ui.cm.focusEdit = null; ui.cm.confirmLeave = false; }
    if (ui.sheet === 'account') store.set(ACCT_KEY, '1');
    if (ui.sheet === 'install') store.set(INSTALL_KEY, '1');
    ui.sheet = null;
    // Right after the welcome, on a phone browser: offer the Home Screen (reminders need it on iPhone).
    if (wasTour && wantsInstall()) ui.sheet = 'install';
    if (wasTour || route === 'me') render(); else { renderSheet(); maybeTips(); } // so Cura's first message picks up their answers
    setTimeout(() => { maybeCircleReady(); showStoryPopup(); }, 900); // if one came due while another panel was open
  }
  function quickLogHtml() {
    const L = ui.log, yesterday = addDays(today(), -1);
    const dayLabel = L.date === today() ? 'Today' : L.date === yesterday ? 'Yesterday' : fmtLong(L.date);
    const picked = L.syms.length || L.other.trim();
    const label = [...L.syms, L.other.trim()].filter(Boolean).join(', ');
    return `<div class="sheet-head"><h2 id="sheetTitle" class="sheet-title">How's ${L.date === today() ? 'today' : L.date === yesterday ? 'yesterday' : esc(dayLabel)}?</h2><button class="icon-btn soft" data-action="sheet-close" aria-label="Close">×</button></div>
      <div class="moods">${MOODS.map(m => `<button class="mood ${L.mood === m ? 'on' : ''}" data-mood="${m}" aria-pressed="${L.mood === m}">${moodFace(m, 30)}${m}</button>`).join('')}</div>
      <div class="ci-label">Anything bothering you? <span>Your usual ones first</span></div>
      <div class="chipset">${symptomChoices().map(n => `<button class="chip ${L.syms.includes(n) ? 'on' : ''}" data-sym="${esc(n)}" aria-pressed="${L.syms.includes(n)}">${esc(n)}</button>`).join('')}</div>
      <input class="input" style="margin-top:10px" data-log-other placeholder="Something else? Type it here" maxlength="60" value="${esc(L.other)}">
      ${picked ? `<div class="sev-box"><div class="row"><b>${esc(label)}</b><b class="sev-val"><output id="logSevOut">${L.sev}</output> / 10</b></div>
        <div class="sev-bar" role="group" aria-label="How strong, 1 to 10">${Array.from({ length: 10 }, (_, i) => `<button class="${i < L.sev ? 'on' : ''}" data-log-sevbtn="${i + 1}" aria-label="${i + 1} out of 10" aria-pressed="${i + 1 === L.sev}"></button>`).join('')}</div>
        <div class="sev-row"><span>Mild</span><span>Strong</span></div></div>` : ''}
      <label class="toggle"><span>My period started ${L.date === today() ? 'today' : 'on this day'}</span><input type="checkbox" data-log-period ${L.period ? 'checked' : ''}></label>
      <div class="row ci-foot"><div class="seg small-seg" role="tablist">${[[today(), 'Today'], [yesterday, 'Yesterday']].map(([d, l]) => `<button role="tab" aria-selected="${L.date === d}" class="${L.date === d ? 'on' : ''}" data-log-date="${d}">${l}</button>`).join('')}${(() => {
        // Any earlier day: the phone's own date picker sits invisibly over this button.
        const other = L.date !== today() && L.date !== yesterday;
        return `<label class="seg-date ${other ? 'on' : ''}" role="tab" aria-selected="${other}"><span>${other ? esc(new Date(L.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : 'Other day'}</span><input type="date" data-log-pick aria-label="Pick another day" max="${today()}" min="${addDays(today(), -730)}" value="${L.date}"></label>`;
      })()}</div>
      <button class="btn primary" data-action="log-save" ${L.saving ? 'disabled' : ''}>${L.saving ? 'Saving…' : 'Save'}</button></div>`;
  }
  async function saveQuickLog() {
    const L = ui.log;
    const syms = [...L.syms, ...(L.other.trim() ? [L.other.trim()] : [])];
    if (!L.mood && !syms.length && !L.period) { toast('Pick a feeling, a symptom or your period first'); return; }
    L.saving = true; renderSheet();
    try {
      if (L.mood) await tool('log_feeling', { date: L.date, feeling: L.mood });
      if (syms.length) await tool('log_symptoms', { date: L.date, symptoms: syms.map(name => ({ name: name.toLowerCase(), severity: L.sev })) });
      if (L.period) await tool('log_period_start', { date: L.date });
      const parts = [L.mood && `feeling ${L.mood.toLowerCase()}`, syms.length && `${syms.join(', ').toLowerCase()} (${L.sev}/10)`, L.period && 'period start'].filter(Boolean);
      ui.sheet = null; ui.insightTried = false; ui.insight = '';
      toast(`Logged ${parts.join(' · ')} ✓`);
      render();
      setTimeout(maybeCircleReady, 700); // their third check-in may have just opened the Circle
      maybeStoryOffer();
    } catch (e) { L.saving = false; toast(e.message); renderSheet(); }
  }
  // Welcome: one promise, pick what's hardest, pick a check-in time, then straight into the chat.
  const obSteps = () => ['hello', 'circle', 'symptoms', 'time'];
  const needsName = () => !user.profile.name && !user.account && !(ui.obName || '').trim();
  function welcomeHtml() {
    const steps = obSteps();
    const step = steps[Math.min(ui.ob, steps.length - 1)], last = ui.ob >= steps.length - 1;
    const canRemind = pushSupported() && (!isIOS() || isStandalone()) && Notification.permission !== 'denied';
    if (!ui.obSyms) ui.obSyms = [...((user.community && user.community.focus) || [])];
    const body = {
      hello: `<div class="ob-art"><img src="/icons/logo-256.png" alt="" class="ob-icon"></div>
        <h2 id="sheetTitle" class="ob-title">Perimenopause is a lot. Text it to Cura.</h2>
        <div class="ob-values"><span>📝 Track by just texting</span><span>💡 Tips that fit you</span><span>🩺 Ready for your doctor</span></div>
        <div class="ob-demo" aria-hidden="true"><div class="msg me tail">hot flashes again, like a 7 😩</div><div class="msg them tail">Ugh, third night this week. Want a quick tip for tonight?</div><div class="msg-meta"><span class="msg-saved">${CHECK_SVG}Saved: hot flashes 7/10</span></div></div>
        ${ui.googleId ? `${accountBlock()}<p class="ob-hint">Already use Cura? Sign in to bring everything back.</p>` : ''}`,
      circle: `${circleArt()}
        <h2 id="sheetTitle" class="ob-title">Your Circle</h2>
        <p class="ob-text">A small private group of women going through the same thing.</p>
        <ul class="ob-points"><li><span>🔓</span>Opens after 3 check-ins</li><li><span>🎯</span>Matched on what you're going through</li><li><span>🙈</span>First name or anonymous, your choice</li></ul>`,
      symptoms: `<h2 id="sheetTitle" class="ob-title">What's been hardest lately?</h2>
        <p class="ob-text">Pick up to 3. Cura starts there, and uses them to match your Circle.</p>
        <div class="chipset ob-chips">${COMMON_SYMPTOMS.map(n => `<button class="chip ${ui.obSyms.includes(n) ? 'on' : ''}" data-ob-sym="${esc(n)}" aria-pressed="${ui.obSyms.includes(n)}">${esc(n)}</button>`).join('')}</div>`,
      time: `<h2 id="sheetTitle" class="ob-title">When should Cura check in?</h2>
        <p class="ob-text">A gentle nudge once a day, skipped if you've checked in.</p>
        <div class="ob-times">${[[8, '☀️', 'Morning', '8 AM'], [20, '🌙', 'Evening', '8 PM']].map(([h, e, l, t]) => `<button class="ob-time ${ui.obHour === h || (user.reminder && user.reminder.enabled && user.reminder.hour === h) ? 'on' : ''}" data-action="ob-time" data-hour="${h}" ${ui.reminderBusy ? 'disabled' : ''}><span aria-hidden="true">${e}</span><b>${l}</b><small>${t}</small></button>`).join('')}</div>
        ${canRemind ? '' : `<p class="ob-hint">${isIOS() ? 'iPhone only allows reminders once Cura is on your Home Screen. Add it from Safari\'s Share menu, then turn this on in <b>Me</b>.' : 'This browser can\'t show reminders. You can still check in anytime.'}</p>`}
        ${user.profile.name || user.account ? '' : `<label class="ob-name-label" for="obName">What should Cura call you?</label>
        <input class="input" id="obName" data-ob-name maxlength="60" autocomplete="given-name" enterkeyhint="done" placeholder="Your first name" value="${esc(ui.obName || '')}" aria-required="true" ${ui.obNameErr ? 'aria-invalid="true" aria-describedby="obNameErr"' : ''}>
        ${ui.obNameErr ? `<p class="ob-err" id="obNameErr" role="alert">Add your first name${ui.googleId ? ', or sign in with Google below' : ''} to start.</p>` : ''}
        ${ui.googleId ? `<p class="ob-or">or</p>${accountBlock()}` : ''}`}`
    }[step];
    const next = step === 'hello' ? (user.account ? 'Next' : 'Try it first') : last ? 'Start chatting' : step === 'circle' || ui.obSyms.length ? 'Next' : 'Skip for now';
    const slide = ui.obDir ? ` slide-${ui.obDir}` : ''; ui.obDir = '';
    return `<div class="ob${slide}">${body}</div>
      <div class="dots-row" aria-hidden="true">${steps.map((_, i) => `<i class="${i === ui.ob ? 'on' : ''}"></i>`).join('')}</div>
      <div class="row">${ui.ob ? '<button class="btn ghost" data-action="ob-back">Back</button>' : '<span></span>'}<button class="btn primary ob-next" data-action="${last ? 'sheet-close' : 'ob-next'}">${next}</button></div>`;
  }
  // Moves the tour one step (the buttons and swipes both use this): the current step slides out, the next slides in.
  // It never finishes the tour: that stays a button tap.
  let obMoving = false;
  function obGo(dir) {
    const to = ui.ob + dir, o = $('.sheet .ob');
    if (obMoving || to < 0 || to > obSteps().length - 1) { if (o) springBack(o); return; }
    const done = () => { obMoving = false; ui.ob = to; ui.obDir = dir > 0 ? 'next' : 'back'; renderSheet(); };
    if (!o || matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    obMoving = true;
    o.style.transition = 'transform .2s cubic-bezier(.4,0,1,1), opacity .2s ease-in';
    o.style.transform = `translateX(${dir > 0 ? -60 : 60}%)`; o.style.opacity = '0';
    setTimeout(done, 190);
  }
  function springBack(o) {
    o.style.transition = 'transform .35s cubic-bezier(.2,.9,.3,1.2), opacity .25s ease';
    o.style.transform = ''; o.style.opacity = '';
  }
  // Swipe left for the next step, right for the previous one. The step follows the finger, like turning a card.
  let obTouch = null;
  document.addEventListener('touchstart', e => {
    const sheet = e.target.closest && e.target.closest('.sheet.welcome');
    obTouch = sheet && !obMoving && e.touches.length === 1 && !e.target.closest('input, textarea, select, .g-btn') ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), drag: null } : null;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    const s = obTouch; if (!s || ui.sheet !== 'welcome') return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (s.drag === null && Math.abs(dx) + Math.abs(dy) > 8) s.drag = Math.abs(dx) > Math.abs(dy) * 1.2; // decide once: sideways swipe or a scroll
    if (!s.drag) return;
    const o = $('.sheet .ob'); if (!o) return;
    const edge = (dx > 0 && ui.ob === 0) || (dx < 0 && ui.ob >= obSteps().length - 1);
    const move = edge ? dx * 0.25 : dx; // stretchy at the first and last step
    o.style.transition = 'none';
    o.style.transform = `translateX(${move}px)`; o.style.opacity = String(1 - Math.min(0.6, Math.abs(move) / 500));
  }, { passive: true });
  document.addEventListener('touchend', e => {
    const s = obTouch; obTouch = null;
    if (!s || !s.drag || ui.sheet !== 'welcome' || !e.changedTouches.length) return;
    const o = $('.sheet .ob');
    const dx = e.changedTouches[0].clientX - s.x, speed = Math.abs(dx) / Math.max(1, Date.now() - s.t);
    if (Math.abs(dx) > 80 || (Math.abs(dx) > 30 && speed > 0.45)) obGo(dx < 0 ? 1 : -1); // far enough, or a quick flick
    else if (o) springBack(o);
  }, { passive: true });
  document.addEventListener('touchcancel', () => { obTouch = null; const o = $('.sheet .ob'); if (o) springBack(o); }, { passive: true });
  // Saves the tour's answers once they finish (or close it): the name, and the symptoms as their starting focus.
  function saveObName() {
    const name = (ui.obName || '').trim();
    if (name && name !== user.profile.name) { user.profile.name = name; saveCache(); tool('save_profile', { name }).catch(() => {}); }
    const picks = ui.obSyms || [];
    if (picks.length && picks.join('|') !== ((user.community && user.community.focus) || []).join('|')) {
      user.community = { ...user.community, focus: picks }; saveCache();
      api('community-settings', { focus: picks }, { keepUser: true }).catch(() => {});
    }
  }
  // iOS 26 Safari can keep the dimmed backdrop's grey in the top bar after a panel closes (a WebKit bug).
  // Swapping in a fresh theme-color tag and nudging the page makes it re-read the page colour.
  function refreshTopBar() {
    const old = $('#themeColor'); if (!old) return;
    const fresh = old.cloneNode(); old.replaceWith(fresh);
    requestAnimationFrame(() => { const y = window.scrollY; window.scrollTo(0, y + 1); window.scrollTo(0, y); });
  }
  function renderSheet() {
    const root = $('#sheet');
    if (!root) return;
    const open = !!ui.sheet;
    const wasOpenBefore = document.body.classList.contains('sheet-open');
    document.body.classList.toggle('sheet-open', open);
    if (!open) { root.innerHTML = ''; if (wasOpenBefore) refreshTopBar(); return; }
    const wasOpen = !!root.querySelector('.sheet'), top = wasOpen ? root.querySelector('.sheet').scrollTop : 0;
    root.innerHTML = `<div class="sheet-backdrop" data-action="sheet-close"></div>
      <div class="sheet ${ui.sheet === 'welcome' ? 'welcome' : ''} ${wasOpen ? 'still' : ''}" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"><div class="grabber" aria-hidden="true"></div>${({ log: quickLogHtml, welcome: welcomeHtml, cm: cmSettingsHtml, cal: calSheetHtml, account: accountSheetHtml, install: installSheetHtml, story: storyInviteHtml, moved: movedSheetHtml, 'circle-ready': circleReadyHtml }[ui.sheet] || meSheetHtml)()}</div>`;
    if (wasOpen) root.querySelector('.sheet').scrollTop = top; // a redraw keeps your place in the sheet
    else root.querySelector('.sheet button, .sheet input')?.focus({ preventScroll: true });
    renderGoogleButtons();
  }

  // ---------- Doctor summary (print / save as PDF) ----------
  function renderReport() {
    const from = addDays(today(), -89), p = user.profile;
    const syms = user.symptoms.filter(s => s.date >= from).sort((a, b) => b.date.localeCompare(a.date));
    const top = topSymptoms(syms);
    const starts = sortedStarts();
    const checks = user.checkins.filter(c => c.date >= from).sort((a, b) => b.date.localeCompare(a.date));
    const maxSev = name => Math.max(0, ...syms.filter(s => s.name.trim().toLowerCase() === name.toLowerCase()).map(s => Number(s.severity) || 0));
    const raise = [...user.preNotes.map(n => n.text), ...user.agenda.topics, ...user.agenda.questions].filter(Boolean);
    const table = (head, rows, empty) => rows.length ? `<table class="rtable"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>` : `<p class="muted small">${empty}</p>`;
    return `<div class="page report">
      <div class="row no-print" style="margin-bottom:14px"><button class="btn ghost" data-route="visit">← Back</button><button class="btn primary" data-action="print">Print / Save as PDF</button></div>
      <div class="report-head"><div class="brand"><img class="brand-mark" src="/icons/logo-256.png" alt=""><span class="brand-name">cura</span></div>
        <h1 class="title" style="font-size:26px">Symptom & cycle summary${p.name ? ' · ' + esc(p.name) : ''}</h1>
        <p class="sub">${fmt(from, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(today(), { month: 'short', day: 'numeric', year: 'numeric' })} · made ${fmt(today(), { month: 'short', day: 'numeric', year: 'numeric' })}${p.appointmentDate ? ` · for the appointment on ${fmtLong(p.appointmentDate)}${p.clinician ? ' with ' + esc(p.clinician) : ''}` : ''}</p></div>
      ${ui.storyOn && storyRows().length ? `<section class="rsec"><h2>My background</h2><table class="rtable"><tbody>${storyRows().map(([l, v]) => `<tr><th scope="row">${esc(l)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></section>` : ''}
      ${user.agenda.summary ? `<section class="rsec"><h2>In my words</h2><p>${esc(user.agenda.summary)}</p></section>` : ''}
      <section class="rsec"><h2>Symptoms at a glance</h2>${table(['Symptom', 'Days noticed', 'Average', 'Strongest'], top.map(t => [esc(cap(t.name)), t.days.size, t.sevN ? avgText(t.sevSum, t.sevN) : '—', maxSev(t.name) ? maxSev(t.name) + '/10' : '—']), 'No symptoms logged in this period.')}</section>
      <section class="rsec"><h2>Periods</h2>${table(['Started', 'Days since previous'], [...starts].reverse().slice(0, 12).map((c, i, arr) => [fmtLong(c.date), arr[i + 1] ? diffDays(arr[i + 1].date, c.date) : '—']), 'No period starts logged.')}</section>
      ${raise.length ? `<section class="rsec"><h2>What I want to discuss</h2><ul>${raise.slice(0, 12).map(r => `<li>${esc(r)}</li>`).join('')}</ul></section>` : ''}
      <section class="rsec"><h2>Symptom log</h2>${table(['Date', 'Symptom', 'Intensity', 'Notes'], syms.slice(0, 60).map(s => [fmt(s.date), esc(cap(s.name)), s.severity ? s.severity + '/10' : '—', esc([s.impact, s.notes].filter(Boolean).join('; '))]), 'Nothing logged yet.')}</section>
      ${checks.length ? `<section class="rsec"><h2>How I've been feeling</h2>${table(['Date', 'Check-in'], checks.slice(0, 20).map(c => [fmt(c.date), esc(c.feeling)]), '')}</section>` : ''}
      <p class="note">Recorded by the patient with Cura, a personal tracking app. Not a medical record or diagnosis.</p>
    </div>`;
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

  // ---------- Voice: talk instead of typing ----------
  // With the server's transcription (OpenAI) it records a short clip; otherwise it uses the browser's own speech
  // recognition, which iPhone doesn't offer inside Home Screen apps. Either way the words land in the text box so
  // they can check them before sending.
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const voiceMode = () => (ui.voice && canRecord() ? 'server' : SpeechRec && !isStandalone() ? 'browser' : '');
  const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
  const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const INFO_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></svg>';
  const BOOK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>';
  const micBtn = forId => (voiceMode() ? `<button class="send mic" type="button" data-action="voice-start" data-for="${forId}" aria-label="Talk instead of typing">${MIC_SVG}</button>` : '');
  // The server says whether its transcription is on only after the first paint; add the mic without a redraw (keeps typed text).
  function addMics() {
    if (!voiceMode()) return;
    for (const [formId, boxId] of [['composer', 'msgInput'], ['groupComposer', 'groupInput']]) {
      const f = document.getElementById(formId);
      if (f && !f.querySelector('.mic')) { f.classList.add('can-voice'); f.querySelector('.send-go').insertAdjacentHTML('beforebegin', micBtn(boxId)); }
    }
  }
  const VOICE_MAX_S = 120;
  let rec = null; // the recording in progress: { box, form, mode, stream, recorder, chunks, recog, ac, analyser, raf, text, live, started, timer }
  const clock = s => `${Math.floor(s / 60)}:${pad(s % 60)}`;
  const X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const WAVE_BARS = 28;
  function drawRec(state) {
    const r = rec; if (!r) return;
    let bar = r.form.querySelector('.rec-bar');
    if (!bar) { bar = document.createElement('div'); bar.className = 'rec-bar'; r.form.appendChild(bar); }
    r.form.classList.add('recording');
    if (state === 'busy') { bar.innerHTML = '<div class="rec-row"><span class="rec-busy" aria-hidden="true"><i></i><i></i><i></i></span><span class="rec-label" role="status">Writing it down…</span></div>'; return; }
    // Built once, then only the timer, the words and the wave change (so taps on ✓ never miss).
    if (!bar.querySelector('.rec-wave')) bar.innerHTML = `<div class="rec-live" aria-live="polite" hidden></div><div class="rec-row"><button type="button" class="rec-x" data-action="voice-cancel" aria-label="Cancel recording">${X_SVG}</button><span class="rec-dot" aria-hidden="true"></span><span class="rec-time"></span><span class="rec-wave${r.analyser ? ' live' : ''}" aria-hidden="true">${'<i></i>'.repeat(WAVE_BARS)}</span><button type="button" class="send" data-action="voice-stop" aria-label="Done talking">${CHECK_SVG}</button></div>`;
    bar.querySelector('.rec-time').textContent = clock(Math.floor((Date.now() - r.started) / 1000));
    const live = bar.querySelector('.rec-live');
    if (r.live && live.textContent !== r.live) { live.hidden = false; live.textContent = r.live; live.scrollTop = live.scrollHeight; }
  }
  // A wave that moves with their voice (when the app records the audio itself), scrolling right to left.
  function meter(r) {
    const levels = Array(WAVE_BARS).fill(0.12);
    const data = new Uint8Array(r.analyser.fftSize);
    let last = 0;
    const tick = t => {
      if (rec !== r || r.stopping) return;
      r.raf = requestAnimationFrame(tick);
      if (t - last < 70) return;
      last = t;
      r.analyser.getByteTimeDomainData(data);
      let sum = 0; for (const v of data) sum += (v - 128) * (v - 128);
      const level = Math.sqrt(sum / data.length);
      if (r.ac && r.ac.state === 'running') { r.heard = true; if (level > 6) r.voiced = (r.voiced || 0) + 1; } // about 70ms of real sound each
      levels.shift(); levels.push(Math.max(0.12, Math.min(1, level / 28)));
      const bars = r.form.querySelectorAll('.rec-wave i');
      bars.forEach((b, i) => { b.style.height = `${Math.round(levels[i] * 100)}%`; });
    };
    r.raf = requestAnimationFrame(tick);
  }
  function endVoice() {
    const r = rec; rec = null; if (!r) return;
    clearInterval(r.timer);
    if (r.raf) cancelAnimationFrame(r.raf);
    if (r.ac) r.ac.close().catch(() => {});
    if (r.stream) r.stream.getTracks().forEach(t => t.stop());
    r.form.classList.remove('recording');
    const bar = r.form.querySelector('.rec-bar'); if (bar) bar.remove();
  }
  function putText(box, text) {
    text = String(text || '').trim();
    if (!text || !document.body.contains(box)) return false;
    box.value = box.value.trim() ? `${box.value.trimEnd()} ${text}` : text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    if (!matchMedia('(pointer: coarse)').matches) box.focus(); // on a phone that would shift the layout without opening the keyboard
    return true;
  }
  // Checks the recording itself before sending it: transcription services invent words from silence, so a clip
  // with under ~0.3s of voice-level sound isn't sent. If the phone can't decode it, it's sent as before.
  async function hasSpeech(blob) {
    try {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!OAC) return true;
      const buf = await new OAC(1, 16000, 16000).decodeAudioData(await blob.arrayBuffer());
      const data = buf.getChannelData(0), win = Math.round(buf.sampleRate * 0.02);
      let loud = 0;
      for (let i = 0; i + win <= data.length; i += win) {
        let sum = 0; for (let j = i; j < i + win; j++) sum += data[j] * data[j];
        if (Math.sqrt(sum / win) > 0.02) loud++;
      }
      return loud >= 15;
    } catch { return true; }
  }
  const toB64 = blob => new Promise((ok, fail) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(',')[1] || ''); f.onerror = fail; f.readAsDataURL(blob); });
  async function startVoice(forId) {
    if (rec) return;
    const box = document.getElementById(forId), form = box && box.form, mode = voiceMode();
    if (!form || !mode) return;
    rec = { box, form, mode, chunks: [], text: '', live: '', started: Date.now() };
    const AC = window.AudioContext || window.webkitAudioContext;
    if (mode === 'server' && AC) try { rec.ac = new AC(); rec.ac.resume(); } catch {} // made inside the tap, or iPhone keeps it silent
    try {
      if (mode === 'server') {
        rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (rec.ac) try { rec.analyser = rec.ac.createAnalyser(); rec.analyser.fftSize = 512; rec.ac.createMediaStreamSource(rec.stream).connect(rec.analyser); } catch { rec.analyser = null; }
        const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
        rec.recorder = new MediaRecorder(rec.stream, type ? { mimeType: type } : undefined);
        rec.recorder.ondataavailable = e => { if (rec && e.data && e.data.size) rec.chunks.push(e.data); };
        rec.recorder.start(500);
      } else {
        const g = new SpeechRec();
        g.lang = navigator.language || 'en-US'; g.continuous = true; g.interimResults = true;
        // Safari hands back phrases without spaces between them ("preciselyRight"), so join them with one.
        const join = parts => parts.map(x => x.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ');
        g.onresult = e => { if (!rec) return; const fin = [], live = []; for (const res of e.results) (res.isFinal ? fin : live).push(res[0].transcript); rec.text = join(fin); rec.live = join([...fin, ...live]); drawRec(); };
        g.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Allow the microphone for Cura to talk instead of typing.'); if (rec && rec.recog === g && e.error !== 'no-speech') endVoice(); };
        g.onend = () => { if (rec && rec.recog === g) rec.ended = true; };
        g.start(); rec.recog = g;
      }
    } catch (e) {
      endVoice();
      toast(e && e.name === 'NotAllowedError' ? "Cura can't use the microphone. Allow it in your phone's Settings, then try again." : "Couldn't start the microphone.");
      return;
    }
    rec.timer = setInterval(() => { if (!rec) return; if ((Date.now() - rec.started) / 1000 >= VOICE_MAX_S) stopVoice(false); else drawRec(); }, 500);
    drawRec();
    if (rec.analyser) meter(rec);
  }
  async function stopVoice(cancel) {
    const r = rec; if (!r || r.stopping) return;
    r.stopping = true; clearInterval(r.timer);
    if (r.mode === 'server') await new Promise(done => { r.recorder.onstop = done; try { r.recorder.stop(); } catch { done(); } });
    else {
      try { r.recog.stop(); } catch {}
      for (let i = 0; i < 15 && !r.ended; i++) await new Promise(x => setTimeout(x, 100)); // last words arrive just after stopping
    }
    if (cancel) { endVoice(); return; }
    if (r.mode === 'browser') { endVoice(); if (!putText(r.box, r.text || r.live)) toast("I didn't catch that. Try again?"); return; }
    const blob = new Blob(r.chunks, { type: (r.recorder.mimeType || 'audio/mp4').split(';')[0] });
    if (r.stream) r.stream.getTracks().forEach(t => t.stop());
    // Nobody spoke (the level meter was running and heard under ~0.3s of sound): don't send silence to be transcribed,
    // which can come back as made-up words.
    if (blob.size < 2000 || (r.heard && (r.voiced || 0) < 4) || !(await hasSpeech(blob))) { endVoice(); toast("I didn't hear anything. Try again?"); return; }
    drawRec('busy');
    try {
      const d = await api('transcribe', { audio: await toB64(blob), type: blob.type }, { keepUser: true });
      endVoice();
      if (!putText(r.box, d.text)) toast("I didn't catch that. Try again?");
    } catch (e) { endVoice(); toast(e.message); }
  }

  // ---------- Your story ----------
  async function startStory() {
    ui.sheet = null; renderSheet();
    if (route !== 'chat') go('chat');
    try { await api('story-start'); } catch (e) { toast(e.message); }
    if (route === 'chat') refreshThread(); else render();
  }
  // The invitation (see story.js): a pop-up once it's their time, then a card on Today until they start.
  const storyWaiting = () => !!(ui.storyOn && user.story && user.story.offeredAt && !user.story.startedAt);
  async function maybeStoryOffer() {
    if (!ui.storyOn) return;
    const s = user.story || {};
    if (!s.offeredAt && !s.startedAt && (user.transcript || []).length) {
      try { const d = await api('story-offer', {}, { keepUser: true }); if (d.offered) setUser(d.user); } catch {}
    }
    showStoryPopup();
  }
  function showStoryPopup() {
    const s = user.story || {};
    if (!storyWaiting() || s.popupAt || ui.sheet || ui.sending || ui.bigMoment || route === 'community' || $('#coach .coach-ring')) return; // one big moment per visit, never over the Circle
    ui.sheet = 'story'; ui.bigMoment = true; renderSheet();
    user.story.popupAt = new Date().toISOString(); // shown once, even before the server confirms
    api('story-seen', {}, { keepUser: true }).then(d => setUser(d.user)).catch(() => {});
  }
  function storyInviteHtml() {
    return `<div class="ob"><div class="ob-art"><img src="/icons/logo-256.png" alt="" class="ob-icon"></div>
      <h2 id="sheetTitle" class="ob-title">Help Cura get to know you</h2>
      <p class="ob-text">A few quick questions so Cura can tailor her tips and find your Circle.</p>
      <div class="story-perks"><span>⏱️ About 3 min</span><span>🎙️ Talk or type</span><span>👋 Skip anything</span></div></div>
      <div class="story-actions"><button class="btn primary" data-action="story-go">Let's do it</button><button class="btn ghost" data-action="story-later">Maybe later</button></div>`;
  }
  function movedSheetHtml() {
    return `<div class="ob"><div class="ob-art"><img src="/icons/logo-256.png" alt="" class="ob-icon"></div>
      <h2 id="sheetTitle" class="ob-title">Cura has a new home</h2>
      <p class="ob-text">Cura now lives at <b>${NEW_HOST}</b>. Open it and add it to your Home Screen again. Your notes come with you.</p></div>
      <div class="story-actions"><a class="btn primary" href="${esc(moveLink())}" target="_blank" rel="noopener">Open ${NEW_HOST}</a><button class="btn ghost" data-action="sheet-close">Not now</button></div>`;
  }
  function storyCard() {
    if (!storyWaiting()) return '';
    return `<button class="card story-nudge" data-action="story-go"><span class="sn-ico" aria-hidden="true">💜</span><span class="sn-text"><b>Help Cura get to know you</b><span>3 minutes · talk or type</span></span><span class="sn-go" aria-hidden="true">›</span></button>`;
  }
  const STORY_LABELS = [['symptoms_started', 'Changes started'], ['periods', 'Periods'], ['last_period', 'Last period'], ['hardest_symptoms', 'Affects me most'], ['tried', 'Tried so far'], ['medical', 'Medical background'], ['family', "Mum's menopause"], ['age', 'Age'], ['hopes', 'Wants help with']];
  const PERIODS_LABEL = { regular: 'Still regular', changing: 'Changing (length varies by a week or more)', skipping: 'Skipping (60+ days between some)', stopped: 'Stopped (12+ months)', not_sure: 'Not sure', not_applicable: "Can't tell (hysterectomy, IUD, pill or similar)" };
  function storyRows() {
    const f = (user.story && user.story.fields) || {};
    return STORY_LABELS.filter(([k]) => f[k] != null && f[k] !== '' && f[k] !== '(skipped)' && !(Array.isArray(f[k]) && !f[k].length))
      .map(([k, l]) => [l, k === 'periods' ? PERIODS_LABEL[f[k]] || f[k] : Array.isArray(f[k]) ? f[k].join(', ') : String(f[k])]);
  }

  // ---------- Events ----------
  async function guarded(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message); } render(); }

  document.addEventListener('click', async e => {
    const r = e.target.closest('[data-route]');
    if (r) { e.preventDefault(); go(r.dataset.route); return; }
    const chip = e.target.closest('[data-chip]');
    if (chip) { sendMessage(chip.dataset.chip); return; }
    const qr = e.target.closest('[data-qr]');
    if (qr) { ui.multi = []; sendMessage(qr.dataset.qr); return; }
    const qt = e.target.closest('[data-qr-toggle]');
    if (qt) { const o = qt.dataset.qrToggle, i = ui.multi.indexOf(o); if (i >= 0) ui.multi.splice(i, 1); else ui.multi.push(o); refreshThread(); return; }
    if (e.target.closest('[data-qr-done]') && ui.multi.length) { const t = ui.multi.join(', '); ui.multi = []; sendMessage(t); return; }
    const day = e.target.closest('[data-day]');
    if (day) { ui.selDay = day.dataset.day; ui.showSymForm = false; render(); return; }
    const me = e.target.closest('[data-me]');
    if (me) { if (me.dataset.me === 'account') store.set(ACCT_KEY, '1'); ui.sheet = 'me-' + me.dataset.me; if (me.dataset.me === 'account') ui.sheet = 'account'; renderSheet(); return; }
    const tp = e.target.closest('[data-theme-pick]');
    if (tp) { applyTheme(tp.dataset.themePick); if (ui.sheet) renderSheet(); else render(); return; }
    const vt = e.target.closest('[data-visit]');
    if (vt) { ui.visitTab = vt.dataset.visit; render(); return; }
    const cf = e.target.closest('[data-cm-focus]');
    if (cf && ui.cm.join) { const n = cf.dataset.cmFocus, F = ui.cm.join.focus, i = F.indexOf(n); if (i >= 0) F.splice(i, 1); else F.push(n); renderInPlace(); return; }
    const can = e.target.closest('[data-cm-anon]');
    if (can && ui.cm.join) { ui.cm.join.anonymous = can.dataset.cmAnon === '1'; renderInPlace(); return; }
    const ctab = e.target.closest('[data-cm-tab]');
    if (ctab) { ui.cm.tab = ctab.dataset.cmTab; render(); if (ui.cm.tab === 'ideas') loadIdeas(); else loadGroup(false); return; }
    const fe = e.target.closest('[data-cm-fedit]');
    if (fe && ui.cm.focusEdit) { const n = fe.dataset.cmFedit, F = ui.cm.focusEdit, i = F.indexOf(n); if (i >= 0) F.splice(i, 1); else F.push(n); renderSheet(); return; }
    const capp = e.target.closest('[data-cm-appear]');
    if (capp && !capp.disabled) {
      try { await api('community-settings', { anonymous: capp.dataset.cmAppear === '1' }); toast('Saved'); await loadGroup(true); } catch (err) { toast(err.message); }
      renderSheet(); return;
    }
    const ro = e.target.closest('[data-react-open]');
    if (ro) { ui.cm.reactFor = ui.cm.reactFor === ro.dataset.reactOpen ? '' : ro.dataset.reactOpen; refreshGroup(false); return; }
    const rx = e.target.closest('[data-react]');
    if (rx) { react(rx.dataset.msg, rx.dataset.react); return; }
    const ca = e.target.closest('[data-cta-action]');
    if (ca && ca.dataset.ctaAction === 'story-start') { startStory(); return; }
    if (ca && ca.dataset.ctaAction === 'draft-agenda') {
      ui.visitTab = 'agenda'; ui.drafting = true; go('visit');
      try { await api('draft', { mode: 'prep' }); toast('Agenda ready. Edit anything you like.'); } catch (err) { toast(err.message); }
      ui.drafting = false; render(); return;
    }
    const os = e.target.closest('[data-ob-sym]');
    if (os) { const n = os.dataset.obSym, F = ui.obSyms, i = F.indexOf(n); if (i >= 0) F.splice(i, 1); else if (F.length < 3) F.push(n); else toast('Pick up to 3 for now'); renderSheet(); return; }
    const sb = e.target.closest('[data-log-sevbtn]');
    if (sb && ui.log) { ui.log.sev = Number(sb.dataset.logSevbtn); renderSheet(); return; }
    if (ui.log && ui.sheet === 'log') {
      const mood = e.target.closest('[data-mood]'), sym = e.target.closest('[data-sym]'), ld = e.target.closest('[data-log-date]');
      if (mood) { ui.log.mood = ui.log.mood === mood.dataset.mood ? '' : mood.dataset.mood; renderSheet(); return; }
      if (sym) { const n = sym.dataset.sym, i = ui.log.syms.indexOf(n); if (i >= 0) ui.log.syms.splice(i, 1); else ui.log.syms.push(n); renderSheet(); return; }
      if (ld) { ui.log.date = ld.dataset.logDate; renderSheet(); return; }
    }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act !== 'reset') ui.confirmReset = false;
    if (act !== 'cm-leave') ui.cm.confirmLeave = false;
    if (act !== 'sign-out') ui.confirmSignOut = false;
    if (act === 'retry') { const t = ui.failed; ui.failed = ''; sendMessage(t); }
    else if (act === 'voice-start') startVoice(a.dataset.for);
    else if (act === 'story-go') startStory();
    else if (act === 'story-test') {
      guarded(async () => { setUser((await api('story-group', { arm: a.dataset.arm }, { keepUser: true })).user); ui.sheet = null; },
        a.dataset.arm === 'early' ? 'Set. It pops up once you\'ve sent Cura 2 messages.' : 'Set. The pop-up comes when you open Cura tomorrow.');
    }
    else if (act === 'circle-meet') { ui.sheet = null; renderSheet(); go('community'); }
    else if (act === 'story-later') {
      closeSheet(); toast("No problem. It's on your Today page whenever you're ready.");
      api('story-later', {}, { keepUser: true }).then(d => setUser(d.user)).catch(() => {});
    }
    else if (act === 'me-name-save') {
      const name = ($('#meName')?.value || '').trim();
      if (!name) { toast('Add your first name'); return; }
      guarded(async () => { await tool('save_profile', { name }); ui.sheet = null; }, 'Saved');
    }
    else if (act === 'voice-stop') stopVoice(false);
    else if (act === 'voice-cancel') stopVoice(true);
    else if (act === 'older') loadOlder();
    else if (act === 'quick-log') openQuickLog(a.dataset.date, a.dataset.period === '1');
    else if (act === 'sheet-close') closeSheet();
    else if (act === 'log-save') saveQuickLog();
    else if (act === 'ob-next') obGo(1);
    else if (act === 'ob-back') obGo(-1);
    else if (act === 'show-welcome') { ui.ob = 0; ui.obSyms = null; ui.sheet = 'welcome'; renderSheet(); }
    else if (act === 'ob-time') {
      const hour = Number(a.dataset.hour); ui.obHour = hour;
      const canRemind = pushSupported() && (!isIOS() || isStandalone()) && Notification.permission !== 'denied';
      ui.reminderBusy = canRemind; renderSheet();
      try {
        if (canRemind) { await enableReminders(hour); toast(`Cura will check in around ${hourLabel(hour)} 💜`); }
        else await api('reminder', { hour, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }, { keepUser: true });
      } catch (err) { toast(err.message); }
      ui.reminderBusy = false; renderSheet();
    }
    else if (act === 'install' && installPrompt) { installPrompt.prompt(); installPrompt.userChoice.finally(() => { installPrompt = null; render(); }); }
    else if (act === 'dismiss-tip') { store.set(TIP_KEY, '1'); render(); }
    else if (act === 'install-open') { ui.sheet = 'install'; renderSheet(); }
    else if (act === 'install-later') closeSheet();
    else if (act === 'tips-again') { store.del(TIPS_KEY); toast('Tips are back. Have a look around 💜'); go('chat'); }
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
    else if (act === 'cm-join') {
      const J = ui.cm.join;
      if (!J || J.busy) return;
      if (!J.focus.length) { toast('Pick at least one thing to talk about'); return; }
      if (!J.anonymous && !J.name.trim()) { toast('Add your first name, or choose Anonymously'); $('#cmName')?.focus(); return; }
      J.busy = true; render();
      try {
        const d = await api('community-join', { focus: J.focus, anonymous: J.anonymous, name: J.name.trim() });
        ui.cm = { ...freshCm(), group: d.group, messages: d.messages || [], loaded: true };
        toast(`Welcome to ${d.group ? d.group.name : 'your group'} 💚`);
      } catch (err) { J.busy = false; toast(err.message); }
      render();
    }
    else if (act === 'cm-settings') { ui.cm.focusEdit = null; ui.cm.confirmLeave = false; ui.sheet = 'cm'; renderSheet(); if (!ui.cm.group) loadGroup(true); }
    else if (act === 'cm-focus-save') {
      try { await api('community-settings', { focus: ui.cm.focusEdit }); ui.cm.focusEdit = null; toast('Saved. Cura will use these when it sorts the groups.'); } catch (err) { toast(err.message); }
      renderSheet();
    }
    else if (act === 'cm-leave') {
      if (!ui.cm.confirmLeave) { ui.cm.confirmLeave = true; renderSheet(); return; }
      try { await api('community-leave'); ui.cm = freshCm(); ui.sheet = null; toast('You left the Circle. You can rejoin anytime.'); } catch (err) { toast(err.message); }
      render();
    }
    else if (act === 'cm-notice') { user.community.notice = null; render(); api('community-settings', { clearNotice: true }, { keepUser: true }).catch(() => {}); }
    else if (act === 'cm-ideas') { ui.cm.tab = 'ideas'; go('community'); loadIdeas(); }
    else if (act === 'plan-add') {
      a.disabled = true;
      try {
        await api('plan-add', { tipId: a.dataset.tip });
        if (ui.cm.ideas) ui.cm.ideas = ui.cm.ideas.filter(i => i.id !== a.dataset.tip);
        toast("Added to your plan 🌿 You'll see it on Today");
      } catch (err) { toast(err.message); }
      if (route === 'chat') refreshThread(); else render();
    }
    else if (act === 'tip-hide') {
      if (ui.cm.ideas) ui.cm.ideas = ui.cm.ideas.filter(i => i.id !== a.dataset.tip);
      render();
      api('tip-hide', { tipId: a.dataset.tip }).catch(err => toast(err.message));
    }
    else if (act === 'idea-visit') guarded(() => tool('add_visit_note', { text: `Ask about: ${a.dataset.title} (for ${a.dataset.symptom}). Some people in the Cura Circle said it helped them.` }), 'Added to your list for your next visit');
    else if (act === 'plan-done') {
      const p = user.plan.find(x => x.id === a.dataset.id);
      if (p) { p.done = p.done.includes(today()) ? p.done.filter(d => d !== today()) : [...p.done, today()]; render(); }
      api('plan-done', { item: a.dataset.id, date: today() }).catch(err => { toast(err.message); render(); });
    }
    else if (act === 'plan-outcome') guarded(() => api('plan-outcome', { item: a.dataset.id, how: a.dataset.how }), a.dataset.how === 'not_much' ? "Thanks for telling Cura. It's off your plan now." : 'Great! It stays in your plan as a daily habit 🌿');
    else if (act === 'plan-remove') guarded(() => api('plan-remove', { item: a.dataset.id }), 'Removed from your plan');
    else if (act === 'cal-open') { ui.calTried = false; ui.sheet = 'cal'; renderSheet(); ensureCalUrl(); }
    else if (act === 'cal-copy') copy(ui.calUrl, 'Calendar link copied');
    else if (act === 'account-later') { store.set(ACCT_KEY, '1'); closeSheet(); }
    else if (act === 'sign-out') {
      if (!ui.confirmSignOut) { ui.confirmSignOut = true; if (ui.sheet) renderSheet(); else renderInPlace(); return; }
      // Your data stays in your account; this phone just starts fresh until you sign in again.
      try { window.google?.accounts.id.disableAutoSelect(); } catch {}
      store.set(ID_KEY, newId()); store.del(CACHE_KEY); store.del(OB_KEY);
      location.reload();
    }
    else if (act === 'reminder-on') {
      ui.reminderBusy = true; render();
      try { await enableReminders(); toast(`Reminder on: around ${hourLabel(user.reminder.hour)} each day`); } catch (err) { toast(err.message); }
      ui.reminderBusy = false; render();
    }
    else if (act === 'reminder-off') guarded(() => api('reminder', { enabled: false }), 'Daily reminder turned off');
    else if (act === 'test-push') guarded(async () => { const d = await api('test-push', { endpoint: ui.pushEndpoint || '' }); if (!d.sent) { ui.pushHere = 'no'; throw new Error("This phone isn't set up for reminders yet. Tap Turn on for this phone."); } }, 'Test sent. It should arrive in a few seconds.');
    else if (act === 'export') {
      const blob = new Blob([JSON.stringify(user, null, 2)], { type: 'application/json' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `cura-${today()}.json`; link.click(); URL.revokeObjectURL(link.href);
    }
    else if (act === 'reset') {
      if (!ui.confirmReset) { ui.confirmReset = true; if (ui.sheet) renderSheet(); else render(); return; }
      ui.confirmReset = false; ui.cm = freshCm(); ui.calUrl = ''; ui.sheet = null;
      guarded(async () => {
        await api('reset');
        // A true fresh start on this phone too: no old messages kept on screen, no saved copy, the welcome tour again.
        ui.older = []; ui.seen = null; ui.live = ''; ui.failed = ''; ui.multi = []; ui.obName = ''; ui.obSyms = null;
        for (const k of [CACHE_KEY, OB_KEY, ACCT_KEY, TIPS_KEY, 'cura-circle-ready-seen', 'cura-circle-visited', 'mira-moved-note']) store.del(k);
        go('chat'); ui.ob = 0; ui.sheet = 'welcome'; renderSheet();
      }, 'Everything erased');
    }
  });

  document.addEventListener('submit', e => {
    const form = e.target;
    if (form.id === 'composer') { e.preventDefault(); if (rec) return; const box = $('#msgInput'); const t = box.value; box.value = ''; autoGrow(box); $('#sendBtn').disabled = true; form.classList.remove('has-text'); sendMessage(t); return; }
    if (form.id === 'groupComposer') { e.preventDefault(); if (rec) return; const box = $('#groupInput'); const t = box.value; box.value = ''; autoGrow(box); $('#groupSend').disabled = true; form.classList.remove('has-text'); postToGroup(t); return; }
    const kind = form.dataset.form; if (!kind) return;
    e.preventDefault();
    const d = new FormData(form);
    if (kind === 'symptom') { ui.showSymForm = false; guarded(() => tool('log_symptoms', { date: d.get('date'), symptoms: [{ name: d.get('name'), severity: Number(d.get('severity')), impact: d.get('impact') }] }), 'Symptom saved'); }
    if (kind === 'pre-note') guarded(() => tool('add_visit_note', { text: d.get('text') }), 'Note added');
    if (kind === 'post-note') guarded(() => tool('add_after_visit_note', { text: d.get('text') }), 'Note saved');
  });

  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'msgInput') { autoGrow(el); $('#sendBtn').disabled = !el.value.trim(); el.form.classList.toggle('has-text', !!el.value.trim()); }
    if (el.id === 'groupInput') { autoGrow(el); $('#groupSend').disabled = !el.value.trim(); el.form.classList.toggle('has-text', !!el.value.trim()); }
    if (el.matches('[data-cm-name]') && ui.cm.join) ui.cm.join.name = el.value;
    if (el.id === 'symSev') $('#sevOut').textContent = el.value;
    if (el.matches('[data-log-other]') && ui.log) {
      const had = !!(ui.log.syms.length || ui.log.other.trim());
      ui.log.other = el.value;
      // Show the intensity slider as soon as something is typed, without losing the cursor.
      if (had !== !!(ui.log.syms.length || el.value.trim())) { const pos = el.selectionStart; renderSheet(); const box = $('[data-log-other]'); box.focus(); box.setSelectionRange(pos, pos); }
    }
    if (el.matches('[data-ob-name]')) {
      ui.obName = el.value;
      if (ui.obNameErr && el.value.trim()) { ui.obNameErr = false; const m = $('#obNameErr'); if (m) m.remove(); el.removeAttribute('aria-invalid'); }
    }
    if (el.matches('[data-log-sev]') && ui.log) { ui.log.sev = Number(el.value); $('#logSevOut').textContent = el.value; }
    if (el.dataset.edit) {
      const [field, key] = el.dataset.edit.split('.');
      if (el.dataset.index !== undefined) user[field][key][Number(el.dataset.index)] = el.value; else user[field][key] = el.value;
      if (el.tagName === 'TEXTAREA') autoGrow(el);
      saveCache(); patchSoon(field);
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && coach) { endCoach(false); return; }
    if (e.key === 'Escape' && ui.sheet) { closeSheet(); return; }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-ob-name]')) { e.preventDefault(); e.target.blur(); return; }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-me-name]')) { e.preventDefault(); $('[data-action="me-name-save"]')?.click(); return; }
    if (e.target.id === 'msgInput' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover)').matches) { e.preventDefault(); $('#composer').requestSubmit(); }
    if (e.target.id === 'groupInput' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover)').matches) { e.preventDefault(); $('#groupComposer').requestSubmit(); }
  });
  document.addEventListener('change', e => {
    if (e.target.matches && e.target.matches('[data-log-pick]') && ui.log) {
      const v = e.target.value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today()) { ui.log.date = v; renderSheet(); } else if (v > today()) toast("You can only log days that have happened");
      return;
    }
    const el = e.target;
    if (el.matches('[data-log-period]') && ui.log) { ui.log.period = el.checked; return; }
    if (el.dataset.profile) guarded(() => tool('save_profile', { [el.dataset.profile]: el.value }), 'Saved');
    if (el.matches('[data-reminder-hour]') && user.reminder && user.reminder.enabled) guarded(() => api('reminder', { hour: Number(el.value), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }), `Reminder moved to around ${hourLabel(Number(el.value))}`);
  });

  // ---------- Phone keyboard ----------
  // iOS doesn't shrink the page when the keyboard opens, it slides it up, which squeezed the chat into a sliver.
  // Size the app to the visible area instead, keep it pinned, and hide the tab bar and suggestions while typing.
  const vv = window.visualViewport;
  // Only the chat composers resize the app to the space above the keyboard. Other fields (appointment, names,
  // notes) keep the normal layout and let the phone scroll them into view; shrinking the app for those
  // pushed the tab bar to the top and left the page blank.
  // Keeps the newest message right above the box while the layout eases into its new size.
  let pinUntil = 0;
  function pinThread(ms = 360) {
    const t = $('#thread') || $('#gthread'); if (!t) return;
    const run = !pinUntil || Date.now() > pinUntil; pinUntil = Date.now() + ms;
    if (!run) return;
    const step = () => { const el = $('#thread') || $('#gthread'); if (el) el.scrollTop = el.scrollHeight; if (Date.now() < pinUntil) requestAnimationFrame(step); else pinUntil = 0; };
    requestAnimationFrame(step);
  }
  function fitViewport() {
    if (!vv) return;
    if (document.body.classList.contains('kb-open')) {
      const h = `${Math.round(vv.height)}px`;
      if (document.documentElement.style.getPropertyValue('--app-h') !== h) {
        // iPhone slides the whole page up with the keyboard; when it settles, slide the header back in rather than popping it.
        const pushed = vv.offsetTop > 20 || window.scrollY > 20;
        document.documentElement.style.setProperty('--app-h', h);
        if (pushed) { const head = $('.chat-head'); if (head) { head.classList.remove('settle'); void head.offsetWidth; head.classList.add('settle'); } }
      }
      window.scrollTo(0, 0); pinThread();
    } else document.documentElement.style.removeProperty('--app-h');
    // A sheet with a field in focus is sized to the visible area, so the keyboard never covers it.
    const sh = $('#sheet'), fit = document.body.classList.contains('field-open') && ui.sheet;
    if (sh) { sh.style.top = fit ? `${Math.round(vv.offsetTop)}px` : ''; sh.style.height = fit ? `${Math.round(vv.height)}px` : ''; sh.style.bottom = fit ? 'auto' : ''; }
  }
  const coarse = matchMedia('(pointer: coarse)').matches;
  const keyboardUp = () => !!vv && window.innerHeight - vv.height > 120;
  let boxTapAt = 0;
  document.addEventListener('pointerdown', e => { if (isTyping(e.target)) boxTapAt = Date.now(); }, true);
  // If the keyboard does open for a box that already has focus, switch to the typing layout then.
  const onViewport = () => { if (!document.body.classList.contains('kb-open') && isTyping(document.activeElement) && keyboardUp()) { document.body.classList.add('kb-open'); pinThread(); } fitViewport(); };
  if (vv) { vv.addEventListener('resize', onViewport); vv.addEventListener('scroll', fitViewport); fitViewport(); }
  const isTyping = el => el && (el.id === 'msgInput' || el.id === 'groupInput');
  const isField = el => el && el.matches && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select');
  document.addEventListener('focusin', e => {
    if (isField(e.target)) document.body.classList.add('field-open');
    // Typing layout only when a keyboard is really coming: they tapped the box (phones ignore a focus the app makes on its own).
    if (isTyping(e.target) && (!coarse || Date.now() - boxTapAt < 1500 || keyboardUp())) { document.body.classList.add('kb-open'); pinThread(); setTimeout(fitViewport, 50); }
    else if (isField(e.target) && e.target.closest('#sheet')) { setTimeout(fitViewport, 50); setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350); }
  });
  document.addEventListener('focusout', e => {
    // Wait a moment, so a tap on a button below the field lands before the layout changes back.
    if (isField(e.target)) setTimeout(() => { if (!isField(document.activeElement)) { document.body.classList.remove('field-open'); fitViewport(); } }, 150);
    if (isTyping(e.target)) setTimeout(() => { if (!isTyping(document.activeElement)) { document.body.classList.remove('kb-open'); fitViewport(); pinThread(); } }, 80);
    // iPhone sometimes leaves the page nudged up after typing in a form field; put it back.
    else if (e.target.matches && e.target.matches('input, textarea, select')) setTimeout(() => { if (!document.activeElement || !document.activeElement.matches('input, textarea, select')) window.scrollTo(0, 0); }, 120);
  });

  // ---------- Start ----------
  render();
  if (arrived.get('moved')) setTimeout(() => toast(`Cura has a new home: ${NEW_HOST} 💚`), 600);
  // Home Screen app on an old address: once, explain how to switch (it keeps working until they do).
  if (onOldHost && !store.get('mira-moved-note')) setTimeout(() => { if (!ui.sheet) { store.set('mira-moved-note', '1'); ui.sheet = 'moved'; renderSheet(); } }, 1500);
  (async () => {
    try {
      const d = await api('load');
      ui.unread = d.communityUnread || 0; updateBadge();
      ui.googleId = d.googleClientId || ''; loadGoogle();
      ui.circleOpenAll = !!d.circleOpenAll;
      if (user.reminder && user.reminder.enabled) checkPushHere();
      // Bring over entries saved by the old browser-only version of the site.
      const old = store.get(OLD_KEY);
      if (old && !hasData(user)) {
        try { const data = await api('import', { state: JSON.parse(old) }); if (data.imported) { store.set(OLD_KEY + '-imported', old); store.del(OLD_KEY); toast('Your earlier notes were moved into Cura'); } } catch {}
      }
      ui.loaded = true;
      ui.seen = null; // messages already on the server shouldn't animate in
      // On the chat screen only refresh the messages, so a half-typed message isn't wiped.
      if (route === 'chat') refreshThread(); else render();
      // First visit: a short welcome tour.
      if (!store.get(OB_KEY) && !hasData(user) && !ui.sheet) { ui.ob = 0; ui.sheet = 'welcome'; renderSheet(); }
      // People who started before accounts existed: one gentle prompt to save their Cura.
      else if (ui.googleId && !user.account && hasData(user) && !store.get(ACCT_KEY) && !ui.sheet) { ui.sheet = 'account'; renderSheet(); }
      else if (wantsInstall() && hasData(user) && !ui.sheet) { ui.sheet = 'install'; renderSheet(); }
      maybeTips();
      ui.voice = !!d.voice; ui.storyOn = !!d.story; ui.preview = !!d.preview; addMics();
      // Preview copies: ?group=early or ?group=later puts this test user in that "your story" timing group.
      const group = arrived.get('group');
      if (ui.storyOn && ['early', 'later'].includes(group) && !(user.story && user.story.startedAt)) {
        try { setUser((await api('story-group', { arm: group }, { keepUser: true })).user); toast(`Test mode: "your story" group set to ${group}`); } catch {}
        history.replaceState(null, '', location.pathname + location.hash);
      }
      setTimeout(() => { maybeCircleReady(); if (!ui.sheet) maybeStoryOffer(); }, 400);
    } catch (e) { toast('Offline: showing your last saved data'); }
  })();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
})();
