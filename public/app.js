/* World Cup 2026 Sweepstake — client */
let S = null;            // server state
let newsCache = null;
let matchFilter = 'all';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = ''), 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function setState(s) { S = s; renderAll(); }

// --- lookups -----------------------------------------------------------
const teamInfo = (name) => S.teams.find((t) => t.name === name);
const participant = (id) => S.participants.find((p) => p.id === id);
function ownerOf(teamName) {
  const id = S.assignments[teamName];
  return id ? participant(id) : null;
}
function ownerChip(teamName, small = true) {
  const p = ownerOf(teamName);
  if (!p) return '';
  return `<span class="owner-chip" style="background:${p.color}">${esc(p.name)}</span>`;
}

// --- header ------------------------------------------------------------
function renderHeader() {
  $('#syncStatus').textContent = S.lastSync
    ? 'Last synced ' + new Date(S.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Not synced yet';
}

// --- sweepstake tab ----------------------------------------------------
function renderSweepstake() {
  const el = $('#tab-sweepstake');
  const drawn = !!S.drawnAt;
  const RO = S.readOnly;

  const partList = S.participants.map((p) => `
    <li><span class="dot" style="background:${p.color}"></span> ${esc(p.name)}
      ${S.locked || RO ? '' : `<button class="x" data-del="${p.id}" title="Remove">✕</button>`}
    </li>`).join('');

  const perHead = S.participants.length
    ? `${Math.floor(48 / S.participants.length)}–${Math.ceil(48 / S.participants.length)} teams each`
    : '';

  let squads = '';
  if (drawn) {
    const byOwner = {};
    for (const t of S.teams) if (t.owner) (byOwner[t.owner] ||= []).push(t);
    squads = '<div class="squads">' + S.participants.map((p) => {
      const teams = (byOwner[p.id] || []).sort((a, b) => a.rank - b.rank);
      const alive = teams.filter((t) => t.status !== 'out').length;
      const rows = teams.map((t) => {
        const isTop = S.topPicks[p.id] === t.name;
        const cls = ['team-row', isTop ? 'top' : '', t.status === 'out' ? 'out' : '', t.status === 'champion' ? 'champion' : ''].join(' ');
        return `<li class="${cls}">${t.flag} <span class="tname">${esc(t.name)}</span>
          ${isTop ? '⭐' : ''}${t.status === 'champion' ? '🏆' : ''}
          <span class="rank">#${t.rank}</span></li>`;
      }).join('');
      return `<div class="card squad" style="border-top-color:${p.color}">
        <h3><span class="dot" style="background:${p.color}"></span>${esc(p.name)}
          <span class="alive-count">${alive}/${teams.length} still in</span></h3>
        <ul>${rows}</ul>
      </div>`;
    }).join('') + '</div>';
  }

  el.innerHTML = `
    ${RO ? `<div class="lock-banner">📺 <b>Live view</b>
        <span style="color:var(--muted)">scores update automatically — sit back and suffer</span></div>` : ''}
    ${S.locked && !RO ? `<div class="lock-banner">🔒 <b>Group saved &amp; locked</b>
        <span style="color:var(--muted)">since ${new Date(S.lockedAt).toLocaleString()}</span>
        <button class="btn danger small" id="unlockBtn" style="margin-left:auto">Unlock</button></div>` : ''}
    <div class="setup-row mb">
      <div class="card">
        <h2>Participants <span style="color:var(--muted);font-size:13px">(${S.participants.length})</span></h2>
        ${S.locked || RO ? '' : `<div class="add-row">
          <input id="nameInput" placeholder="Add a name…" maxlength="40">
          <button class="btn" id="addBtn">Add</button>
        </div>`}
        <ul class="participant-list">${partList || '<li style="color:var(--muted)">No one yet — add some names!</li>'}</ul>
        ${perHead ? `<p style="color:var(--muted);font-size:12px;margin-top:10px">${perHead} · everyone gets one ⭐ top contender</p>` : ''}
        ${S.locked || RO ? '' : `<div class="draw-actions">
          <button class="btn gold" id="drawBtn" ${S.participants.length < 2 ? 'disabled' : ''}>🎲 ${drawn ? 'Redraw' : 'Run the draw'}</button>
          ${drawn ? '<button class="btn" id="lockBtn">💾 Save group &amp; lock</button>' : ''}
        </div>`}
      </div>
      <div class="card">
        <h2>How the draw works</h2>
        <p style="color:var(--muted);font-size:14px">
          Teams are ranked 1–48 by strength. <b>Pot&nbsp;1</b> holds the top
          <b>${S.participants.length || 'N'}</b> contenders — each participant is dealt exactly one,
          so everyone has a real shot at the big win ⭐. The remaining teams are dealt one per person
          from successive strength bands, shuffled every round, so squads stay balanced top to bottom.
        </p>
        ${drawn ? `<p style="margin-top:10px;font-size:13px;color:var(--muted)">Drawn ${new Date(S.drawnAt).toLocaleString()}${S.locked ? ' · locked' : ' · not saved yet'}</p>` : ''}
        ${renderLeaderboard()}
      </div>
    </div>
    ${squads || '<div class="card empty">Run the draw to allocate the 48 teams 🎲</div>'}
  `;

  $('#addBtn')?.addEventListener('click', addParticipant);
  $('#nameInput')?.addEventListener('keydown', (e) => e.key === 'Enter' && addParticipant());
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => del('/api/participants/' + b.dataset.del)));
  $('#drawBtn')?.addEventListener('click', async () => {
    if (S.drawnAt && !confirm('Redraw and replace the current allocation?')) return;
    try { setState(await api('/api/draw', { method: 'POST' })); toast('Teams allocated! 🎲'); }
    catch (e) { toast(e.message, true); }
  });
  $('#lockBtn')?.addEventListener('click', async () => {
    try { setState(await api('/api/lock', { method: 'POST' })); toast('Group saved &amp; locked 🔒'.replace('&amp;', '&')); }
    catch (e) { toast(e.message, true); }
  });
  $('#unlockBtn')?.addEventListener('click', async () => {
    if (!confirm('Unlock the sweepstake? This allows redraws and roster changes.')) return;
    try { setState(await api('/api/unlock', { method: 'POST' })); }
    catch (e) { toast(e.message, true); }
  });
}

