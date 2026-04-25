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
  setupSettingsTab();

  await loadAllData();
  await seedPredictionsIfNeeded();

  fullRender();
  await loadArchiveData();

  setInterval(async () => {
    await loadAllData();
    fullRender();
  }, 30000);
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

  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.subtab;
      document.querySelectorAll('.sub-tab-content').forEach(panel => {
        panel.classList.toggle('active', panel.id === `subtab-${target}`);
      });
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
   SEEDING
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
  if (!fixtures || fixtures.length === 0) return;

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
        fixture_id:   fixture.id,
        home_score:   score[0],
        away_score:   score[1],
        submitted_at: seed.submittedAt,
      });
    }
  }

  await writeFileToGitHub('data/predictions.json', predictionsData);
}

/* ============================================================
   GW LABEL
   ============================================================ */
function getGwLabel() {
  if (fixturesData && fixturesData.fixtures && fixturesData.fixtures.length > 0) {
    const firstKickoff = new Date(fixturesData.fixtures[0].kickoff);
    const dateStr = firstKickoff.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      timeZone: 'Europe/London',
    });
    return `GW${CONFIG.currentGameweek} — ${dateStr}`;
  }
  return CONFIG.currentGwLabel;
}

/* ============================================================
   SECTION 1 — OPENING STANDINGS
   ============================================================ */
function renderOpeningStandings() {
  document.getElementById('gw-label').textContent = getGwLabel();
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

  document.getElementById('gw-label').textContent = getGwLabel();

  if (fixtures.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${3 + CONFIG.participants.length}" class="no-data">
      Fixtures not yet loaded — run the GitHub Actions workflow first.
    </td></tr>`;
    updateTimestamp();
    return;
  }

  const now     = new Date();
  const gwKey   = String(CONFIG.currentGameweek);
  const gwPreds = predictionsData?.gameweeks[gwKey]?.predictions || {};
  const liveMap = buildLiveMap();
  let lastGroup = null;

  fixtures.forEach(fixture => {
    const groupKey = formatGroupHeader(fixture.kickoff);
    if (groupKey !== lastGroup) {
      const headerRow = document.createElement('tr');
      headerRow.className = 'date-group-header';
      headerRow.innerHTML = `<td colspan="${3 + CONFIG.participants.length}">${groupKey}</td>`;
      tbody.appendChild(headerRow);
      lastGroup = groupKey;
    }

    const kickoff     = new Date(fixture.kickoff);
    const started     = now >= kickoff;
    const live        = liveMap[fixture.id] || fixture;
    const status      = live.status || fixture.status || '';
    const isCompleted = COMPLETED.includes(status);
    const isLive      = LIVE.includes(status);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="team-name home-team">${getAlias(fixture.home_team)}</td>
      <td class="team-name away-team">${getAlias(fixture.away_team)}</td>
      <td class="score-cell">${buildScoreCell(live, fixture, started, isLive, isCompleted)}</td>
      ${CONFIG.participants.map(p =>
        buildPredCell(p, fixture, gwPreds[p] || [], live, started, isCompleted, isLive)
      ).join('')}`;
    tbody.appendChild(tr);
  });

  updateTimestamp();
}

