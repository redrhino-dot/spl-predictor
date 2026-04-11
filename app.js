/* ============================================================
   app.js — Scottish Premiership Predictor
   ============================================================ */

const COMPLETED = ['FT', 'AET', 'PEN'];
const LIVE      = ['1H', 'HT', '2H', 'ET', 'P', 'LIVE'];
const IN_PLAY   = [...LIVE, ...COMPLETED];

let fixturesData   = { fixtures: [], updated: null };
let livescoresData = { livescores: [] };
let predictionsData = null;
let archiveData     = null;

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  renderOpeningStandings();
  populateParticipantDropdown();

  await loadAllData();
  await seedPredictionsIfNeeded();

  fullRender();
  await loadArchiveData();

  // Refresh live data + re-render every 60 s
  setInterval(async () => {
    await loadAllData();
    fullRender();
  }, 60000);
});

function fullRender() {
  renderFixturesTable();
  renderPredictionForm();
  renderProjectedStandings();
  checkAndRenderBlockEnding();
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

/* ============================================================
   DATA LOADING
   ============================================================ */
async function fetchJSON(url) {
  try {
    const res = await fetch(url + '?_=' + Date.now());
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function loadAllData() {
  const [f, l, p] = await Promise.all([
    fetchJSON('data/fixtures.json'),
    fetchJSON('data/livescores.json'),
    fetchJSON('data/predictions.json'),
  ]);
  if (f) fixturesData   = f;
  if (l) livescoresData = l;
  if (p) predictionsData = p;
}

/* ============================================================
   SEEDING — write CONFIG.seededPredictions into predictions.json
   only if GW has no data yet
   ============================================================ */
async function seedPredictionsIfNeeded() {
  if (!predictionsData) return;
  const seed   = CONFIG.seededPredictions;
  const gwKey  = String(seed.gw);
  const gwNode = predictionsData.gameweeks[gwKey];
  if (!gwNode) return;

  const hasData = CONFIG.participants.some(
    p => gwNode.predictions[p] && gwNode.predictions[p].length > 0
  );
  if (hasData) return;

  const fixtures = fixturesData.fixtures;
  if (!fixtures || fixtures.length === 0) return;   // workflow not yet run

  for (const fe of seed.byFixture) {
    const fixture = fixtures.find(
      f => f.home_team === fe.homeTeam && f.away_team === fe.awayTeam
    );
    if (!fixture) continue;

    for (const participant of CONFIG.participants) {
      const score = fe[participant];
      if (!score) continue;
      if (!gwNode.predictions[participant]) gwNode.predictions[participant] = [];
      gwNode.predictions[participant].push({
        fixture_id:  fixture.id,
        home_score:  score[0],
        away_score:  score[1],
        submitted_at: seed.submittedAt,
      });
    }
  }

  await writeFileToGitHub('data/predictions.json', predictionsData);
}

/* ============================================================
   SECTION 1 — OPENING STANDINGS
   ============================================================ */
function renderOpeningStandings() {
  document.getElementById('gw-label').textContent = CONFIG.currentGwLabel;
  const tbody = document.getElementById('opening-standings-body');
  tbody.innerHTML = '';
  [...CONFIG.openingStandings]
    .sort((a, b) => b.points - a.points)
    .forEach((entry, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${displayName(entry.name)}</td>
        <td><strong>${entry.points}</strong></td>`;
      tbody.appendChild(tr);
    });
}

/* ============================================================
   SECTION 2 — FIXTURES TABLE
   ============================================================ */
function renderFixturesTable() {
  const tbody    = document.getElementById('fixtures-body');
  const fixtures = fixturesData.fixtures || [];
  tbody.innerHTML = '';

  if (fixtures.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="no-data">
      Fixtures not yet loaded — run the GitHub Actions workflow first.
    </td></tr>`;
    updateTimestamp();
    return;
  }

  const now    = new Date();
  const gwKey  = String(CONFIG.currentGameweek);
  const gwPreds = predictionsData?.gameweeks[gwKey]?.predictions || {};
  const liveMap = buildLiveMap();

  fixtures.forEach(fixture => {
    const kickoff    = new Date(fixture.kickoff);
    const started    = now >= kickoff;
    const live       = liveMap[fixture.id] || fixture;
    const status     = live.status || fixture.status || '';
    const isCompleted = COMPLETED.includes(status);
    const isLive      = LIVE.includes(status);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="team-name home-team">${fixture.home_team}</td>
      <td class="kickoff-time">${formatKickoffBST(fixture.kickoff)}</td>
      <td class="score-cell">${buildScoreCell(live, fixture, started, isLive, isCompleted)}</td>
      <td class="team-name away-team">${fixture.away_team}</td>
      ${CONFIG.participants.map(p =>
        buildPredCell(p, fixture, gwPreds[p] || [], live, started, isCompleted, isLive)
      ).join('')}`;
    tbody.appendChild(tr);
  });

  updateTimestamp();
}

function buildLiveMap() {
  const map = {};
  (livescoresData.livescores || []).forEach(l => { map[l.id] = l; });
  return map;
}

function buildScoreCell(live, fixture, started, isLive, isCompleted) {
  if (!started) return '<span class="score-vs">vs</span>';
  const h = live.home_score ?? fixture.home_score;
  const a = live.away_score ?? fixture.away_score;
  if (h === null || a === null) return '<span class="score-vs">vs</span>';
  if (isCompleted) return `<span class="score-final">${h} – ${a}</span>`;
  if (isLive) {
    const elapsed = live.elapsed ? `<span class="elapsed">${live.elapsed}'</span>` : '';
    return `<span class="score-live">${h} – ${a}</span>${elapsed}`;
  }
  return `<span class="score-final">${h} – ${a}</span>`;
}

function buildPredCell(participant, fixture, preds, live, started, isCompleted, isLive) {
  if (!started) return '<td class="pred-cell pred-hidden">–</td>';

  const pred     = getActivePrediction(participant, fixture.id, fixture.kickoff, preds);
  const predHome = pred ? pred.home_score : 0;
  const predAway = pred ? pred.away_score : 0;
  const predText = `${predHome}–${predAway}`;
  const noPred   = pred === null;

  const h = live.home_score ?? fixture.home_score;
  const a = live.away_score ?? fixture.away_score;

  if (!isCompleted && !isLive || h === null || a === null) {
    return `<td class="pred-cell ${noPred ? 'pred-none' : 'pred-pending'}">${predText}</td>`;
  }

  const pts = scorePrediction(predHome, predAway, h, a);
  const cls = pts === 3 ? 'pred-exact' : pts === 1 ? 'pred-correct' : 'pred-wrong';
  const ptsLabel = `<span class="pts-label">${pts}pt${pts !== 1 ? 's' : ''}</span>`;

  return `<td class="pred-cell ${cls}">${predText}${ptsLabel}</td>`;
}

function updateTimestamp() {
  const el = document.getElementById('last-updated');
  if (fixturesData.updated) {
    el.textContent = 'Data updated: ' + formatTimeBST(fixturesData.updated);
  } else {
    el.textContent = '';
  }
}

/* ============================================================
   PREDICTION ENTRY FORM
   ============================================================ */
function populateParticipantDropdown() {
  const sel = document.getElementById('pred-participant');
  CONFIG.participants.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', renderPredictionForm);
  document.getElementById('pred-pin').addEventListener('input', renderPredictionForm);
}

function renderPredictionForm() {
  const container  = document.getElementById('pred-form-rows');
  const fixtures   = fixturesData.fixtures || [];
  container.innerHTML = '';

  if (fixtures.length === 0) {
    container.innerHTML = '<p class="no-data">No fixtures available.</p>';
    return;
  }

  const participant = document.getElementById('pred-participant').value;
  const gwKey       = String(CONFIG.currentGameweek);
  const preds       = predictionsData?.gameweeks[gwKey]?.predictions[participant] || [];
  const now         = new Date();

  fixtures.forEach(fixture => {
    const kickoff  = new Date(fixture.kickoff);
    const locked   = now >= kickoff;
    const active   = getActivePrediction(participant, fixture.id, fixture.kickoff, preds);
    const homeVal  = active !== null ? active.home_score : '';
    const awayVal  = active !== null ? active.away_score : '';

    const row = document.createElement('div');
    row.className = 'pred-row' + (locked ? ' pred-row-disabled' : '');
    row.innerHTML = `
      <span class="pred-team pred-home">${fixture.home_team}</span>
      <input type="number" class="pred-score-input"
             data-fixture-id="${fixture.id}" data-side="home"
             min="0" max="20" value="${homeVal}" placeholder="0"
             ${locked ? 'disabled' : ''} />
      <span class="pred-separator">–</span>
      <input type="number" class="pred-score-input"
             data-fixture-id="${fixture.id}" data-side="away"
             min="0" max="20" value="${awayVal}" placeholder="0"
             ${locked ? 'disabled' : ''} />
      <span class="pred-team pred-away">${fixture.away_team}</span>
      ${locked ? '<span class="pred-locked">🔒 Locked</span>' : ''}`;
    container.appendChild(row);
  });

  document.getElementById('pred-submit-btn').onclick = submitPredictions;
}

async function submitPredictions() {
  const participant = document.getElementById('pred-participant').value;
  const pin         = document.getElementById('pred-pin').value.trim();
  const statusEl    = document.getElementById('pred-status');

  if (!participant) { showStatus(statusEl, 'Please select a participant.', 'error'); return; }
  if (CONFIG.pins[participant] !== pin) { showStatus(statusEl, 'Incorrect PIN.', 'error'); return; }

  const now     = new Date();
  const gwKey   = String(CONFIG.currentGameweek);
  const fixtures = fixturesData.fixtures || [];

  // Collect score inputs
  const byFixture = {};
  document.querySelectorAll('.pred-score-input').forEach(input => {
    const fid  = parseInt(input.dataset.fixtureId);
    const side = input.dataset.side;
    if (!byFixture[fid]) byFixture[fid] = {};
    byFixture[fid][side] = input.value === '' ? 0 : parseInt(input.value) || 0;
  });

  const submittedAt = new Date().toISOString();
  const newEntries  = [];

  for (const fixture of fixtures) {
    if (now >= new Date(fixture.kickoff)) continue;  // locked
    const scores = byFixture[fixture.id];
    if (!scores || scores.home === undefined || scores.away === undefined) continue;
    newEntries.push({
      fixture_id:  fixture.id,
      home_score:  scores.home,
      away_score:  scores.away,
      submitted_at: submittedAt,
    });
  }

  if (newEntries.length === 0) {
    showStatus(statusEl, 'No open fixtures to submit.', 'warning');
    return;
  }

  if (!predictionsData.gameweeks[gwKey]) {
    predictionsData.gameweeks[gwKey] = { predictions: {} };
  }
  if (!predictionsData.gameweeks[gwKey].predictions[participant]) {
    predictionsData.gameweeks[gwKey].predictions[participant] = [];
  }
  newEntries.forEach(e => predictionsData.gameweeks[gwKey].predictions[participant].push(e));

  showStatus(statusEl, 'Saving…', 'info');
  document.getElementById('pred-submit-btn').disabled = true;

  const ok = await writeFileToGitHub('data/predictions.json', predictionsData);
  document.getElementById('pred-submit-btn').disabled = false;

  if (ok) {
    showStatus(statusEl, `Saved at ${formatTimeBST(submittedAt)} BST ✓`, 'success');
    renderFixturesTable();
    renderProjectedStandings();
  } else {
    // Roll back the local append so state stays consistent
    const arr = predictionsData.gameweeks[gwKey].predictions[participant];
    predictionsData.gameweeks[gwKey].predictions[participant] =
      arr.slice(0, arr.length - newEntries.length);
    showStatus(statusEl, 'Save failed — please try again.', 'error');
  }
}

function showStatus(el, msg, type) {
  el.textContent = msg;
  el.className   = 'pred-status status-' + type;
}

/* ============================================================
   SECTION 3 — PROJECTED STANDINGS
   ============================================================ */
function renderProjectedStandings() {
  const container = document.getElementById('projected-standings');
  if (!container) return;

  const gwKey    = String(CONFIG.currentGameweek);
  const fixtures = fixturesData.fixtures || [];
  const preds    = predictionsData.gameweeks?.[gwKey]?.predictions || {};
  const opening  = CONFIG.openingStandings || {};

  const rows = CONFIG.participants.map(name => {
    const myPreds = preds[name] || [];
    let gwPoints  = 0;
    const earned  = [];

    for (const fixture of fixtures) {
      if (fixture.home_score === null || fixture.away_score === null) continue;
      if (fixture.status !== 'FT' && fixture.status !== 'AET' && fixture.status !== 'PEN') continue;

      const pred = myPreds.find(p => String(p.fixture_id) === String(fixture.id));
      if (!pred) continue;

      const actualHome = fixture.home_score;
      const actualAway = fixture.away_score;
      const predHome   = pred.home_score;
      const predAway   = pred.away_score;

      // Exact score
      if (predHome === actualHome && predAway === actualAway) {
        gwPoints += 3;
        earned.push(`${fixture.home_team.split(' ')[0]} 3`);
        continue;
      }
      // Correct result
      const actualResult = Math.sign(actualHome - actualAway);
      const predResult   = Math.sign(predHome   - predAway);
      if (actualResult === predResult) {
        gwPoints += 1;
        earned.push(`${fixture.home_team.split(' ')[0]} 1`);
      }
    }

    const openingPts  = opening[name] || 0;
    const projected   = openingPts + gwPoints;
    return { name, openingPts, gwPoints, projected, earned };
  });

  rows.sort((a, b) => b.projected - a.projected);

  container.innerHTML = `
    <h2 class="section-title">PROJECTED CLOSING STANDINGS</h2>
    <div class="table-wrapper">
      <table class="standings-table">
        <thead>
          <tr>
            <th>#</th>
            <th>PARTICIPANT</th>
            <th>OPENING PTS</th>
            <th>POINTS EARNED</th>
            <th>PROJECTED TOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${r.name}</td>
              <td>${r.openingPts}</td>
              <td class="points-earned">${r.earned.length
                ? r.earned.map(e => `<span class="earned-tag">${e}</span>`).join(' ')
                : '<span class="no-points">—</span>'
              }</td>
              <td><strong>${r.projected}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}


/* ============================================================
   BLOCK ENDING TABLE
   ============================================================ */
function checkAndRenderBlockEnding() {
  const fixtures = fixturesData.fixtures || [];
  const section  = document.getElementById('block-ending-section');

  if (fixtures.length === 0) { section.style.display = 'none'; return; }

  const liveMap  = buildLiveMap();
  const allDone  = fixtures.every(f => {
    const status = (liveMap[f.id] || f).status || f.status || '';
    return COMPLETED.includes(status);
  });

  if (!allDone) { section.style.display = 'none'; return; }

  section.style.display = 'block';
  renderBlockEnding(fixtures, liveMap);

  document.getElementById('archive-btn-container').style.display = 'block';
  document.getElementById('archive-gw-btn').onclick = archiveCurrentGW;
}

function renderBlockEnding(fixtures, liveMap) {
  const tbody  = document.getElementById('block-ending-body');
  const gwKey  = String(CONFIG.currentGameweek);
  const gwPreds = predictionsData?.gameweeks[gwKey]?.predictions || {};

  const rows = CONFIG.openingStandings.map(entry => {
    const earned   = computeEarned(entry.name, fixtures, gwPreds, liveMap);
    const notation = buildPointsNotation(entry.name, fixtures, gwPreds, liveMap);
    return { name: entry.name, opening: entry.points, earned, notation, closing: entry.points + earned };
  }).sort((a, b) => b.closing - a.closing);

  tbody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${displayName(row.name)}</td>
      <td>${row.opening}</td>
      <td class="notation-cell">${row.earned > 0 ? row.notation : '–'}</td>
      <td><strong>${row.closing}</strong></td>`;
    tbody.appendChild(tr);
  });
}

/* ============================================================
   ARCHIVE
   ============================================================ */
async function loadArchiveData() {
  archiveData = await fetchJSON('data/archive.json');
  if (!archiveData?.gameweeks) return;

  const sel = document.getElementById('archive-select');
  sel.innerHTML = '<option value="">— Select a completed gameweek —</option>';

  [...archiveData.gameweeks].reverse().forEach(gw => {
    const opt = document.createElement('option');
    opt.value = gw.gameweek;
    opt.textContent = gw.label;
    sel.appendChild(opt);
  });

  sel.addEventListener('change', () => {
    const gwNum = parseInt(sel.value);
    const container = document.getElementById('archive-content');
    if (!gwNum) { container.innerHTML = ''; return; }
    const gw = archiveData.gameweeks.find(g => g.gameweek === gwNum);
    if (gw) renderArchiveGW(gw);
  });
}

function renderArchiveGW(gw) {
  const container = document.getElementById('archive-content');
  container.innerHTML = '';
  container.appendChild(buildArchiveStandingsTable('Opening Standings', gw.opening_standings));
  if (gw.results && gw.results.length > 0) {
    container.appendChild(buildArchivePredTable(gw));
  }
  container.appendChild(buildArchiveBlockEnding(gw));
}

function buildArchiveStandingsTable(title, standings) {
  const wrap = document.createElement('div');
  wrap.className = 'archive-sub-section';
  wrap.innerHTML = `<h3>${title}</h3>`;
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead><tr><th>#</th><th>Participant</th><th>Points</th></tr></thead>
    <tbody>
      ${[...standings].sort((a, b) => b.points - a.points).map((s, i) => `
        <tr><td>${i + 1}</td><td>${displayName(s.name)}</td><td><strong>${s.points}</strong></td></tr>
      `).join('')}
    </tbody>`;
  wrap.appendChild(table);
  return wrap;
}

function buildArchivePredTable(gw) {
  const wrap = document.createElement('div');
  wrap.className = 'archive-sub-section';
  wrap.innerHTML = '<h3>Predictions &amp; Results</h3>';

  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';

  const table = document.createElement('table');
  table.className = 'data-table fixtures-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Home Team</th><th>Score</th><th>Away Team</th>
        ${CONFIG.participants.map(p => `<th>${p}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${(gw.results || []).map(result => {
        const h = result.home_score, a = result.away_score;
        const predCells = CONFIG.participants.map(p => {
          const savedPreds = gw.predictions[p] || [];
          const pred = savedPreds.find(pr => pr.fixture_id === result.fixture_id);
          const ph = pred ? pred.home_score : 0;
          const pa = pred ? pred.away_score : 0;
          const pts = scorePrediction(ph, pa, h, a);
          const cls = pts === 3 ? 'pred-exact' : pts === 1 ? 'pred-correct' : 'pred-wrong';
          return `<td class="pred-cell ${cls}">${ph}–${pa}
            <span class="pts-label">${pts}pt${pts !== 1 ? 's' : ''}</span></td>`;
        }).join('');
        return `<tr>
          <td class="team-name">${result.home_team}</td>
          <td class="score-cell"><span class="score-final">${h} – ${a}</span></td>
          <td class="team-name">${result.away_team}</td>
          ${predCells}
        </tr>`;
      }).join('')}
    </tbody>`;

  scroll.appendChild(table);
  wrap.appendChild(scroll);
  return wrap;
}

function buildArchiveBlockEnding(gw) {
  const wrap = document.createElement('div');
  wrap.className = 'archive-sub-section';
  wrap.innerHTML = '<h3>Gameweek Summary</h3>';

  const rows = CONFIG.participants.map(p => {
    const opening  = (gw.opening_standings.find(s => s.name === p) || {}).points || 0;
    const closing  = (gw.closing_standings.find(s => s.name === p) || {}).points || 0;
    const bd       = gw.points_breakdown[p] || { points: 0, notation: '–' };
    return { name: p, opening, earned: bd.points, notation: bd.notation, closing };
  }).sort((a, b) => b.closing - a.closing);

  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Participant</th><th>Opening Pts</th>
        <th>Points Earned</th><th>Closing Pts</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(r => `
        <tr>
          <td>${displayName(r.name)}</td>
          <td>${r.opening}</td>
          <td class="notation-cell">${r.earned > 0 ? r.notation : '–'}</td>
          <td><strong>${r.closing}</strong></td>
        </tr>`).join('')}
    </tbody>`;

  wrap.appendChild(table);
  return wrap;
}

async function archiveCurrentGW() {
  const pin = prompt('Enter Kris\'s admin PIN to archive this gameweek:');
  if (pin === null) return;
  if (CONFIG.pins['Kris'] !== pin) { alert('Incorrect PIN.'); return; }

  const fixtures  = fixturesData.fixtures || [];
  const liveMap   = buildLiveMap();
  const gwKey     = String(CONFIG.currentGameweek);
  const gwPreds   = predictionsData?.gameweeks[gwKey]?.predictions || {};

  const closingStandings = CONFIG.openingStandings.map(entry => ({
    name:   entry.name,
    points: entry.points + computeEarned(entry.name, fixtures, gwPreds, liveMap),
  }));

  const pointsBreakdown = {};
  CONFIG.participants.forEach(p => {
    pointsBreakdown[p] = {
      points:   computeEarned(p, fixtures, gwPreds, liveMap),
      notation: buildPointsNotation(p, fixtures, gwPreds, liveMap),
    };
  });

  const results = fixtures
    .filter(f => COMPLETED.includes((liveMap[f.id] || f).status || f.status || ''))
    .map(f => {
      const live = liveMap[f.id] || f;
      return {
        fixture_id: f.id,
        home_team:  f.home_team,
        away_team:  f.away_team,
        home_score: live.home_score ?? f.home_score,
        away_score: live.away_score ?? f.away_score,
      };
    });

  const archivedPredictions = {};
  CONFIG.participants.forEach(p => {
    archivedPredictions[p] = fixtures.map(f => {
      const pred = getActivePrediction(p, f.id, f.kickoff, gwPreds[p] || []);
      if (!pred) return null;
      return { fixture_id: f.id, home_score: pred.home_score, away_score: pred.away_score };
    }).filter(Boolean);
  });

  const entry = {
    gameweek:           CONFIG.currentGameweek,
    label:              CONFIG.currentGwLabel,
    opening_standings:  [...CONFIG.openingStandings],
    closing_standings:  closingStandings,
    points_breakdown:   pointsBreakdown,
    results,
    predictions:        archivedPredictions,
  };

  const currentArchive = await fetchJSON('data/archive.json') || { gameweeks: [] };
  const existIdx = currentArchive.gameweeks.findIndex(g => g.gameweek === CONFIG.currentGameweek);
  if (existIdx >= 0) {
    if (!confirm(`GW${CONFIG.currentGameweek} is already archived. Overwrite?`)) return;
    currentArchive.gameweeks[existIdx] = entry;
  } else {
    currentArchive.gameweeks.push(entry);
  }

  const ok = await writeFileToGitHub('data/archive.json', currentArchive);
  if (ok) {
    alert(`GW${CONFIG.currentGameweek} archived successfully!`);
    archiveData = currentArchive;
    await loadArchiveData();
  } else {
    alert('Archive failed — please try again.');
  }
}

/* ============================================================
   SCORING UTILITIES
   ============================================================ */
function getActivePrediction(participant, fixtureId, kickoff, preds) {
  const ko       = new Date(kickoff);
  const filtered = (preds || []).filter(
    p => p.fixture_id === fixtureId && new Date(p.submitted_at) < ko
  );
  return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}

function scorePrediction(ph, pa, ah, aa) {
  if (ph === ah && pa === aa) return 3;
  return Math.sign(ph - pa) === Math.sign(ah - aa) ? 1 : 0;
}

function computeEarned(participant, fixtures, gwPreds, liveMap) {
  let total = 0;
  const preds = gwPreds[participant] || [];
  for (const fixture of fixtures) {
    const live   = liveMap[fixture.id] || fixture;
    const status = live.status || fixture.status || '';
    if (!IN_PLAY.includes(status)) continue;
    const h = live.home_score ?? fixture.home_score;
    const a = live.away_score ?? fixture.away_score;
    if (h === null || a === null) continue;
    const pred = getActivePrediction(participant, fixture.id, fixture.kickoff, preds);
    total += scorePrediction(
      pred ? pred.home_score : 0,
      pred ? pred.away_score : 0,
      h, a
    );
  }
  return total;
}

function buildPointsNotation(participant, fixtures, gwPreds, liveMap) {
  const parts = [];
  const preds = gwPreds[participant] || [];

  for (const fixture of fixtures) {
    const live   = liveMap[fixture.id] || fixture;
    const status = live.status || fixture.status || '';
    if (!COMPLETED.includes(status)) continue;
    const h = live.home_score ?? fixture.home_score;
    const a = live.away_score ?? fixture.away_score;
    if (h === null || a === null) continue;

    const pred = getActivePrediction(participant, fixture.id, fixture.kickoff, preds);
    const ph   = pred ? pred.home_score : 0;
    const pa   = pred ? pred.away_score : 0;
    const pts  = scorePrediction(ph, pa, h, a);
    if (pts === 0) continue;

    const draw = h === a;
    let notation;
    if (draw) {
      const t1 = getAlias(fixture.home_team);
      const t2 = getAlias(fixture.away_team);
      notation = pts === 3 ? `${t1}/${t2} 3` : `${t1}/${t2}`;
    } else {
      const winner = h > a ? fixture.home_team : fixture.away_team;
      const alias  = getAlias(winner);
      notation = pts === 3 ? `${alias} 3` : alias;
    }
    parts.push(notation);
  }

  return parts.join(', ') || '–';
}

function getAlias(apiName) {
  for (const [alias, team] of Object.entries(CONFIG.teamAliases)) {
    if (team === apiName) return alias;
  }
  return apiName.split(' ')[0];  // fallback: first word
}

/* ============================================================
   DISPLAY HELPERS
   ============================================================ */
function displayName(name) {
  return name === 'Graham' ? 'Smith' : name;
}

function formatKickoffBST(iso) {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function formatTimeBST(iso) {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return iso; }
}

/* ============================================================
   GITHUB CONTENTS API — WRITE WITH 409 RETRY
   ============================================================ */
async function writeFileToGitHub(path, newContent) {
  const apiBase = `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${path}`;
  try {
    const sha = await getCurrentSHA(apiBase);
    if (sha === null) return false;
    return await doPut(apiBase, newContent, sha);
  } catch (e) {
    console.error('GitHub write error:', e);
    return false;
  }
}

async function getCurrentSHA(apiBase) {
  const res = await fetch(apiBase, {
    headers: {
      Authorization: `token ${CONFIG.githubPAT}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha || null;
}

async function doPut(apiBase, newContent, sha) {
  const body = JSON.stringify({
    message: `chore: update ${apiBase.split('/contents/')[1]}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(newContent, null, 2)))),
    sha,
  });
  const res = await fetch(apiBase, {
    method: 'PUT',
    headers: {
      Authorization: `token ${CONFIG.githubPAT}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body,
  });
  if (res.status === 409) return 409;
  return res.ok;
}