function renderLeaderboard() {
  if (!S.drawnAt) return '';
  const rows = S.participants.map((p) => {
    const teams = S.teams.filter((t) => t.owner === p.id);
    const alive = teams.filter((t) => t.status !== 'out');
    const best = alive.length ? alive.reduce((a, b) => (a.rank < b.rank ? a : b)) : null;
    const champ = teams.find((t) => t.status === 'champion');
    return { p, alive: alive.length, total: teams.length, best, champ };
  }).sort((a, b) => (b.champ ? 1 : 0) - (a.champ ? 1 : 0) || b.alive - a.alive || (a.best?.rank ?? 99) - (b.best?.rank ?? 99));
  return `<table class="leaderboard" style="margin-top:14px">
    <tr><th></th><th>Still in</th><th>Best hope</th></tr>
    ${rows.map((r) => `<tr>
      <td><span class="dot" style="background:${r.p.color};display:inline-block;vertical-align:-1px"></span> ${esc(r.p.name)} ${r.champ ? '🏆' : ''}</td>
      <td class="num">${r.alive}/${r.total}</td>
      <td>${r.best ? r.best.flag + ' ' + esc(r.best.name) : '—'}</td>
    </tr>`).join('')}
  </table>`;
}

async function addParticipant() {
  const input = $('#nameInput');
  if (!input.value.trim()) return;
  try {
    setState(await api('/api/participants', { method: 'POST', body: { name: input.value } }));
    const again = $('#nameInput'); if (again) { again.focus(); }
  } catch (e) { toast(e.message, true); }
}
async function del(path) {
  try { setState(await api(path, { method: 'DELETE' })); }
  catch (e) { toast(e.message, true); }
}

// --- groups tab --------------------------------------------------------
function renderGroups() {
  const el = $('#tab-groups');
  const names = Object.keys(S.standings).sort();
  el.innerHTML = '<div class="groups-grid">' + names.map((g) => {
    const st = S.standings[g];
    return `<div class="card">
      <div class="group-head"><h2>${esc(g)}</h2><span class="prog">${st.played}/${st.total} played</span></div>
      <table>
        <tr><th></th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">GD</th><th class="num">Pts</th></tr>
        ${st.rows.map((r, i) => {
          const t = teamInfo(r.team);
          return `<tr class="${i < 2 ? 'q' : ''}">
            <td>${t ? t.flag : ''} ${esc(r.team)} ${ownerChip(r.team)}</td>
            <td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.d}</td>
            <td class="num">${r.l}</td><td class="num">${r.gd > 0 ? '+' : ''}${r.gd}</td>
            <td class="num"><b>${r.pts}</b></td></tr>`;
        }).join('')}
      </table>
    </div>`;
  }).join('') + '</div>';
}

