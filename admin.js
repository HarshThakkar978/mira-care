(() => {
  // Cura admin: view users, their entries and chats, and delete test users. Password is checked by /api/admin.
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
  let cm = null, busy = '';

  async function api(action, extra = {}) {
    const res = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw, action, ...extra }) });
    const out = await res.json().catch(() => ({}));
    if (res.status === 401) { pw = ''; store.del(PW_KEY); }
    if (!res.ok) throw new Error(out.error || 'Something went wrong');
    return out;
  }

  const top = (extra = '') => `<div class="top"><div class="brand"><span class="brand-mark">c</span><span class="brand-name">cura admin</span></div><span class="spacer"></span>${extra}</div>`;
  const tabs = on => `<div class="seg" style="margin:0;min-width:220px"><button class="${on === 'users' ? 'on' : ''}" data-act="go-users">Users</button><button class="${on === 'community' ? 'on' : ''}" data-act="go-community">Community</button></div>`;

  function renderLogin(error = '') {
    $('#root').innerHTML = `<div class="login"><div class="card">
      ${top()}<p class="card-sub">Private dashboard for the Cura team.</p>
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
    $('#root').innerHTML = `${top(`${tabs('users')}<button class="btn small ghost" data-act="refresh">Refresh</button><button class="btn small ghost" data-act="logout">Log out</button>`)}
      ${tests ? `<div class="card row" style="margin-bottom:14px"><span class="small">🧪 ${tests} test user${tests === 1 ? '' : 's'} created by Claude while testing Cura.</span><button class="btn small danger" data-act="delete-test">${confirmId === 'TEST' ? 'Tap again to delete them' : 'Delete test users'}</button></div>` : ''}
      <div class="tiles">${tiles}</div>
      <div class="card"><div class="row"><h2 class="card-title">Messages to Cura per day</h2><span class="small muted">Last 14 days · hover a bar for the count</span></div>
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
        <div class="card"><h2 class="card-title">Chat with Cura</h2><p class="card-sub">Exactly what they saw in the app.</p><div class="convo" id="convo">${chat}</div></div>
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
          <div class="card"><h2 class="card-title">What Cura saved behind the scenes</h2><p class="card-sub" style="margin:0">Cura's own log of saves, edits and deletes (newest last).</p>
            <details><summary>Show log (${(d.actionLog || []).length})</summary><div class="log">${esc((d.actionLog || []).join('\n') || 'Nothing yet.')}</div></details></div>
        </div>
      </div>`;
    const c = $('#convo'); if (c) c.scrollTop = c.scrollHeight;
    window.scrollTo(0, 0);
  }
  // ---------- Community: tips Cura found, starter tips, groups ----------
  const WHEN = ['morning', 'midday', 'evening', 'bedtime', 'anytime'];
  const HOW = { a_lot: 'Helped a lot', some: 'Helped some', not_much: 'Not much', made_worse: 'Made it worse', unclear: 'Not said yet' };
  async function loadCommunity() {
    $('#root').innerHTML = `${top(tabs('community'))}<p class="muted">Loading…</p>`;
    try { cm = await api('community'); renderCommunity(); } catch (e) { alertBack(e.message); }
  }
  const sel = (name, value, opts) => `<select class="select" data-f="${name}">${opts.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  function tipFields(t) {
    return `<div class="form-grid" style="margin-top:10px">
      <div class="field"><label>Title (what to try)</label><input class="input" data-f="title" value="${esc(t.title)}"></div>
      <div class="field"><label>Symptom</label><input class="input" data-f="symptom" value="${esc(t.symptom)}"></div>
      <div class="field"><label>Time of day</label>${sel('when', t.when, WHEN.map(w => [w, w[0].toUpperCase() + w.slice(1)]))}</div>
      <div class="field"><label>Kind</label>${sel('kind', t.kind, [['everyday', 'Everyday idea (can go in a plan)'], ['medical', 'Medical (shown as "ask your clinician")']])}</div>
      <div class="field full"><label>Details</label><input class="input" data-f="details" value="${esc(t.details)}"></div>
      <div class="field full"><label>Why it may help ${t.why ? '' : '<span class="muted">(Cura writes this when you approve)</span>'}</label><textarea class="textarea" data-f="why" style="min-height:60px">${esc(t.why)}</textarea></div>
    </div>`;
  }
  function tipCardHtml(t) {
    const src = t.source === 'team' ? 'Starter tip from the team' : `${esc(t.authorName || 'A member')}${t.groupName ? ' in ' + esc(t.groupName) : ''} · ${esc(HOW[t.howWell] || '')}`;
    const stats = `${t.reports ? `${t.reports} more member${t.reports === 1 ? '' : 's'} mentioned it · ` : ''}added to ${t.stats.added} plan${t.stats.added === 1 ? '' : 's'} · ${t.stats.tried ? `${t.stats.helped} of ${t.stats.tried} said it helped` : 'no check-ins yet'}`;
    const buttons = t.status === 'pending'
      ? `<button class="btn small primary" data-act="tip" data-status="approved" data-id="${t.id}" ${busy === t.id ? 'disabled' : ''}>${busy === t.id ? 'Saving…' : 'Approve'}</button><button class="btn small ghost" data-act="tip" data-status="rejected" data-id="${t.id}">Reject</button>`
      : `<button class="btn small primary" data-act="tip" data-id="${t.id}" ${busy === t.id ? 'disabled' : ''}>${busy === t.id ? 'Saving…' : 'Save changes'}</button><button class="btn small ghost" data-act="tip" data-status="pending" data-id="${t.id}">Unpublish</button><button class="btn small danger" data-act="tip-del" data-id="${t.id}">${confirmId === 'tip' + t.id ? 'Tap again to delete' : 'Delete'}</button>`;
    return `<div class="list-item" data-tip="${t.id}" style="display:block">
      <div class="row"><strong>${esc(t.title)}</strong><span class="pill">${esc(t.symptom)}</span></div>
      <div class="li-meta">${src} · ${when(t.createdAt)}</div>
      ${t.source !== 'team' && t.quote ? `<div class="li-note">“${esc(t.quote)}”</div>` : ''}
      ${t.status === 'approved' ? `<div class="li-meta">${esc(stats)}</div>` : ''}
      <details ${t.status === 'pending' ? 'open' : ''}><summary>${t.status === 'pending' ? 'Check the details' : 'Edit'}</summary>${tipFields(t)}</details>
      <div class="row-wrap" style="margin-top:10px">${buttons}</div>
    </div>`;
  }
  function renderCommunity() {
    const pending = cm.tips.filter(t => t.status === 'pending'), live = cm.tips.filter(t => t.status === 'approved'), rejected = cm.tips.filter(t => t.status === 'rejected');
    const members = cm.groups.reduce((n, g) => n + g.members.length, 0);
    const tiles = [['Groups', cm.groups.length], ['Members', members], ['Tips to review', pending.length], ['Live tips', live.length]].map(([l, v]) => `<div class="card tile"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
    $('#root').innerHTML = `${top(`${tabs('community')}<button class="btn small ghost" data-act="go-community">Refresh</button><button class="btn small ghost" data-act="logout">Log out</button>`)}
      <div class="tiles" style="grid-template-columns:repeat(4,minmax(0,1fr))">${tiles}</div>
      <div class="detail-grid">
        <div>
          <div class="card"><h2 class="card-title">Tips to review (${pending.length})</h2><p class="card-sub">Cura found these in group chats. Check the wording, then approve so Cura can suggest them to people with matching symptoms.</p>
            ${pending.map(tipCardHtml).join('') || '<p class="small muted">Nothing to review right now.</p>'}</div>
          <div class="card"><h2 class="card-title">Add starter tips</h2><p class="card-sub">Write one or more tips in plain words, one per line. Cura structures them and writes why they may help. They go live straight away.</p>
            <textarea class="textarea" id="teamTips" placeholder="A cool shower before bed for night sweats&#10;A 10-minute walk after lunch for the afternoon slump"></textarea>
            <button class="btn primary" data-act="tip-add" style="margin-top:10px" ${busy === 'add' ? 'disabled' : ''}>${busy === 'add' ? 'Cura is writing…' : 'Add tips'}</button></div>
          <div class="card"><h2 class="card-title">Live tips (${live.length})</h2>${live.map(tipCardHtml).join('') || '<p class="small muted">No live tips yet.</p>'}
            ${rejected.length ? `<details><summary>Rejected (${rejected.length})</summary>${rejected.map(t => `<div class="li-meta">${esc(t.title)} · ${esc(t.symptom)} <button class="btn small ghost" data-act="tip" data-status="pending" data-id="${t.id}">Restore</button></div>`).join('')}</details>` : ''}</div>
        </div>
        <div>
          <div class="card"><div class="row"><h2 class="card-title">Groups</h2></div><p class="card-sub">Cura sorts people into groups by their symptoms every day at 10 AM New York time, and posts a question of the day.</p>
            <div class="row-wrap"><button class="btn small ghost" data-act="regroup" ${busy === 'regroup' ? 'disabled' : ''}>${busy === 'regroup' ? 'Sorting…' : 'Re-sort groups now'}</button><button class="btn small ghost" data-act="questions" ${busy === 'questions' ? 'disabled' : ''}>${busy === 'questions' ? 'Posting…' : "Post today's questions"}</button></div>
            <p class="small muted" id="cmResult"></p>
            ${cm.groups.map(g => `<div class="list-item" style="display:block"><div class="row"><strong>${esc(g.name)}</strong><span class="small muted">${g.members.length} members · ${g.messages} messages</span></div>
              <div class="li-meta">${esc(g.focus)}</div>
              <div class="li-meta">Common: ${g.common.map(c => `${esc(c.name)} (${c.members}${c.avg ? `, avg ${c.avg}` : ''})`).join(', ') || '—'}</div>
              <div class="li-note">${g.members.map(m => `${esc(m.name)}${m.focus.length ? ` <span class="muted">(${esc(m.focus.join(', '))})</span>` : ''}`).join(' · ')}</div>
              <button class="btn small ghost" data-act="group-msgs" data-id="${g.id}" style="margin-top:8px">View messages</button></div>`).join('') || '<p class="small muted">No groups yet. The first one is made when someone joins.</p>'}</div>
        </div>
      </div>`;
  }
  function tipFieldsFrom(id) {
    const box = document.querySelector(`[data-tip="${id}"]`), out = {};
    if (box) box.querySelectorAll('[data-f]').forEach(el => { out[el.dataset.f] = el.value; });
    return out;
  }
  async function openGroup(id) {
    const g = cm.groups.find(x => x.id === id);
    $('#root').innerHTML = `${top(tabs('community'))}<p class="muted">Loading…</p>`;
    let d;
    try { d = await api('group-msgs', { groupId: id }); } catch (e) { alertBack(e.message); return; }
    const msgs = d.messages.map((m, i) => {
      const prev = d.messages[i - 1];
      const stamp = !prev || new Date(m.at) - new Date(prev.at) > 3600000 ? `<div class="stamp">${esc(fullTime(m.at))}</div>` : '';
      return `${stamp}<div class="sender">${esc(m.name)}${m.from !== 'cura' ? ` <button class="btn small ghost" style="min-height:22px;padding:0 6px;font-size:11px" data-act="msg-del" data-gid="${id}" data-id="${m.id}">${confirmId === 'msg' + m.id ? 'Tap again' : 'Delete'}</button>` : ''}</div><div class="msg ${m.from === 'cura' ? 'them cura' : 'them'} tail">${fmtMsg(m.text)}</div>`;
    }).join('') || '<p class="small muted">No messages yet.</p>';
    $('#root').innerHTML = `${top(`<button class="btn small ghost" data-act="go-community">← Community</button>`)}
      <div class="page-head"><div class="eyebrow">Group</div><h1 class="title">${esc(g ? g.name : 'Group')}</h1><p class="sub">${esc(g ? g.focus : '')}</p></div>
      <div class="card"><div class="convo" id="convo">${msgs}</div></div>`;
    const c = $('#convo'); if (c) c.scrollTop = c.scrollHeight;
  }

  function alertBack(msg) { $('#root').innerHTML = `${top('<button class="btn small ghost" data-act="back">← All users</button>')}<p class="err">${esc(msg)}</p>`; }

  document.addEventListener('submit', e => { if (e.target.id === 'login') { e.preventDefault(); pw = $('#pw').value; load(); } });
  document.addEventListener('input', e => { if (e.target.id === 'q') { query = e.target.value; renderRows(); } });
  document.addEventListener('click', e => {
    const row = e.target.closest('tr[data-id]'); if (row) { openUser(row.dataset.id); return; }
    const a = e.target.closest('[data-act]'); if (!a) return;
    const act = a.dataset.act;
    if (!['delete', 'delete-test', 'tip-del', 'msg-del'].includes(act)) confirmId = '';
    if (act === 'go-users') load();
    if (act === 'go-community') loadCommunity();
    if (act === 'group-msgs') openGroup(a.dataset.id);
    if (act === 'tip') {
      const id = a.dataset.id, fields = tipFieldsFrom(id); // read the edits before redrawing
      busy = id; renderCommunity();
      api('tip-save', { id, fields, status: a.dataset.status || undefined }).then(() => { busy = ''; loadCommunity(); }).catch(err => { busy = ''; alert(err.message); renderCommunity(); });
    }
    if (act === 'tip-del') {
      const id = a.dataset.id;
      if (confirmId !== 'tip' + id) { confirmId = 'tip' + id; a.textContent = 'Tap again to delete'; return; }
      confirmId = ''; api('tip-save', { id, remove: true }).then(loadCommunity).catch(err => alert(err.message));
    }
    if (act === 'tip-add') {
      const text = $('#teamTips').value.trim(); if (!text) return;
      busy = 'add'; renderCommunity(); $('#teamTips').value = text;
      api('tip-add', { text }).then(() => { busy = ''; loadCommunity(); }).catch(err => { busy = ''; renderCommunity(); $('#teamTips').value = text; alert(err.message); });
    }
    if (act === 'regroup' || act === 'questions') {
      busy = act; renderCommunity();
      api(act).then(r => { busy = ''; return loadCommunity().then(() => { const el = $('#cmResult'); if (el) el.textContent = act === 'regroup' ? (r.result.changed ? `Moved ${r.result.moved} member(s) into ${r.result.groups} group(s).` : 'No changes needed today.') : `Posted ${r.posted} question(s).`; }); }).catch(err => { busy = ''; renderCommunity(); alert(err.message); });
    }
    if (act === 'msg-del') {
      const id = a.dataset.id, gid = a.dataset.gid;
      if (confirmId !== 'msg' + id) { confirmId = 'msg' + id; a.textContent = 'Tap again'; return; }
      confirmId = ''; api('msg-delete', { groupId: gid, msgId: id }).then(() => openGroup(gid)).catch(err => alert(err.message));
    }
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
