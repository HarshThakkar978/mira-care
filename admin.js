(() => {
  // Mira admin: view users, their entries and chats, and delete test users. Password is checked by /api/admin.
  const PW_KEY = 'mira-admin-pw';
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} }, del: k => { try { sessionStorage.removeItem(k); } catch {} } };
  const fmtMsg = t => esc(t).replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  const when = t => {
    if (!t) return '—';
    const d = t.length <= 10 ? new Date(t + 'T12:00:00') : new Date(t);
    const mins = (Date.now() - d) / 60000;
    if (t.length > 10 && mins < 60) return `${Math.max(1, Math.round(mins))} min ago`;
    if (t.length > 10 && mins < 1440) return `${Math.round(mins / 60)} h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  };
  const fullTime = t => (t ? new Date(t.length <= 10 ? t + 'T12:00:00' : t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const hourLabel = h => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

  let pw = store.get(PW_KEY) || '';
  let data = null, query = '', confirmId = '';

  async function api(action, extra = {}) {
    const res = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw, action, ...extra }) });
    const out = await res.json().catch(() => ({}));
    if (res.status === 401) { pw = ''; store.del(PW_KEY); }
    if (!res.ok) throw new Error(out.error || 'Something went wrong');
    return out;
  }

  const top = (extra = '') => `<div class="top"><div class="brand"><span class="brand-mark">m</span><span class="brand-name">mira admin</span></div><span class="spacer"></span>${extra}</div>`;

  function renderLogin(error = '') {
    $('#root').innerHTML = `<div class="login"><div class="card">
      ${top()}<p class="card-sub">Private dashboard for the Mira Care team.</p>
      <form id="login" class="stack"><label class="label" for="pw">Admin password</label><input class="input" id="pw" type="password" autocomplete="current-password" required autofocus>
      <button class="btn primary" type="submit">Open dashboard</button></form>
      ${error ? `<p class="err">${esc(error)}</p>` : ''}</div></div>`;
  }

  async function load() {
    $('#root').innerHTML = `${top()}<p class="muted">Loading…</p>`;
    try { data = await api('list'); store.set(PW_KEY, pw); renderList(); }
    catch (e) { renderLogin(e.message); }
  }

  function renderList() {
    const s = data.stats;
    const max = Math.max(1, ...s.perDay.map(d => d.messages));
    const tiles = [['Users', s.users], ['Active today', s.active1], ['Active this week', s.active7], ['Messages (7 days)', s.messages7], ['Symptoms logged', s.symptoms], ['Reminders on', s.reminders]]
      .map(([l, v]) => `<div class="card tile"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
    const bars = s.perDay.map(d => `<div class="col" data-tip="${esc(new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}: ${d.messages} message${d.messages === 1 ? '' : 's'}" aria-label="${esc(d.date)}: ${d.messages} messages"><div class="bar" style="height:${Math.round(d.messages / max * 100)}%"></div></div>`).join('');
    const xs = s.perDay.map((d, i) => `<span>${i % 2 === 0 || s.perDay.length < 8 ? new Date(d.date + 'T12:00:00').getDate() : ''}</span>`).join('');
    const tests = data.users.filter(u => u.test).length;
    $('#root').innerHTML = `${top('<button class="btn small ghost" data-act="refresh">Refresh</button><button class="btn small ghost" data-act="logout">Log out</button>')}
      ${tests ? `<div class="card row" style="margin-bottom:14px"><span class="small">🧪 ${tests} test user${tests === 1 ? '' : 's'} created by Claude while testing Mira.</span><button class="btn small danger" data-act="delete-test">${confirmId === 'TEST' ? 'Tap again to delete them' : 'Delete test users'}</button></div>` : ''}
      <div class="tiles">${tiles}</div>
      <div class="card"><div class="row"><h2 class="card-title">Messages to Mira per day</h2><span class="small muted">Last 14 days · hover a bar for the count</span></div>
        <div class="chart" role="img" aria-label="Messages per day over the last 14 days">${bars}</div><div class="chart-x">${xs}</div></div>
      <div class="toolbar"><input class="input" id="q" placeholder="Search name, id or message" value="${esc(query)}"><span class="small muted" id="count"></span></div>
      <div class="card" style="padding:4px 8px;overflow-x:auto"><table>
        <thead><tr><th>User</th><th class="hide-sm">Channel</th><th>Last active</th><th class="num">Msgs</th><th class="num hide-sm">Symptoms</th><th class="num hide-sm">Periods</th><th class="hide-sm">Reminder</th><th class="hide-sm">Last message</th></tr></thead>
        <tbody id="rows"></tbody></table></div>
      <p class="note">Users are anonymous: the id is a random code from their device (App) or their phone number (WhatsApp).</p>`;
    renderRows();
  }

  function renderRows() {
    const q = query.trim().toLowerCase();
    const list = data.users.filter(u => !q || [u.name, u.id, u.lastMessage].some(v => String(v).toLowerCase().includes(q)));
    $('#count').textContent = `${list.length} of ${data.users.length} users`;
    $('#rows').innerHTML = list.map(u => `<tr data-id="${esc(u.id)}" tabindex="0">
      <td class="who"><strong>${esc(u.name || 'No name yet')}${u.test ? ' <span class="pill">test</span>' : ''}</strong><small>${esc(u.id.length > 22 ? u.id.slice(0, 22) + '…' : u.id)}</small></td>
      <td class="hide-sm">${u.channel}</td><td title="${esc(fullTime(u.lastActive))}">${when(u.lastActive)}</td>
      <td class="num">${u.messages}</td><td class="num hide-sm">${u.symptoms}</td><td class="num hide-sm">${u.periods}</td>
      <td class="hide-sm">${u.reminder === null ? '<span class="muted">Off</span>' : hourLabel(u.reminder)}</td>
      <td class="hide-sm"><span class="preview">${esc(u.lastMessage)}</span></td></tr>`).join('') || `<tr><td colspan="8" class="muted" style="text-align:center;padding:30px">No users ${q ? 'match that search' : 'yet'}.</td></tr>`;
  }

  async function openUser(id) {
    $('#root').innerHTML = `${top()}<p class="muted">Loading…</p>`;
    let d;
    try { d = await api('user', { id }); } catch (e) { alertBack(e.message); return; }
    const u = d.user, s = d.summary;
    const sev = x => (x.severity ? `${x.severity}/10` : '—');
    const byDate = arr => [...arr].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const list = (arr, fn, empty) => (arr.length ? arr.map(fn).join('') : `<p class="small muted">${empty}</p>`);
    const chat = u.transcript.length ? u.transcript.map((m, i) => {
      const prev = u.transcript[i - 1];
      const stamp = !prev || new Date(m.at) - new Date(prev.at) > 3600000 ? `<div class="stamp">${esc(fullTime(m.at))}</div>` : '';
      return `${stamp}<div class="msg ${m.from === 'you' ? 'me' : 'them'} tail">${fmtMsg(m.text)}</div>`;
    }).join('') : '<p class="small muted">No chat messages yet.</p>';
    const ag = u.agenda, f = u.followup;
    $('#root').innerHTML = `${top(`<button class="btn small danger" data-act="delete" data-id="${esc(id)}">${confirmId === id ? 'Tap again to delete' : 'Delete user'}</button><button class="btn small ghost" data-act="back">← All users</button>`)}
      <div class="page-head" style="margin-bottom:14px"><div class="eyebrow">${s.channel} user</div><h1 class="title">${esc(s.name || 'No name yet')}</h1>
        <p class="sub">Joined ${when(s.createdAt)} · last active ${when(s.lastActive)} · ${s.messages} messages · <span class="small">${esc(id)}</span></p></div>
      <div class="detail-grid">
        <div class="card"><h2 class="card-title">Chat with Mira</h2><p class="card-sub">Exactly what they saw in the app.</p><div class="convo" id="convo">${chat}</div></div>
        <div>
          <div class="card"><h2 class="card-title">Profile</h2><dl class="kv">
            <dt>Name</dt><dd>${esc(u.profile.name || '—')}</dd>
            <dt>Appointment</dt><dd>${esc(u.profile.appointmentDate || '—')}${u.profile.clinician ? ' · ' + esc(u.profile.clinician) : ''}</dd>
            <dt>Reminder</dt><dd>${u.reminder.enabled ? `On, around ${hourLabel(u.reminder.hour)} (${esc(u.reminder.tz || 'default time zone')}) · ${u.reminder.devices} device(s)` : 'Off'}</dd></dl></div>
          <div class="card"><h2 class="card-title">Symptoms (${u.symptoms.length})</h2>${list(byDate(u.symptoms), x => `<div class="list-item"><span class="sev-badge s${x.severity ? Math.min(5, Math.ceil(x.severity / 2)) : ''}">${sev(x)}</span><div class="li-main"><div class="li-title">${esc(x.name)}</div><div class="li-meta">${esc(x.date)}${x.impact ? ' · ' + esc(x.impact) : ''}</div>${x.notes ? `<div class="li-note">${esc(x.notes)}</div>` : ''}</div></div>`, 'None logged.')}</div>
          <div class="card"><h2 class="card-title">Periods & check-ins</h2>
            ${list(byDate(u.cycleStarts), x => `<div class="list-item"><span>🩸</span><div class="li-main"><div class="li-title">Period started</div><div class="li-meta">${esc(x.date)}</div></div></div>`, 'No period starts.')}
            ${list(byDate(u.checkins), x => `<div class="list-item"><span>💭</span><div class="li-main"><div class="li-title">${esc(x.feeling)}</div><div class="li-meta">${esc(x.date)}</div></div></div>`, 'No check-ins.')}</div>
          <div class="card"><h2 class="card-title">Visits</h2>
            ${list(byDate(u.preNotes), x => `<div class="list-item"><span>📝</span><div class="li-main"><div class="li-note" style="margin-top:0">${esc(x.text)}</div><div class="li-meta">To bring up · ${esc(x.date)}</div></div></div>`, 'No notes to bring up.')}
            ${list(byDate(u.postNotes), x => `<div class="list-item"><span>🗒️</span><div class="li-main"><div class="li-note" style="margin-top:0">${esc(x.text)}</div><div class="li-meta">After visit · ${esc(x.date)}</div></div></div>`, 'No after-visit notes.')}
            ${ag.summary || ag.topics.length ? `<div class="section-kicker">Agenda</div><p class="li-note">${esc(ag.summary)}</p><p class="li-meta">${ag.topics.map(esc).join(' · ')}</p>` : ''}
            ${f.summary || f.steps.length ? `<div class="section-kicker">Follow-up</div><p class="li-note">${esc(f.summary)}</p><p class="li-meta">${f.steps.map(esc).join(' · ')}</p>` : ''}</div>
          <div class="card"><h2 class="card-title">What Mira saved behind the scenes</h2><p class="card-sub" style="margin:0">Mira's own log of saves, edits and deletes (newest last).</p>
            <details><summary>Show log (${(d.actionLog || []).length})</summary><div class="log">${esc((d.actionLog || []).join('\n') || 'Nothing yet.')}</div></details></div>
        </div>
      </div>`;
    const c = $('#convo'); if (c) c.scrollTop = c.scrollHeight;
    window.scrollTo(0, 0);
  }
  function alertBack(msg) { $('#root').innerHTML = `${top('<button class="btn small ghost" data-act="back">← All users</button>')}<p class="err">${esc(msg)}</p>`; }

  document.addEventListener('submit', e => { if (e.target.id === 'login') { e.preventDefault(); pw = $('#pw').value; load(); } });
  document.addEventListener('input', e => { if (e.target.id === 'q') { query = e.target.value; renderRows(); } });
  document.addEventListener('click', e => {
    const row = e.target.closest('tr[data-id]'); if (row) { openUser(row.dataset.id); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (act !== 'delete' && act !== 'delete-test') confirmId = '';
    if (act === 'delete-test') {
      if (confirmId !== 'TEST') { confirmId = 'TEST'; renderList(); return; }
      confirmId = ''; api('delete-test').then(load).catch(err => alertBack(err.message));
    }
    if (act === 'delete') {
      // Two taps, so a stray click can't delete anyone.
      const id = a.dataset.id;
      if (confirmId !== id) { confirmId = id; a.textContent = 'Tap again to delete'; return; }
      confirmId = ''; api('delete', { id }).then(load).catch(err => alertBack(err.message));
    }
    if (act === 'refresh' || act === 'back') load();
    if (a.dataset.act === 'logout') { pw = ''; store.del(PW_KEY); data = null; renderLogin(); }
  });
  document.addEventListener('keydown', e => { const row = e.target.closest && e.target.closest('tr[data-id]'); if (row && e.key === 'Enter') openUser(row.dataset.id); });

  if (pw) load(); else renderLogin();
})();
