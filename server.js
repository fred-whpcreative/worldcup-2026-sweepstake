#!/usr/bin/env node
/**
 * World Cup 2026 Sweepstake — local server.
 * Zero dependencies: Node 18+ (uses built-in fetch).
 *
 *   node server.js          → http://localhost:4026
 *
 * Live data: fixturedownload.com JSON feed (scores + knockout teams fill in
 * automatically as the tournament progresses). BBC Sport RSS for headlines.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4026;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SEED_FILE = path.join(DATA_DIR, 'fixtures-seed.json');
const FEED_URL = 'https://fixturedownload.com/feed/json/fifa-world-cup-2026';
const BBC_RSS = 'https://feeds.bbci.co.uk/sport/football/rss.xml';
const SYNC_COOLDOWN_MS = 60 * 1000;

// Approximate strength order for the 48 finalists (1 = strongest). Drives the
// tiered draw so every participant lands one genuine contender.
const TEAM_RANKS = {
  'Spain': 1, 'Argentina': 2, 'France': 3, 'England': 4, 'Brazil': 5,
  'Portugal': 6, 'Netherlands': 7, 'Belgium': 8, 'Germany': 9, 'Croatia': 10,
  'Morocco': 11, 'Colombia': 12, 'Mexico': 13, 'Uruguay': 14, 'USA': 15,
  'Switzerland': 16, 'Japan': 17, 'Senegal': 18, 'IR Iran': 19,
  'Korea Republic': 20, 'Ecuador': 21, 'Austria': 22, 'Türkiye': 23,
  'Australia': 24, 'Canada': 25, 'Norway': 26, 'Panama': 27, 'Egypt': 28,
  'Algeria': 29, 'Scotland': 30, 'Paraguay': 31, 'Tunisia': 32,
  "Côte d'Ivoire": 33, 'Sweden': 34, 'Czechia': 35, 'Saudi Arabia': 36,
  'Qatar': 37, 'Uzbekistan': 38, 'Iraq': 39, 'South Africa': 40,
  'Jordan': 41, 'Congo DR': 42, 'Bosnia and Herzegovina': 43, 'Ghana': 44,
  'Cabo Verde': 45, 'Curaçao': 46, 'Haiti': 47, 'New Zealand': 48,
};

const FLAGS = {
  'Algeria': '🇩🇿', 'Argentina': '🇦🇷', 'Australia': '🇦🇺', 'Austria': '🇦🇹',
  'Belgium': '🇧🇪', 'Bosnia and Herzegovina': '🇧🇦', 'Brazil': '🇧🇷',
  'Cabo Verde': '🇨🇻', 'Canada': '🇨🇦', 'Colombia': '🇨🇴', 'Congo DR': '🇨🇩',
  'Croatia': '🇭🇷', 'Curaçao': '🇨🇼', 'Czechia': '🇨🇿', "Côte d'Ivoire": '🇨🇮',
  'Ecuador': '🇪🇨', 'Egypt': '🇪🇬', 'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'France': '🇫🇷',
  'Germany': '🇩🇪', 'Ghana': '🇬🇭', 'Haiti': '🇭🇹', 'IR Iran': '🇮🇷',
  'Iraq': '🇮🇶', 'Japan': '🇯🇵', 'Jordan': '🇯🇴', 'Korea Republic': '🇰🇷',
  'Mexico': '🇲🇽', 'Morocco': '🇲🇦', 'Netherlands': '🇳🇱', 'New Zealand': '🇳🇿',
  'Norway': '🇳🇴', 'Panama': '🇵🇦', 'Paraguay': '🇵🇾', 'Portugal': '🇵🇹',
  'Qatar': '🇶🇦', 'Saudi Arabia': '🇸🇦', 'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'Senegal': '🇸🇳',
  'South Africa': '🇿🇦', 'Spain': '🇪🇸', 'Sweden': '🇸🇪', 'Switzerland': '🇨🇭',
  'Tunisia': '🇹🇳', 'Türkiye': '🇹🇷', 'USA': '🇺🇸', 'Uruguay': '🇺🇾',
  'Uzbekistan': '🇺🇿',
};

// Official FIFA bracket: which earlier matches feed each knockout tie.
// 103 (third place) takes the LOSERS of the semis.
const BRACKET_SOURCES = {
  89: [74, 77], 90: [73, 75], 91: [76, 78], 92: [79, 80],
  93: [83, 84], 94: [81, 82], 95: [86, 88], 96: [85, 87],
  97: [89, 90], 98: [93, 94], 99: [91, 92], 100: [95, 96],
  101: [97, 98], 102: [99, 100],
  103: [101, 102], // losers
  104: [101, 102],
};
const ROUND_NAMES = {
  1: 'Group stage · MD1', 2: 'Group stage · MD2', 3: 'Group stage · MD3',
  4: 'Round of 32', 5: 'Round of 16', 6: 'Quarter-finals',
  7: 'Semi-finals', 8: 'Final',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = loadState();

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {
      fixtures: JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')),
      participants: [],          // [{id, name, color}]
      assignments: {},           // teamName -> participantId
      topPicks: {},              // participantId -> teamName (their contender)
      locked: false,
      drawnAt: null,
      lockedAt: null,
      manual: {},                // matchNumber -> {homeScore, awayScore, winner, homeTeam, awayTeam}
      lastSync: null,
    };
  }
}

function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Fixtures: feed + manual overrides + winner propagation
// ---------------------------------------------------------------------------
const PLACEHOLDER_RE = /^([12][A-L]|3[A-L]{2,}|To be announced|W\d+|L\d+)$/i;
const isRealTeam = (name) => !!name && !PLACEHOLDER_RE.test(name.trim());

function effectiveFixtures() {
  const fixtures = state.fixtures.map((f) => ({ ...f }));
  const byNum = new Map(fixtures.map((f) => [f.MatchNumber, f]));

  for (const [num, ov] of Object.entries(state.manual)) {
    const m = byNum.get(Number(num));
    if (!m) continue;
    if (ov.homeTeam) m.HomeTeam = ov.homeTeam;
    if (ov.awayTeam) m.AwayTeam = ov.awayTeam;
    if (ov.homeScore != null) m.HomeTeamScore = ov.homeScore;
    if (ov.awayScore != null) m.AwayTeamScore = ov.awayScore;
    if (ov.winner) m.Winner = ov.winner;
    if (ov.homeScore != null) m.ManualResult = true;
  }

  // Resolve group-position placeholders (1A, 2B…) once a group is complete.
  const standings = computeStandings(fixtures);
  for (const m of fixtures) {
    if (m.RoundNumber !== 4) continue;
    for (const side of ['HomeTeam', 'AwayTeam']) {
      const match = /^([12])([A-L])$/.exec((m[side] || '').trim());
      if (!match) continue;
      const table = standings['Group ' + match[2]];
      if (table && table.complete) m[side] = table.rows[Number(match[1]) - 1].team;
    }
  }

  // Propagate knockout winners/losers down the bracket.
  for (let pass = 0; pass < 5; pass++) {
    for (const [numStr, sources] of Object.entries(BRACKET_SOURCES)) {
      const m = byNum.get(Number(numStr));
      if (!m) continue;
      const wantLoser = Number(numStr) === 103;
      sources.forEach((srcNum, i) => {
        const side = i === 0 ? 'HomeTeam' : 'AwayTeam';
        if (isRealTeam(m[side])) return;
        const src = byNum.get(srcNum);
        const w = matchWinner(src);
        if (!w) return;
        const fill = wantLoser
          ? (w === src.HomeTeam ? src.AwayTeam : src.HomeTeam)
          : w;
        if (isRealTeam(fill)) m[side] = fill;
      });
    }
  }
  return fixtures;
}

function matchWinner(m) {
  if (!m) return null;
  if (m.Winner && isRealTeam(m.Winner)) return m.Winner;
  if (m.HomeTeamScore == null || m.AwayTeamScore == null) return null;
  if (!isRealTeam(m.HomeTeam) || !isRealTeam(m.AwayTeam)) return null;
  if (m.HomeTeamScore > m.AwayTeamScore) return m.HomeTeam;
  if (m.AwayTeamScore > m.HomeTeamScore) return m.AwayTeam;
  return null; // knockout draw → needs explicit winner (penalties)
}

function computeStandings(fixtures) {
  const groups = {};
  for (const m of fixtures) {
    if (!m.Group) continue;
    const g = (groups[m.Group] ||= { rows: {}, played: 0, total: 0 });
    g.total++;
    for (const t of [m.HomeTeam, m.AwayTeam]) {
      g.rows[t] ||= { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 };
    }
    if (m.HomeTeamScore == null || m.AwayTeamScore == null) continue;
    g.played++;
    const h = g.rows[m.HomeTeam], a = g.rows[m.AwayTeam];
    const hs = m.HomeTeamScore, as = m.AwayTeamScore;
    h.p++; a.p++; h.gf += hs; h.ga += as; a.gf += as; a.ga += hs;
    if (hs > as) { h.w++; a.l++; h.pts += 3; }
    else if (as > hs) { a.w++; h.l++; a.pts += 3; }
    else { h.d++; a.d++; h.pts++; a.pts++; }
  }
  const out = {};
  for (const [name, g] of Object.entries(groups)) {
    const rows = Object.values(g.rows);
    rows.forEach((r) => (r.gd = r.gf - r.ga));
    rows.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team));
    out[name] = { rows, complete: g.played === g.total, played: g.played, total: g.total };
  }
  return out;
}

function teamStatuses(fixtures) {
  const status = {}; // team -> 'in' | 'out' | 'champion'
  for (const t of Object.keys(TEAM_RANKS)) status[t] = 'in';

  // Knockout losers are out (third-place playoff doesn't eliminate anyone new).
  for (const m of fixtures) {
    if (m.RoundNumber < 4 || m.MatchNumber === 103) continue;
    const w = matchWinner(m);
    if (!w) continue;
    const loser = w === m.HomeTeam ? m.AwayTeam : m.HomeTeam;
    if (status[loser] !== undefined) status[loser] = 'out';
  }

  // Once the full Round-of-32 field is known, everyone outside it is out.
  const r32 = fixtures.filter((m) => m.RoundNumber === 4);
  const r32Teams = new Set();
  let fieldKnown = r32.length === 16;
  for (const m of r32) {
    if (isRealTeam(m.HomeTeam)) r32Teams.add(m.HomeTeam); else fieldKnown = false;
    if (isRealTeam(m.AwayTeam)) r32Teams.add(m.AwayTeam); else fieldKnown = false;
  }
  if (fieldKnown) {
    for (const t of Object.keys(status)) if (!r32Teams.has(t)) status[t] = 'out';
  }

  const final = fixtures.find((m) => m.MatchNumber === 104);
  const champ = matchWinner(final);
  if (champ && status[champ] !== undefined) status[champ] = 'champion';
  return status;
}

// ---------------------------------------------------------------------------
// The draw: every participant gets exactly one top contender, the rest are
// dealt in shuffled strength bands so squads stay balanced.
// ---------------------------------------------------------------------------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function runDraw() {
  const n = state.participants.length;
  const teams = Object.keys(TEAM_RANKS).sort((a, b) => TEAM_RANKS[a] - TEAM_RANKS[b]);
  const assignments = {};
  const topPicks = {};

  // Pot 1: the top N teams — one contender each, shuffled.
  const contenders = shuffle(teams.slice(0, n));
  const order = shuffle(state.participants.map((p) => p.id));
  order.forEach((pid, i) => {
    assignments[contenders[i]] = pid;
    topPicks[pid] = contenders[i];
  });

  // Remaining teams: deal one per participant per strength band, shuffling
  // both the band and the participant order each time.
  const rest = teams.slice(n);
  for (let i = 0; i < rest.length; i += n) {
    const band = shuffle(rest.slice(i, i + n));
    const dealOrder = shuffle(order);
    band.forEach((team, j) => { assignments[team] = dealOrder[j]; });
  }

  state.assignments = assignments;
  state.topPicks = topPicks;
  state.drawnAt = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Feed sync + BBC news
// ---------------------------------------------------------------------------
let lastSyncAttempt = 0;
async function syncFeed(force = false) {
  const now = Date.now();
  if (!force && now - lastSyncAttempt < SYNC_COOLDOWN_MS) {
    return { synced: false, reason: 'cooldown', lastSync: state.lastSync };
  }
  lastSyncAttempt = now;
  const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Feed responded ' + res.status);
  const fixtures = await res.json();
  if (!Array.isArray(fixtures) || fixtures.length < 100) {
    throw new Error('Feed returned unexpected payload (' + fixtures.length + ' items)');
  }
  state.fixtures = fixtures;
  state.lastSync = new Date().toISOString();
  saveState();
  return { synced: true, lastSync: state.lastSync };
}

async function fetchNews() {
  const res = await fetch(BBC_RSS, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('RSS responded ' + res.status);
  const xml = await res.text();
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < 12) {
    const block = m[1];
    const get = (tag) => {
      const r = new RegExp('<' + tag + '>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</' + tag + '>').exec(block);
      return r ? r[1].trim() : '';
    };
    items.push({ title: get('title'), link: get('link'), date: get('pubDate') });
  }
  return items;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
function buildClientState() {
  const fixtures = effectiveFixtures();
  const standings = computeStandings(fixtures);
  const statuses = teamStatuses(fixtures);

  const groupOf = {};
  for (const m of state.fixtures) {
    if (m.Group) { groupOf[m.HomeTeam] = m.Group; groupOf[m.AwayTeam] = m.Group; }
  }

  const teams = Object.keys(TEAM_RANKS).map((name) => ({
    name,
    flag: FLAGS[name] || '🏳️',
    rank: TEAM_RANKS[name],
    group: groupOf[name] || null,
    owner: state.assignments[name] || null,
    status: statuses[name],
  })).sort((a, b) => a.rank - b.rank);

  return {
    participants: state.participants,
    assignments: state.assignments,
    topPicks: state.topPicks,
    locked: state.locked,
    drawnAt: state.drawnAt,
    lockedAt: state.lockedAt,
    lastSync: state.lastSync,
    teams,
    fixtures: fixtures.map((m) => ({
      ...m,
      roundName: ROUND_NAMES[m.RoundNumber] || 'Round ' + m.RoundNumber,
      winner: matchWinner(m),
    })),
    standings,
  };
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

const PALETTE = ['#e63946', '#2a9d8f', '#e9c46a', '#577590', '#f4a261', '#9b5de5',
  '#00bbf9', '#f15bb5', '#80b918', '#ff6d00', '#0ead69', '#b56576',
  '#4cc9f0', '#ffd166', '#8338ec', '#fb5607'];

async function handleApi(req, res, url) {
  const route = req.method + ' ' + url.pathname;

  if (route === 'GET /api/state') return json(res, 200, buildClientState());

  if (route === 'GET /api/news') {
    try { return json(res, 200, await fetchNews()); }
    catch (e) { return json(res, 502, { error: e.message }); }
  }

  if (route === 'POST /api/sync') {
    try {
      const body = await readBody(req).catch(() => ({}));
      const out = await syncFeed(!!body.force);
      return json(res, 200, { ...out, state: buildClientState() });
    } catch (e) { return json(res, 502, { error: e.message }); }
  }

  if (route === 'POST /api/participants') {
    if (state.locked) return json(res, 409, { error: 'Sweepstake is locked' });
    const { name } = await readBody(req);
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) return json(res, 400, { error: 'Name required' });
    if (state.participants.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      return json(res, 409, { error: clean + ' is already in' });
    }
    if (state.participants.length >= 48) return json(res, 409, { error: 'Max 48 participants' });
    state.participants.push({
      id: crypto.randomUUID(),
      name: clean,
      color: PALETTE[state.participants.length % PALETTE.length],
    });
    state.assignments = {}; state.topPicks = {}; state.drawnAt = null;
    saveState();
    return json(res, 200, buildClientState());
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/participants/')) {
    if (state.locked) return json(res, 409, { error: 'Sweepstake is locked' });
    const id = url.pathname.split('/').pop();
    state.participants = state.participants.filter((p) => p.id !== id);
    state.assignments = {}; state.topPicks = {}; state.drawnAt = null;
    saveState();
    return json(res, 200, buildClientState());
  }

  if (route === 'POST /api/draw') {
    if (state.locked) return json(res, 409, { error: 'Sweepstake is locked — unlock to redraw' });
    if (state.participants.length < 2) return json(res, 400, { error: 'Need at least 2 participants' });
    runDraw();
    saveState();
    return json(res, 200, buildClientState());
  }

  if (route === 'POST /api/lock') {
    if (!state.drawnAt) return json(res, 400, { error: 'Run the draw first' });
    state.locked = true;
    state.lockedAt = new Date().toISOString();
    saveState();
    return json(res, 200, buildClientState());
  }

  if (route === 'POST /api/unlock') {
    state.locked = false;
    state.lockedAt = null;
    saveState();
    return json(res, 200, buildClientState());
  }

  if (route === 'POST /api/result') {
    const { matchNumber, homeScore, awayScore, winner, homeTeam, awayTeam } = await readBody(req);
    const m = state.fixtures.find((f) => f.MatchNumber === Number(matchNumber));
    if (!m) return json(res, 404, { error: 'No such match' });
    const ov = (state.manual[matchNumber] ||= {});
    if (homeTeam !== undefined) ov.homeTeam = homeTeam || undefined;
    if (awayTeam !== undefined) ov.awayTeam = awayTeam || undefined;
    if (homeScore !== undefined) ov.homeScore = homeScore === null ? undefined : Number(homeScore);
    if (awayScore !== undefined) ov.awayScore = awayScore === null ? undefined : Number(awayScore);
    if (winner !== undefined) ov.winner = winner || undefined;
    if (Object.values(ov).every((v) => v === undefined)) delete state.manual[matchNumber];
    saveState();
    return json(res, 200, buildClientState());
  }

  return json(res, 404, { error: 'Not found' });
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    file = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
    const full = path.join(ROOT, 'public', file);
    if (!full.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log('⚽ World Cup 2026 sweepstake → http://localhost:' + PORT);
  // Refresh fixtures in the background on boot (non-fatal if offline).
  syncFeed(true).then(
    (r) => console.log('Feed synced at', r.lastSync),
    (e) => console.log('Feed sync skipped:', e.message),
  );
});