function formatGroupHeader(iso) {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function buildLiveMap() {
  const map = {};
  (livescoresData.livescores || []).forEach(l => { map[l.id] = l; });
  return map;
}

function formatElapsed(elapsed, extraTime) {
  if (!elapsed && elapsed !== 0) return '';
  if (extraTime && extraTime > 0) return `${elapsed}+${extraTime}'`;
  return `${elapsed}'`;
}

function buildScoreCell(live, fixture, started, isLive, isCompleted) {
  if (!started) return '<span class="score-vs">vs</span>';
  const h = live.home_score ?? fixture.home_score;
  const a = live.away_score ?? fixture.away_score;
  if (h === null || a === null) return '<span class="score-vs">vs</span>';
  if (isCompleted) return `<span class="score-final">${h} – ${a}</span>`;
  if (isLive) {
    const timeStr  = formatElapsed(live.elapsed, live.elapsed_extra);
    const elapsed  = timeStr ? `<span class="elapsed">${timeStr}</span>` : '';
    return `<span class="score-live">${h} – ${a}</span>${elapsed}`;
  }
  return `<span class="score-final">${h} – ${a}</span>`;
}

function buildPredCell(participant, fixture, preds, live, started, isCompleted, isLive) {
  if (!started) {
    const pred = getActivePrediction(participant, fixture.id, fixture.kickoff, preds);
    return `<td class="pred-cell pred-hidden">${pred ? '✅' : '–'}</td>`;
  }

  const pred     = getActivePrediction(participant, fixture.id, fixture.kickoff, preds);
  const predHome = pred ? pred.home_score : 0;
  const predAway = pred ? pred.away_score : 0;
  const predText = `${predHome}–${predAway}`;
  const noPred   = pred === null;

  const h = live.home_score ?? fixture.home_score;
  const a = live.away_score ?? fixture.away_score;

  if ((!isCompleted && !isLive) || h === null || a === null) {
    return `<td class="pred-cell ${noPred ? 'pred-none' : 'pred-pending'}">${predText}</td>`;
  }

  const pts = scorePrediction(predHome, predAway, h, a);
  const cls = pts === 3 ? 'pred-exact' : pts === 1 ? 'pred-correct' : 'pred-wrong';
  const ptsLabel = `<span class="pts-label">${pts}</span>`;

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
  const pin         = document.getElementById('pred-pin').value.trim();
  const pinCorrect  = CONFIG.pins[participant] === pin;
  const gwKey       = String(CONFIG.currentGameweek);
  const preds       = predictionsData?.gameweeks[gwKey]?.predictions[participant] || [];
  const now         = new Date();

  fixtures.forEach(fixture => {
    const kickoff = new Date(fixture.kickoff);
    const locked  = now >= kickoff;
    const active  = getActivePrediction(participant, fixture.id, fixture.kickoff, preds);
    const homeVal = (active !== null && (locked || pinCorrect)) ? active.home_score : '';
    const awayVal = (active !== null && (locked || pinCorrect)) ? active.away_score : '';

    let submittedLabel = '';
    if (pinCorrect && participant && active && active.submitted_at) {
      submittedLabel = `<span class="pred-submitted-at">Submitted: ${formatTimestampBST(active.submitted_at)}</span>`;
    } else if (pinCorrect && participant && !active) {
      submittedLabel = `<span class="pred-submitted-at pred-submitted-missing">Not yet submitted</span>`;
    }

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
      ${locked ? '<span class="pred-locked">🔒 Locked</span>' : ''}
      ${submittedLabel}`;
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

  const now      = new Date();
  const gwKey    = String(CONFIG.currentGameweek);
  const fixtures = fixturesData.fixtures || [];

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
    if (now >= new Date(fixture.kickoff)) continue;
    const scores = byFixture[fixture.id];
    if (!scores || scores.home === undefined || scores.away === undefined) continue;
    newEntries.push({
      fixture_id:   fixture.id,
      home_score:   scores.home,
      away_score:   scores.away,
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

  if (ok === true) {
    showStatus(statusEl, `Saved at ${formatTimeBST(submittedAt)} BST ✓`, 'success');
    renderFixturesTable();
    renderProjectedStandings();
  } else {
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
  const tbody = document.getElementById('projected-body');
  if (!tbody) return;

  const gwKey    = String(CONFIG.currentGameweek);
  const fixtures = fixturesData.fixtures || [];
  const preds    = predictionsData?.gameweeks?.[gwKey]?.predictions || {};
  const liveMap  = buildLiveMap();

  const rows = CONFIG.participants.map(name => {
    const entry      = CONFIG.openingStandings.find(s => s.name === name) || {};
    const openingPts = entry.points || 0;
    const gwPoints   = computeEarned(name, fixtures, preds, liveMap);
    const notation   = buildPointsNotation(name, fixtures, preds, liveMap);
    const projected  = openingPts + gwPoints;
    return { name, openingPts, gwPoints, notation, projected };
  });

  rows.sort((a, b) => b.projected - a.projected);

  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${displayName(r.name)}</td>
      <td>${r.openingPts}</td>
      <td class="notation-cell">${r.gwPoints > 0 ? r.notation : '–'}</td>
      <td><strong>${r.projected}</strong></td>
    </tr>
  `).join('');
}

/* ============================================================
   BLOCK ENDING TABLE
   ============================================================ */
function checkAndRenderBlockEnding() {
  const fixtures = fixturesData.fixtures || [];
  const section  = document.getElementById('block-ending-section');

  if (fixtures.length === 0) { section.style.display = 'none'; return; }

  const liveMap = buildLiveMap();
  const allDone = fixtures.every(f => {
    const status = (liveMap[f.id] || f).status || f.status || '';
    return COMPLETED.includes(status);
  });

  if (!allDone) { section.style.display = 'none'; return; }

  section.style.display = 'block';
  renderBlockEnding(fixtures, liveMap);

  document.getElementById('archive-btn-container').style.display = 'block';
  document.getElementById('archive-gw-btn').onclick = archiveCurrentGW;
  document.getElementById('roll-gw-btn').onclick = rollToNextGW;
}

function renderBlockEnding(fixtures, liveMap) {
  const tbody   = document.getElementById('block-ending-body');
  const gwKey   = String(CONFIG.currentGameweek);
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
    const opening = (gw.opening_standings.find(s => s.name === p) || {}).points || 0;
    const closing = (gw.closing_standings.find(s => s.name === p) || {}).points || 0;
    const bd      = gw.points_breakdown[p] || { points: 0, notation: '–' };
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

  const fixtures = fixturesData.fixtures || [];
  const liveMap  = buildLiveMap();
  const gwKey    = String(CONFIG.currentGameweek);
  const gwPreds  = predictionsData?.gameweeks[gwKey]?.predictions || {};

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
    gameweek:          CONFIG.currentGameweek,
    label:             getGwLabel(),
    opening_standings: [...CONFIG.openingStandings],
    closing_standings: closingStandings,
    points_breakdown:  pointsBreakdown,
    results,
    predictions:       archivedPredictions,
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
    p => String(p.fixture_id) === String(fixtureId) && new Date(p.submitted_at) < ko
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
  const concludedParts = [];
  const liveParts      = [];
  const preds          = gwPreds[participant] || [];

  for (const fixture of fixtures) {
    const live      = liveMap[fixture.id] || fixture;
    const status    = live.status || fixture.status || '';
    const isComplete = COMPLETED.includes(status);
    const isLive     = LIVE.includes(status);

    if (!isComplete && !isLive) continue;

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

    if (isComplete) {
      concludedParts.push(notation);
    } else {
      liveParts.push(`[${notation}]`);
    }
  }

  const parts = [];
  if (concludedParts.length > 0) parts.push(concludedParts.join(', '));
  if (liveParts.length > 0) parts.push(`<em>${liveParts.join(', ')}</em>`);

  return parts.join(', ') || '–';
}

function getAlias(apiName) {
  for (const [alias, team] of Object.entries(CONFIG.teamAliases)) {
    if (team === apiName) return alias;
  }
  return apiName.split(' ')[0];
}

/* ============================================================
   DISPLAY HELPERS
   ============================================================ */
function displayName(name) {
  return name;
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

function formatTimestampBST(iso) {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch { return iso; }
}

/* ============================================================
   GITHUB CONTENTS API — WRITE WITH 409 RETRY
   ============================================================ */
async function writeFileToGitHub(path, newContent) {
  const apiBase = `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${path}`;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const sha = await getCurrentSHA(apiBase);
      if (sha === null) return false;
      const result = await doPut(apiBase, newContent, sha);
      if (result === 409) continue;
      return result;
    }
    return false;
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
  const finalString = typeof newContent === 'string'
    ? newContent
    : JSON.stringify(newContent, null, 2);

  const body = JSON.stringify({
    message: `chore: update ${apiBase.split('/contents/')[1]}`,
    content: btoa(unescape(encodeURIComponent(finalString))),
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

/* ============================================================
   ROLL TO NEXT GAMEWEEK
   ============================================================ */
async function rollToNextGW() {
  const pin = prompt('Enter Kris\'s admin PIN to roll to the next gameweek:');
  if (pin === null) return;
  if (CONFIG.pins['Kris'] !== pin) { alert('Incorrect PIN.'); return; }

  const currentArchive = archiveData || await fetchJSON('data/archive.json');
  if (!currentArchive || !currentArchive.gameweeks || currentArchive.gameweeks.length === 0) {
    alert('No archived gameweeks found. Archive the current one first!');
    return;
  }

  const lastGW    = currentArchive.gameweeks[currentArchive.gameweeks.length - 1];
  const nextGWNum = CONFIG.currentGameweek + 1;

  const newOpeningStandings = [...lastGW.closing_standings]
    .sort((a, b) => b.points - a.points)
    .map(s => ({ name: s.name, points: s.points }));

  const newConfigObj = {
    ...CONFIG,
    currentGameweek: nextGWNum,
    currentGwLabel:  `GW${nextGWNum} — TBD`,
    openingStandings: newOpeningStandings,
    seededPredictions: {
      gw: nextGWNum,
      submittedAt: new Date().toISOString(),
      byFixture: [],
    },
  };

  const btn = document.getElementById('roll-gw-btn');
  btn.disabled = true;
  btn.textContent = 'Rolling...';

  const ok = await saveSafeConfig(newConfigObj);

  if (ok === true) {
    try {
      await fetch(`https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/actions/workflows/update-scores.yml/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `token ${CONFIG.githubPAT}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      });
      btn.textContent = 'Fetching fixtures...';
      await new Promise(r => setTimeout(r, 35000));
    } catch (e) {
      console.warn('Could not trigger fixture fetch:', e);
    }
    alert(`Success! Rolled over to GW${nextGWNum}. App will now reload.`);
    window.location.reload();
  } else {
    alert('Failed to update config.js. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Roll to Next Gameweek';
  }
}

/* ============================================================
   SETTINGS / PIN MANAGEMENT
   ============================================================ */
function setupSettingsTab() {
  const sel = document.getElementById('pin-participant');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select —</option>';
  CONFIG.participants.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    sel.appendChild(opt);
  });
  document.getElementById('pin-submit-btn').addEventListener('click', changePin);
}

async function changePin() {
  const participant = document.getElementById('pin-participant').value;
  const currentPin  = document.getElementById('pin-current').value.trim();
  const newPin      = document.getElementById('pin-new').value.trim();
  const statusEl    = document.getElementById('pin-status');

  if (!participant) { showStatus(statusEl, 'Please select a participant.', 'error'); return; }
  if (CONFIG.pins[participant] !== currentPin) { showStatus(statusEl, 'Current PIN is incorrect.', 'error'); return; }
  if (newPin.length !== 4 || !/^\d+$/.test(newPin)) { showStatus(statusEl, 'New PIN must be 4 digits.', 'error'); return; }

  showStatus(statusEl, 'Saving new PIN...', 'info');
  document.getElementById('pin-submit-btn').disabled = true;

  const newConfigObj = { ...CONFIG };
  newConfigObj.pins[participant] = newPin;

  const ok = await saveSafeConfig(newConfigObj);
  document.getElementById('pin-submit-btn').disabled = false;

  if (ok === true) {
    showStatus(statusEl, 'PIN changed successfully! ✓', 'success');
    CONFIG.pins[participant] = newPin;
    document.getElementById('pin-current').value = '';
    document.getElementById('pin-new').value = '';
  } else {
    showStatus(statusEl, 'Failed to save PIN. Try again.', 'error');
  }
}

async function saveSafeConfig(configObj) {
  const pat     = configObj.githubPAT;
  const safePat = `['${pat.substring(0, 20)}', '${pat.substring(20)}'].join('')`;

  const copy = { ...configObj };
  delete copy.githubPAT;

  let jsonStr = JSON.stringify(copy, null, 2);
  jsonStr = jsonStr.replace('{\n', `{\n  "githubPAT": ${safePat},\n`);

  const fileContent = `// auto-updated config\n\nconst CONFIG = ${jsonStr};\n`;
  return await writeFileToGitHub('data/config.js', fileContent);
}

async function forceUpdate() {
  const btn     = document.getElementById('force-update-btn');
  const debugEl = document.getElementById('debug-log');
  btn.disabled  = true;
  btn.textContent = '⏳ Fetching…';
  if (debugEl) debugEl.textContent = '';

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(
      `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/actions/workflows/update-scores.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${CONFIG.githubPAT}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      if (debugEl) debugEl.textContent = `Failed: ${res.status} — ${text}`;
      btn.textContent = `❌ Failed (${res.status})`;
      btn.disabled = false;
      return;
    }

    if (debugEl) debugEl.textContent = `OK: ${res.status} — workflow triggered`;

  } catch (e) {
    clearTimeout(timeout);
    if (debugEl) debugEl.textContent = e.name === 'AbortError'
      ? 'Timed out / CORS blocked'
      : `Error: ${e.message}`;
  }

  let seconds = 35;
  const timer = setInterval(() => {
    seconds -= 1;
    btn.textContent = seconds > 0 ? `⏳ Waiting ${seconds}s…` : '⏳ Loading…';
  }, 1000);

  await new Promise(r => setTimeout(r, 35000));
  clearInterval(timer);

  await loadAllData();
  fullRender();

  if (debugEl) debugEl.textContent = '';
  btn.disabled    = false;
  btn.textContent = '🔄 Force Update';
}