// --- bracket tab -------------------------------------------------------
const COLS = [
  { ms: [74, 77, 73, 75, 83, 84, 81, 82], label: 'Round of 32' },
  { ms: [89, 90, 93, 94], label: 'Round of 16' },
  { ms: [97, 98], label: 'Quarter-finals' },
  { ms: [101], label: 'Semi-final' },
  { ms: [104, 103], label: 'Final', center: true },
  { ms: [102], label: 'Semi-final' },
  { ms: [99, 100], label: 'Quarter-finals' },
  { ms: [91, 92, 95, 96], label: 'Round of 16' },
  { ms: [76, 78, 79, 80, 86, 88, 85, 87], label: 'Round of 32' },
];
// child -> [source matches] mirrored from the server's bracket map
const SOURCES = {
  89: [74, 77], 90: [73, 75], 91: [76, 78], 92: [79, 80],
  93: [83, 84], 94: [81, 82], 95: [86, 88], 96: [85, 87],
  97: [89, 90], 98: [93, 94], 99: [91, 92], 100: [95, 96],
  101: [97, 98], 102: [99, 100], 104: [101, 102],
};

function renderBracket() {
  const el = $('#tab-bracket');
  const W = 168, GAP = 40, CARD_H = 66, ROW_H = 88, LABEL_H = 34;
  const innerH = 8 * ROW_H;
  const fixtures = new Map(S.fixtures.map((f) => [f.MatchNumber, f]));
  const pos = {};
  let html = '';

  COLS.forEach((col, ci) => {
    const x = 10 + ci * (W + GAP);
    html += `<div class="round-label" style="left:${x}px;top:0">${col.label}</div>`;
    col.ms.forEach((num, j) => {
      let y;
      if (col.center) {
        y = num === 104 ? LABEL_H + innerH / 2 - CARD_H - 14 : LABEL_H + innerH / 2 + 14;
      } else {
        y = LABEL_H + (j + 0.5) * (innerH / col.ms.length) - CARD_H / 2;
      }
      pos[num] = { x, y, w: num === 104 || num === 103 ? 190 : W, h: CARD_H };
      html += matchCard(fixtures.get(num), x, y, num === 104);
    });
  });

  // connector elbows
  let paths = '';
  const midX = (n) => pos[n].x + pos[n].w;
  for (const [childStr, srcs] of Object.entries(SOURCES)) {
    const child = Number(childStr);
    const c = pos[child]; if (!c) continue;
    for (const src of srcs) {
      const s = pos[src]; if (!s) continue;
      const fromRight = s.x < c.x; // left half flows right
      const sx = fromRight ? s.x + s.w : s.x;
      const sy = s.y + s.h / 2;
      const cx = fromRight ? c.x : c.x + c.w;
      const cy = c.y + c.h / 2;
      const elbow = fromRight ? sx + GAP / 2 : sx - GAP / 2;
      paths += `<path d="M ${sx} ${sy} H ${elbow} V ${cy} H ${cx}"/>`;
    }
  }
  // third place dotted link
  if (pos[103] && pos[101] && pos[102]) {
    paths += `<path stroke-dasharray="4 4" d="M ${pos[101].x + pos[101].w} ${pos[101].y + pos[101].h / 2 + 8} H ${pos[103].x} "/>`;
    paths += `<path stroke-dasharray="4 4" d="M ${pos[102].x} ${pos[102].y + pos[102].h / 2 + 8} H ${pos[103].x + pos[103].w}"/>`;
  }

  const totalW = 10 + COLS.length * (W + GAP) + 40;
  const totalH = LABEL_H + innerH + 10;
  el.innerHTML = `<div class="bracket-wrap">
    <div class="bracket-stage" style="width:${totalW}px;height:${totalH}px">
      <svg class="bracket-svg" width="${totalW}" height="${totalH}">${paths}</svg>
      ${html}
    </div></div>`;
}

function matchCard(m, x, y, isFinal) {
  if (!m) return '';
  const date = new Date(m.DateUtc).toLocaleDateString([], { day: 'numeric', month: 'short' });
  const row = (name, score, other) => {
    const real = name && !/^([12][A-L]|3[A-L]{2,}|To be announced|W\d+|L\d+)$/i.test(name.trim());
    if (!real) return `<div class="trow"><span class="tba">${esc(prettyPlaceholder(name))}</span></div>`;
    const t = teamInfo(name);
    const p = ownerOf(name);
    const won = m.winner === name, lost = m.winner && m.winner !== name;
    return `<div class="trow ${won ? 'winner' : ''} ${lost ? 'loser' : ''}">
      ${t ? t.flag : ''} <span>${esc(name)}</span>
      ${p ? `<span class="odot" title="${esc(p.name)}" style="background:${p.color}"></span>` : ''}
      <span class="score">${score ?? ''}</span></div>`;
  };
  const label = m.MatchNumber === 103 ? 'Third place' : (isFinal ? '🏆 FINAL' : 'M' + m.MatchNumber);
  return `<div class="bmatch ${isFinal ? 'final-match' : ''}" style="left:${x}px;top:${y}px">
    <div class="mnum"><span>${label}</span><span>${date}</span></div>
    ${row(m.HomeTeam, m.HomeTeamScore)}
    ${row(m.AwayTeam, m.AwayTeamScore)}
  </div>`;
}

function prettyPlaceholder(p) {
  if (!p || /to be announced/i.test(p)) return 'TBD';
  const g = /^([12])([A-L])$/.exec(p.trim());
  if (g) return (g[1] === '1' ? 'Winner' : 'Runner-up') + ' Group ' + g[2];
  const t = /^3([A-L]{2,})$/.exec(p.trim());
  if (t) return '3rd of ' + t[1].split('').join('/');
  return p;
}

// --- matches tab -------------------------------------------------------
function renderMatches() {
  const el = $('#tab-matches');
  let list = S.fixtures.slice().sort((a, b) => new Date(a.DateUtc) - new Date(b.DateUtc) || a.MatchNumber - b.MatchNumber);
  if (matchFilter === 'unplayed') list = list.filter((m) => m.HomeTeamScore == null);
  else if (matchFilter === 'played') list = list.filter((m) => m.HomeTeamScore != null);
  else if (matchFilter !== 'all') list = list.filter((m) => String(m.RoundNumber) === matchFilter);

  const days = {};
  for (const m of list) {
    const d = new Date(m.DateUtc).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    (days[d] ||= []).push(m);
  }

  el.innerHTML = `
    <div class="match-controls">
      <select id="roundFilter">
        <option value="all">All matches</option>
        <option value="unplayed">Unplayed</option>
        <option value="played">Played</option>
        <option value="1">Group MD1</option><option value="2">Group MD2</option><option value="3">Group MD3</option>
        <option value="4">Round of 32</option><option value="5">Round of 16</option>
        <option value="6">Quarter-finals</option><option value="7">Semi-finals</option><option value="8">Final</option>
      </select>
      <span style="color:var(--muted);font-size:13px">${list.length} matches · scores come from the feed${S.readOnly ? '' : ', or enter them manually below'}</span>
    </div>
    ${Object.entries(days).map(([day, ms]) => `
      <div class="day-head">${day}</div>
      ${ms.map(fixtureRow).join('')}
    `).join('') || '<div class="card empty">No matches for this filter.</div>'}
    <div class="news card" id="newsBox"><h3>📰 Latest from BBC Sport</h3><p style="color:var(--muted)">Loading…</p></div>
  `;

  const sel = $('#roundFilter');
  sel.value = matchFilter;
  sel.addEventListener('change', () => { matchFilter = sel.value; renderMatches(); });
  el.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => saveResult(Number(b.dataset.save))));
  loadNews();
}

function fixtureRow(m) {
  const time = new Date(m.DateUtc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const side = (name) => {
    const real = name && !/^([12][A-L]|3[A-L]{2,}|To be announced|W\d+|L\d+)$/i.test(name.trim());
    if (!real) return `<span class="tba" style="color:var(--muted);font-style:italic">${esc(prettyPlaceholder(name))}</span>`;
    const t = teamInfo(name);
    const cls = m.winner === name ? 'winner-name' : '';
    return `${t ? t.flag : ''} <span class="${cls}">${esc(name)}</span> ${ownerChip(name)}`;
  };
  const RO = S.readOnly;
  const played = m.HomeTeamScore != null && m.AwayTeamScore != null;
  const isKO = m.RoundNumber >= 4;
  const needsWinner = isKO && played && m.HomeTeamScore === m.AwayTeamScore;
  const bothReal = [m.HomeTeam, m.AwayTeam].every((n) => n && !/^([12][A-L]|3[A-L]{2,}|To be announced|W\d+|L\d+)$/i.test(n.trim()));

  let scoreBox;
  if (played) {
    scoreBox = `<b>${m.HomeTeamScore} – ${m.AwayTeamScore}</b>${m.ManualResult ? '<div class="manual-tag">manual</div>' : ''}
      ${needsWinner && !m.winner ? `<div style="font-size:10px;color:var(--gold)">pens?</div>` : ''}
      ${isKO && m.winner && needsWinner ? `<div style="font-size:10px;color:var(--muted)">${esc(m.winner)} on pens</div>` : ''}`;
  } else if (bothReal && !RO) {
    scoreBox = `<input class="s" type="number" min="0" max="20" id="h${m.MatchNumber}"> –
      <input class="s" type="number" min="0" max="20" id="a${m.MatchNumber}">`;
  } else {
    scoreBox = `<span style="color:var(--muted)">v</span>`;
  }

  return `<div class="fixture">
    <div class="home side">${side(m.HomeTeam)}</div>
    <div class="score-box">${scoreBox}</div>
    <div class="side">${side(m.AwayTeam)}</div>
    <div class="meta">${time} · ${esc(m.Location)} · ${esc(m.roundName)}
      ${!played && bothReal && !RO ? `<div><button class="btn ghost small" data-save="${m.MatchNumber}" style="margin-top:4px">Save score</button></div>` : ''}
      ${needsWinner && !m.winner && !RO ? `<div><button class="btn ghost small" data-save="${m.MatchNumber}" style="margin-top:4px">Set pens winner</button></div>` : ''}
    </div>
  </div>`;
}

async function saveResult(num) {
  const m = S.fixtures.find((f) => f.MatchNumber === num);
  const hEl = document.getElementById('h' + num), aEl = document.getElementById('a' + num);
  let h = hEl ? hEl.value : m.HomeTeamScore, a = aEl ? aEl.value : m.AwayTeamScore;
  if (h === '' || a === '' || h == null || a == null) return toast('Enter both scores', true);
  h = Number(h); a = Number(a);
  const body = { matchNumber: num, homeScore: h, awayScore: a };
  if (m.RoundNumber >= 4 && h === a) {
    const w = prompt(`Penalties! Who went through — type exactly:\n${m.HomeTeam} or ${m.AwayTeam}`);
    if (!w || ![m.HomeTeam, m.AwayTeam].includes(w.trim())) return toast('Winner must match one of the team names', true);
    body.winner = w.trim();
  }
  try { setState(await api('/api/result', { method: 'POST', body })); toast('Result saved ✔'); }
  catch (e) { toast(e.message, true); }
}

async function loadNews() {
  const box = $('#newsBox');
  if (!box) return;
  try {
    if (!newsCache) newsCache = await api('/api/news');
    box.innerHTML = '<h3>📰 Latest from BBC Sport</h3>' + newsCache.map((n) =>
      `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}
       <span class="src"> — ${esc((n.date || '').slice(0, 22))}</span></a>`).join('');
  } catch {
    box.innerHTML = '<h3>📰 Latest from BBC Sport</h3><p style="color:var(--muted)">Couldn\'t load the feed right now.</p>';
  }
}

// --- shell -------------------------------------------------------------
function renderAll() {
  // Preserve in-progress typing across re-renders (state polls every 60s).
  const activeId = document.activeElement?.id;
  const vals = {};
  document.querySelectorAll('input[id]').forEach((i) => { if (i.value) vals[i.id] = i.value; });
  renderHeader();
  renderSweepstake();
  renderGroups();
  renderBracket();
  renderMatches();
  for (const [id, v] of Object.entries(vals)) {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = v;
  }
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) { el.focus(); el.setSelectionRange?.(el.value.length, el.value.length); }
  }
}

function activateTab(name) {
  if (!document.getElementById('tab-' + name)) name = 'sweepstake';
  document.querySelectorAll('nav#tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}
document.querySelectorAll('nav#tabs button').forEach((b) =>
  b.addEventListener('click', () => activateTab(b.dataset.tab)));
window.addEventListener('hashchange', () => activateTab(location.hash.slice(1)));
if (location.hash) activateTab(location.hash.slice(1));

$('#syncBtn').addEventListener('click', async () => {
  const btn = $('#syncBtn');
  btn.disabled = true; btn.textContent = '↻ Syncing…';
  try {
    const out = await api('/api/sync', { method: 'POST', body: { force: true } });
    setState(out.state);
    toast(out.synced ? 'Fixtures updated from feed ✔' : 'Feed already fresh');
  } catch (e) { toast('Sync failed: ' + e.message, true); }
  btn.disabled = false; btn.textContent = '↻ Sync results';
});

async function boot() {
  setState(await api('/api/state'));
  // periodic refresh: feed every 10 min, local state every 60s
  setInterval(async () => { try { setState(await api('/api/state')); } catch {} }, 60_000);
  setInterval(async () => {
    try { const o = await api('/api/sync', { method: 'POST' }); if (o.synced) { newsCache = null; setState(o.state); } } catch {}
  }, 600_000);
}
boot().catch((e) => toast('Failed to load: ' + e.message, true));
