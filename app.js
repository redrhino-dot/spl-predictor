/* ============================================================
   app.js — Scottish Premiership Predictor
   ============================================================ */

const COMPLETED = ['FT', 'AET', 'PEN', 'PPD'];
const LIVE      = ['1H', 'HT', '2H', 'ET', 'P', 'LIVE'];
const IN_PLAY   = [...LIVE, ...COMPLETED];

let fixturesData    = { fixtures: [], updated: null };
let livescoresData  = { livescores: [] };
let predictionsData = null;
let archiveData      = null;

let predFormDirty = false;
let scoreFormDirty = false;

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  renderOpeningStandings();
  populateParticipantDropdown();
  populateScoreParticipantDropdown();
  setupSettingsTab();
  renderHonoursBoard();

  await loadAllData();
  await seedPredictionsIfNeeded();

  fullRender();
  await loadArchiveData();

  setInterval(async () => {
    await loadAllData();
    renderFixturesTable();
    renderProjectedStandings();
    checkAndRenderBlockEnding();

    if (!predFormDirty) {
      renderPredictionForm();
    }
    if (!scoreFormDirty) {
      renderScoreForm();
    }
  }, 30000);
});

function fullRender() {
  renderFixturesTable();
  renderPredictionForm();
  renderScoreForm();
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
      if (btn.dataset.tab === 'stats') renderStatsTab();
      if (btn.dataset.tab === 'honours') renderHonoursBoard();
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
  if (f) fixturesData    = f;
  if (l) livescoresData  = l;
  if (p) predictionsData = p;

  tagFixturesWithScheduledGameweek();
}

/* ============================================================
   GAMEWEEK ASSIGNMENT — sourced directly from TheSportsDB's own
   round number (fixture.week_number, set by fetch_scores.py).
   schedule.json is retired: it required exact team-name matching
   against TheSportsDB's names (e.g. "Heart of Midlothian" vs the
   old schedule's "Hearts"), which silently misassigned any fixture
   whose name didn't match — orphaning its predictions.
   ============================================================ */
function tagFixturesWithScheduledGameweek() {
  const fixtures = fixturesData.fixtures || [];
  fixtures.forEach(fixture => {
    fixture.assigned_gameweek = fixture.week_number ?? CONFIG.currentGameweek;
  });
}

function getFixturesForGameweek(gwNum) {
  return (fixturesData.fixtures || []).filter(f => f.assigned_gameweek === gwNum);
}

function getDistinctGameweeksInFixtures() {
  const set = new Set((fixturesData.fixtures || []).map(f => f.assigned_gameweek));
  return [...set].sort((a, b) => a - b);
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
   ACTIVE WINDOW SCOPING
   Ensures the app always shows exactly one date-window's fixtures
   at a time (a weekend block, a midweek block, etc.) — regardless
   of how many rounds fetch_scores.py has buffered into
   fixtures.json. A window may span more than one gameweek (e.g. a
   rescheduled fixture landing alongside the current round); that's
   fine — both are shown, grouped by gameweek header, because they
   share the same playing window.
   ============================================================ */
function getActiveWindowFixtures() {
  const fixtures = fixturesData.fixtures || [];
  if (fixtures.length === 0) return [];

  const windows = computeWindows(fixtures);

  // New-format archive entries can match the computed window timestamp exactly.
  const archivedKeys = new Set(
    (archiveData?.windows || []).map(
      w => `${w.window_start}|${w.window_end}`
    )
  );

  // Migrated GW1/GW2 archive entries use date-only timestamps that do not
  // match actual fixture kickoff times. Their fixture IDs are authoritative.
  const archivedFixtureIds = new Set(
    (archiveData?.windows || [])
      .flatMap(w => w.results || [])
      .map(r => String(r.fixture_id))
  );

  const openWindows = windows.filter(window => {
    const exactDateMatch = archivedKeys.has(
      `${window.startDate.toISOString()}|${window.endDate.toISOString()}`
    );

    const everyFixtureArchived =
      window.fixtures.length > 0 &&
      window.fixtures.every(f =>
        archivedFixtureIds.has(String(f.id))
      );

    return !exactDateMatch && !everyFixtureArchived;
  });

  return openWindows.length > 0 ? openWindows[0].fixtures : [];
}


  const openWindows = windows.filter(window => {
    const exactDateMatch = archivedKeys.has(
      `${window.startDate.toISOString()}|${window.endDate.toISOString()}`
    );

    const everyFixtureArchived =
      window.fixtures.length > 0 &&
      window.fixtures.every(f =>
        archivedFixtureIds.has(String(f.id))
      );

    return !exactDateMatch && !everyFixtureArchived;
  });

  return openWindows.length > 0 ? openWindows[0].fixtures : [];
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
  const fixtures = getActiveWindowFixtures();
  tbody.innerHTML = '';

  document.getElementById('gw-label').textContent = getGwLabel();

  if (fixtures.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${3 + CONFIG.participants.length}" class="no-data">
      Fixtures not yet loaded — run the GitHub Actions workflow first.
    </td></tr>`;
    updateTimestamp();
    return;
  }

  const now       = new Date();
  const liveMap   = buildLiveMap();
  const gwNumbers = [...new Set(fixtures.map(f => f.assigned_gameweek))].sort((a, b) => a - b);
  let lastGroup   = null;

  gwNumbers.forEach(gwNum => {
    const gwKey       = String(gwNum);
    const gwPreds     = predictionsData?.gameweeks[gwKey]?.predictions || {};
    const gwFixtures  = fixtures.filter(f => f.assigned_gameweek === gwNum);

    if (gwNumbers.length > 1) {
      const gwHeaderRow = document.createElement('tr');
      gwHeaderRow.className = 'gw-group-header';
      gwHeaderRow.innerHTML = `<td colspan="${3 + CONFIG.participants.length}"><strong>Gameweek ${gwNum}</strong></td>`;
      tbody.appendChild(gwHeaderRow);
    }

    lastGroup = null;

    gwFixtures.forEach(fixture => {
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
      const live        = liveMap[String(fixture.id)] || fixture;
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
  (livescoresData.livescores || []).forEach(l => {
    map[String(l.id)] = l;
  });
  return map;
}

function formatElapsed(elapsed, extraTime) {
  if (!elapsed && elapsed !== 0) return '';
  if (extraTime && extraTime > 0) return `${elapsed}+${extraTime}'`;
  return `${elapsed}'`;
}

function buildScoreCell(live, fixture, started, isLive, isCompleted) {
  const status = live.status || fixture.status || '';
  if (status === 'PPD') return '<span class="score-postponed">Postponed</span>';
  if (!started) return '<span class="score-vs">vs</span>';
  const h = live.home_score ?? fixture.home_score;
  const a = live.away_score ?? fixture.away_score;
  if (h === null || a === null) return '<span class="score-vs">vs</span>';
  if (isCompleted) return `<span class="score-final">${h} – ${a}</span>`;
  if (isLive) {
    const status  = live.status || '';
    const elapsed = live.elapsed ?? 0;
    if (status === 'HT' || (status === '1H' && elapsed >= 45 && !live.elapsed_extra)) {
      return `<span class="score-live">${h} – ${a}</span><span class="elapsed">HT</span>`;
    }
    const timeStr     = formatElapsed(live.elapsed, live.elapsed_extra);
    const elapsedSpan = timeStr ? `<span class="elapsed">${timeStr}</span>` : '';
    return `<span class="score-live">${h} – ${a}</span>${elapsedSpan}`;
  }
  return `<span class="score-live">${h} – ${a}</span>`;
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

  const pts      = scorePrediction(predHome, predAway, h, a);
  const cls      = pts === 3 ? 'pred-exact' : pts === 1 ? 'pred-correct' : 'pred-wrong';
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
  sel.addEventListener('change', () => {
    predFormDirty = false;
    renderPredictionForm();
  });
  document.getElementById('pred-pin').addEventListener('input', () => {
    predFormDirty = false;
    renderPredictionForm();
  });
}

function renderPredictionForm() {
  const container = document.getElementById('pred-form-rows');
  const fixtures  = getActiveWindowFixtures();
  container.innerHTML = '';

  if (fixtures.length === 0) {
    container.innerHTML = '<p class="no-data">No fixtures available.</p>';
    return;
  }

  const participant = document.getElementById('pred-participant').value;
  const pin         = document.getElementById('pred-pin').value.trim();
  const pinCorrect  = CONFIG.pins[participant] === pin;
  const now         = new Date();

  const gwNumbers = [...new Set(fixtures.map(f => f.assigned_gameweek))].sort((a, b) => a - b);

  gwNumbers.forEach(gwNum => {
    const gwFixtures = fixtures.filter(f => f.assigned_gameweek === gwNum);

    if (gwNumbers.length > 1) {
      const gwHeader = document.createElement('div');
      gwHeader.className = 'gw-group-header';
      gwHeader.innerHTML = `<strong>Gameweek ${gwNum}</strong>`;
      container.appendChild(gwHeader);
    }

    gwFixtures.forEach(fixture => {
      const gwKey    = String(fixture.assigned_gameweek);
      const preds    = predictionsData?.gameweeks[gwKey]?.predictions[participant] || [];
      const kickoff  = new Date(fixture.kickoff);
      const locked   = now >= kickoff;
      const active   = getActivePrediction(participant, fixture.id, fixture.kickoff, preds);
      const homeVal  = (active !== null && (locked || pinCorrect)) ? active.home_score : '';
      const awayVal  = (active !== null && (locked || pinCorrect)) ? active.away_score : '';

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
               data-fixture-id="${fixture.id}" data-gw="${fixture.assigned_gameweek}" data-side="home"
               min="0" max="20" value="${homeVal}" placeholder="0"
               ${locked ? 'disabled' : ''} />
        <span class="pred-separator">–</span>
        <input type="number" class="pred-score-input"
               data-fixture-id="${fixture.id}" data-gw="${fixture.assigned_gameweek}" data-side="away"
               min="0" max="20" value="${awayVal}" placeholder="0"
               ${locked ? 'disabled' : ''} />
        <span class="pred-team pred-away">${fixture.away_team}</span>
        ${locked ? '<span class="pred-locked">🔒 Locked</span>' : ''}
        ${submittedLabel}`;
      container.appendChild(row);
    });
  });

  container.querySelectorAll('.pred-score-input').forEach(input => {
    input.addEventListener('input', () => { predFormDirty = true; });
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
  const fixtures = fixturesData.fixtures || [];

  const byFixture = {};
  document.querySelectorAll('.pred-score-input').forEach(input => {
    const fid  = parseInt(input.dataset.fixtureId);
    const side = input.dataset.side;
    const gw   = input.dataset.gw;
    if (!byFixture[fid]) byFixture[fid] = { gw };
    byFixture[fid][side]         = input.value === '' ? 0 : parseInt(input.value) || 0;
    byFixture[fid][side + 'Raw'] = input.value;
  });

  const submittedAt = new Date().toISOString();
  const newEntriesByGw = {};

  for (const fixture of fixtures) {
    if (now >= new Date(fixture.kickoff)) continue;
    const scores = byFixture[fixture.id];
    if (!scores || scores.home === undefined || scores.away === undefined) continue;

    const gwKey = String(fixture.assigned_gameweek);
    if (!predictionsData.gameweeks[gwKey]) {
      predictionsData.gameweeks[gwKey] = { predictions: {} };
    }
    if (!predictionsData.gameweeks[gwKey].predictions[participant]) {
      predictionsData.gameweeks[gwKey].predictions[participant] = [];
    }

    if (scores.homeRaw === '' && scores.awayRaw === '') {
      predictionsData.gameweeks[gwKey].predictions[participant] =
        predictionsData.gameweeks[gwKey].predictions[participant]
          .filter(p => String(p.fixture_id) !== String(fixture.id));
      continue;
    }

    const existing = getActivePrediction(participant, fixture.id, fixture.kickoff,
      predictionsData.gameweeks[gwKey].predictions[participant] || []);

    const unchanged = existing &&
      existing.home_score === scores.home &&
      existing.away_score === scores.away;

    if (!unchanged) {
      if (!newEntriesByGw[gwKey]) newEntriesByGw[gwKey] = [];
      newEntriesByGw[gwKey].push({
        fixture_id:   fixture.id,
        home_score:   scores.home,
        away_score:   scores.away,
        submitted_at: submittedAt,
      });
    }
  }

  const totalNew = Object.values(newEntriesByGw).reduce((sum, arr) => sum + arr.length, 0);
  if (totalNew === 0) {
    showStatus(statusEl, 'No changes to save.', 'info');
    return;
  }

  Object.entries(newEntriesByGw).forEach(([gwKey, entries]) => {
    entries.forEach(e => predictionsData.gameweeks[gwKey].predictions[participant].push(e));
  });

  showStatus(statusEl, 'Saving…', 'info');
  document.getElementById('pred-submit-btn').disabled = true;
  const ok = await writeFileToGitHub('data/predictions.json', predictionsData);
  document.getElementById('pred-submit-btn').disabled = false;

  if (ok === true) {
    predFormDirty = false;
    showStatus(statusEl, `Saved at ${formatTimeBST(submittedAt)} BST ✓`, 'success');
    renderFixturesTable();
    renderProjectedStandings();
  } else {
    Object.entries(newEntriesByGw).forEach(([gwKey, entries]) => {
      const arr = predictionsData.gameweeks[gwKey].predictions[participant];
      predictionsData.gameweeks[gwKey].predictions[participant] =
        arr.slice(0, arr.length - entries.length);
    });
    showStatus(statusEl, 'Save failed — please try again.', 'error');
  }
}

function showStatus(el, msg, type) {
  el.textContent = msg;
  el.className   = 'pred-status status-' + type;
}

/* ============================================================
   LIVE SCORE UPDATE FORM (mirrors prediction form UX)
   ============================================================ */
const SCORE_STATUS_OPTIONS = ['NS', '1H', 'HT', '2H', 'FT', 'PPD'];

function populateScoreParticipantDropdown() {
  const sel = document.getElementById('score-participant');
  if (!sel) return;
  CONFIG.participants.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    scoreFormDirty = false;
    renderScoreForm();
  });
  document.getElementById('score-pin').addEventListener('input', () => {
    scoreFormDirty = false;
    renderScoreForm();
  });
}

function renderScoreForm() {
  const container = document.getElementById('score-form-rows');
  if (!container) return;
  const fixtures = fixturesData.fixtures || [];
  container.innerHTML = '';

  if (fixtures.length === 0) {
    container.innerHTML = '<p class="no-data">No fixtures available.</p>';
    return;
  }

  const participant = document.getElementById('score-participant').value;
  const pin         = document.getElementById('score-pin').value.trim();
  const pinCorrect  = participant && CONFIG.pins[participant] === pin;
  const liveMap     = buildLiveMap();

  fixtures.forEach(fixture => {
    const live = liveMap[String(fixture.id)] || fixture;
    const status = live.status || fixture.status || 'NS';

    const row = document.createElement('div');
    row.className = 'pred-row';
    row.innerHTML = `
      <span class="pred-team pred-home">${fixture.home_team}</span>
      <input type="number" class="pred-score-input score-home-input"
             data-fixture-id="${fixture.id}"
             min="0" max="20" value="${live.home_score ?? ''}" placeholder="0"
             ${pinCorrect ? '' : 'disabled'} />
      <span class="pred-separator">–</span>
      <input type="number" class="pred-score-input score-away-input"
             data-fixture-id="${fixture.id}"
             min="0" max="20" value="${live.away_score ?? ''}" placeholder="0"
             ${pinCorrect ? '' : 'disabled'} />
      <span class="pred-team pred-away">${fixture.away_team}</span>
      <select class="score-status-select" data-fixture-id="${fixture.id}" ${pinCorrect ? '' : 'disabled'}>
        ${SCORE_STATUS_OPTIONS.map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>`;
    container.appendChild(row);
  });

  container.querySelectorAll('.score-home-input, .score-away-input, .score-status-select').forEach(input => {
    input.addEventListener('input', () => { scoreFormDirty = true; });
    input.addEventListener('change', () => { scoreFormDirty = true; });
  });

  const lastBy = livescoresData.last_updated_by;
  const lastAt = livescoresData.updated;
  const lbl = document.getElementById('score-last-updated');
  if (lbl) {
    lbl.textContent = lastBy
      ? `Scores last updated by ${lastBy} at ${formatTimeBST(lastAt)} BST`
      : '';
  }

  document.getElementById('score-submit-btn').onclick = submitScoreUpdates;
}

async function submitScoreUpdates() {
  const participant = document.getElementById('score-participant').value;
  const pin         = document.getElementById('score-pin').value.trim();
  const statusEl    = document.getElementById('score-status');

  if (!participant) { showStatus(statusEl, 'Please select a participant.', 'error'); return; }
  if (CONFIG.pins[participant] !== pin) { showStatus(statusEl, 'Incorrect PIN.', 'error'); return; }

  const fixtures  = fixturesData.fixtures || [];
  const updatedAt = new Date().toISOString();

  document.querySelectorAll('.score-home-input').forEach(homeInput => {
    const fid   = homeInput.dataset.fixtureId;
    const fixture = fixtures.find(f => String(f.id) === String(fid));
    if (!fixture) return;

    const awayInput     = document.querySelector(`.score-away-input[data-fixture-id="${fid}"]`);
    const statusSelect  = document.querySelector(`.score-status-select[data-fixture-id="${fid}"]`);

    const homeVal = homeInput.value !== '' ? parseInt(homeInput.value, 10) : null;
    const awayVal = awayInput.value !== '' ? parseInt(awayInput.value, 10) : null;
    const statusVal = statusSelect.value;

    fixture.home_score = homeVal;
    fixture.away_score = awayVal;
    fixture.status      = statusVal;
  });

  fixturesData.updated = updatedAt;

  livescoresData.livescores = fixtures
    .filter(f => (f.status || 'NS') !== 'NS')
    .map(f => ({ ...f }));
  livescoresData.updated         = updatedAt;
  livescoresData.last_updated_by = participant;

  showStatus(statusEl, 'Saving…', 'info');
  document.getElementById('score-submit-btn').disabled = true;

  const okFixtures = await writeFileToGitHub('data/fixtures.json', fixturesData);
  const okLive     = await writeFileToGitHub('data/livescores.json', livescoresData);

  document.getElementById('score-submit-btn').disabled = false;

  if (okFixtures === true && okLive === true) {
    scoreFormDirty = false;
    showStatus(statusEl, `Saved at ${formatTimeBST(updatedAt)} BST ✓`, 'success');
    renderFixturesTable();
    renderProjectedStandings();
    checkAndRenderBlockEnding();
    renderScoreForm();
  } else {
    showStatus(statusEl, 'Save failed — please try again.', 'error');
  }
}

/* ============================================================
   SECTION 3 — PROJECTED STANDINGS
   ============================================================ */
function renderProjectedStandings() {
  const tbody = document.getElementById('projected-body');
  if (!tbody) return;

  const liveMap   = buildLiveMap();
  const gwNumbers = getDistinctGameweeksInFixtures();

  const rows = CONFIG.participants.map(name => {
    const entry      = CONFIG.openingStandings.find(s => s.name === name) || {};
    const openingPts = entry.points || 0;

    let gwPoints = 0;
    const notationParts = [];

    gwNumbers.forEach(gwNum => {
      const gwKey      = String(gwNum);
      const gwFixtures = getFixturesForGameweek(gwNum);
      const gwPreds    = predictionsData?.gameweeks?.[gwKey]?.predictions || {};
      const earned     = computeEarned(name, gwFixtures, gwPreds, liveMap);
      gwPoints += earned;
      if (earned > 0) {
        const notation = buildPointsNotation(name, gwFixtures, gwPreds, liveMap);
        notationParts.push(gwNumbers.length > 1 ? `GW${gwNum}: ${notation}` : notation);
      }
    });

    const projected = openingPts + gwPoints;
    return { name, openingPts, gwPoints, notation: notationParts.join(' | '), projected };
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
  const fixtures         = fixturesData.fixtures || [];
  const section          = document.getElementById('block-ending-section');
  const projectedSection = document.getElementById('projected-section');

  if (fixtures.length === 0) {
    section.style.display          = 'none';
    projectedSection.style.display = 'block';
    return;
  }

  const liveMap = buildLiveMap();
  const windows = computeWindows(fixtures);

  const archivedKeys = new Set(
    (archiveData?.windows || []).map(w => `${w.window_start}|${w.window_end}`)
  );

  const openWindows = windows.filter(
    w => !archivedKeys.has(`${w.startDate.toISOString()}|${w.endDate.toISOString()}`)
  );

  if (openWindows.length === 0) {
    section.style.display          = 'none';
    projectedSection.style.display = 'block';
    return;
  }

  const targetWindow = openWindows[0];
  const allDone = isWindowComplete(targetWindow, liveMap);

  if (!allDone) {
    projectedSection.style.display = 'block';
    section.style.display          = 'none';
    return;
  }

  projectedSection.style.display = 'none';
  section.style.display          = 'block';

  const windowPreds = getWindowPredictions(targetWindow.fixtures);
  renderBlockEnding(targetWindow.fixtures, liveMap, windowPreds);

  document.getElementById('archive-btn-container').style.display = 'block';
  document.getElementById('archive-gw-btn').onclick = () => archiveCurrentWindow(targetWindow);
  document.getElementById('roll-gw-btn').onclick = rollToNextGW;
}

// Merges each participant's predictions from every gameweeks[gw] bucket
// that's actually represented among the given fixtures. Safe because
// getActivePrediction() filters by fixture_id regardless of source bucket.
function getWindowPredictions(fixtures) {
  const gwKeys = [...new Set((fixtures || []).map(f => String(f.assigned_gameweek)))];
  const merged = {};
  CONFIG.participants.forEach(p => {
    merged[p] = [];
    gwKeys.forEach(gwKey => {
      const arr = predictionsData?.gameweeks?.[gwKey]?.predictions?.[p] || [];
      merged[p] = merged[p].concat(arr);
    });
  });
  return merged;
}

function renderBlockEnding(fixtures, liveMap, gwPreds) {
  const tbody   = document.getElementById('block-ending-body');

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
  if (!archiveData?.windows) return;

  const sel = document.getElementById('archive-select');
  sel.innerHTML = '<option value="">— Select a completed window —</option>';

  [...archiveData.windows].reverse().forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.window_start;
    opt.textContent = w.label;
    sel.appendChild(opt);
  });

  sel.addEventListener('change', () => {
    const val = sel.value;
    const container = document.getElementById('archive-content');
    if (!val) { container.innerHTML = ''; return; }
    const w = archiveData.windows.find(x => x.window_start === val);
    if (w) renderArchiveGW(w);
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

async function archiveCurrentWindow(window) {
  const pin = prompt("Enter Kris's admin PIN to archive this window:");
  if (pin === null) return;
  if (CONFIG.pins['Kris'] !== pin) { alert('Incorrect PIN.'); return; }

  const targetFixtures = window.fixtures;
  const liveMap = buildLiveMap();
  const gwPreds = getWindowPredictions(targetFixtures);

  const closingStandings = CONFIG.openingStandings.map(entry => ({
    name:   entry.name,
    points: entry.points + computeEarned(entry.name, targetFixtures, gwPreds, liveMap),
  }));

  const pointsBreakdown = {};
  CONFIG.participants.forEach(p => {
    pointsBreakdown[p] = {
      points:   computeEarned(p, targetFixtures, gwPreds, liveMap),
      notation: buildPointsNotation(p, targetFixtures, gwPreds, liveMap),
    };
  });

  // Only truly played fixtures get an archived result — PPD fixtures have no
  // score to record and must stay live in fixtures.json so they're picked up
  // by a future window once TheSportsDB gives them a real date.
  const PLAYED_ST = ['FT', 'AET', 'PEN'];

  const results = targetFixtures
    .filter(f => PLAYED_ST.includes((liveMap[String(f.id)] || f).status || f.status || ''))
    .map(f => {
      const live = liveMap[String(f.id)] || f;
      return {
        fixture_id:        f.id,
        home_team:         f.home_team,
        away_team:         f.away_team,
        home_score:        live.home_score ?? f.home_score,
        away_score:        live.away_score ?? f.away_score,
        assigned_gameweek: f.assigned_gameweek,
      };
    });

  // Only snapshot predictions for fixtures that actually resolved — a
  // prediction against a postponed fixture isn't "wrong" or "right" yet.
  const resultFixtureIds = new Set(results.map(r => String(r.fixture_id)));
  const archivedPredictions = {};
  CONFIG.participants.forEach(p => {
    archivedPredictions[p] = targetFixtures
      .filter(f => resultFixtureIds.has(String(f.id)))
      .map(f => {
        const pred = getActivePrediction(p, f.id, f.kickoff, gwPreds[p] || []);
        if (!pred) return null;
        return { fixture_id: f.id, home_score: pred.home_score, away_score: pred.away_score };
      }).filter(Boolean);
  });

  const entry = {
    window_start:      window.startDate.toISOString(),
    window_end:        window.endDate.toISOString(),
    label:             window.label,
    opening_standings: [...CONFIG.openingStandings],
    closing_standings: closingStandings,
    points_breakdown:  pointsBreakdown,
    results,
    predictions:       archivedPredictions,
  };

  const currentArchive = await fetchJSON('data/archive.json') || { windows: [] };
  if (!currentArchive.windows) currentArchive.windows = [];

  const existIdx = currentArchive.windows.findIndex(
    w => w.window_start === entry.window_start && w.window_end === entry.window_end
  );
  if (existIdx >= 0) {
    if (!confirm(`Window ${window.label} is already archived. Overwrite?`)) return;
    currentArchive.windows[existIdx] = entry;
  } else {
    currentArchive.windows.push(entry);
  }

  const ok = await writeFileToGitHub('data/archive.json', currentArchive);
  if (ok) {
    alert(`Window ${window.label} archived successfully!`);
    archiveData = currentArchive;
    await loadArchiveData();
  } else {
    alert('Archive failed — please try again.');
  }
}

/* ============================================================
   HALL OF FAME
   ============================================================ */
function renderHonoursBoard() {
  const container = document.getElementById('honours-board');
  if (!container) return;
  const honours = CONFIG.honours || [];
  const sorted  = [...honours].sort((a, b) => b.titles.length - a.titles.length);

  container.innerHTML = `
    <table class="data-table honours-table">
      <thead>
        <tr><th>Participant</th><th>Titles</th><th>Total</th></tr>
      </thead>
      <tbody>
        ${sorted.map(p => `
          <tr>
            <td>${displayName(p.name)}</td>
            <td class="honours-cell">
              ${p.titles.length > 0
                ? p.titles.map(y => `<span class="trophy">🏆 <span class="honours-year">(${y})</span></span>`).join(' ')
                : '<span class="no-data">—</span>'}
            </td>
            <td><strong>${p.titles.length}</strong></td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
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
    const live   = liveMap[String(fixture.id)] || fixture;
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
    const live       = liveMap[String(fixture.id)] || fixture;
    const status     = live.status || fixture.status || '';
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
  return apiName;
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
  const pin = prompt("Enter Kris's admin PIN to roll to the next gameweek:");
  if (pin === null) return;
  if (CONFIG.pins['Kris'] !== pin) { alert('Incorrect PIN.'); return; }

  const btn = document.getElementById('roll-gw-btn');

  // Use the in-memory archive first — it was just updated by archiveCurrentGW()
  // and is guaranteed fresh. Falling back to a network fetch risks reading a
  // stale/cached copy of archive.json immediately after writing to it.
  const currentArchive = (archiveData && archiveData.gameweeks && archiveData.gameweeks.length > 0)
    ? archiveData
    : await fetchJSON('data/archive.json');

  if (!currentArchive || !currentArchive.gameweeks || currentArchive.gameweeks.length === 0) {
    alert('No archived gameweeks found. Archive the current one first!');
    return;
  }

  // Pick the entry with the highest gameweek number, not the last array index —
  // this avoids relying on insertion order.
  const lastGW = currentArchive.gameweeks.reduce(
    (max, gw) => (gw.gameweek > max.gameweek ? gw : max),
    currentArchive.gameweeks[0]
  );

  const nextGWNum = CONFIG.currentGameweek + 1;
  const newOpeningStandings = [...lastGW.closingstandings]
    .sort((a, b) => b.points - a.points)
    .map(s => ({ name: s.name, points: s.points }));

  const newConfigObj = {
    ...CONFIG,
    currentGameweek: nextGWNum,
    currentGwLabel: `GW${nextGWNum} — TBD`,
    openingStandings: newOpeningStandings,
    seededPredictions: { gw: nextGWNum, submittedAt: new Date().toISOString(), byFixture: {} },
  };

  btn.disabled = true;
  btn.textContent = 'Rolling…';

  const ok = await saveSafeConfig(newConfigObj);

  if (ok === true) {
    const emptyFixtures = { updated: new Date().toISOString(), round: '', fixtures: [] };
    const emptyLivescores = { updated: new Date().toISOString(), livescores: [] };
    await writeFileToGitHub('data/fixtures.json', emptyFixtures);
    await writeFileToGitHub('data/livescores.json', emptyLivescores);

    try {
      await fetch(`https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/actions/workflows/update-scores.yml/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `token ${CONFIG.githubPAT}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { force_run: 'true' } }),
      });
      btn.textContent = 'Fetching fixtures…';
      await new Promise(r => setTimeout(r, 35000));
    } catch (e) {
      console.warn('Could not trigger fixture fetch', e);
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

  let seconds = 60;
  const timer = setInterval(() => {
    seconds -= 1;
    btn.textContent = seconds > 0 ? `⏳ Waiting ${seconds}s…` : '⏳ Loading…';
  }, 1000);

  await new Promise(r => setTimeout(r, 60000));
  clearInterval(timer);

  window.location.reload();
}


/* ============================================================
   DATE-WINDOW UTILITIES (added for multi-gameweek fixture congestion)
   ============================================================ */

// Clusters fixtures into chronological "windows" (e.g. a Fri-Mon weekend,
// or a Tue-Thu midweek slate), regardless of which gameweek(s) they belong
// to. A new window starts whenever the gap between one fixture's kickoff
// date and the next exceeds one calendar day.
function computeWindows(fixtures) {
  const withDates = (fixtures || [])
    .filter(f => f.kickoff)
    .map(f => ({ fixture: f, date: new Date(f.kickoff) }))
    .sort((a, b) => a.date - b.date);

  const windows = [];
  let current = null;
  let lastDay = null;

  const toDayNumber = d => Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);

  withDates.forEach(({ fixture, date }) => {
    const dayNum = toDayNumber(date);
    if (current === null || (dayNum - lastDay) > 1) {
      current = { windowIndex: windows.length + 1, fixtures: [] };
      windows.push(current);
    }
    current.fixtures.push(fixture);
    lastDay = dayNum;
  });

  windows.forEach(w => {
    const dates = w.fixtures.map(f => new Date(f.kickoff));
    w.startDate = new Date(Math.min(...dates));
    w.endDate   = new Date(Math.max(...dates));
    w.label     = formatWindowLabel(w.startDate, w.endDate);
  });

  return windows;
}

function formatWindowLabel(startDate, endDate) {
  const opts = { day: 'numeric', month: 'short', timeZone: 'Europe/London' };
  const startStr = startDate.toLocaleDateString('en-GB', opts);
  const endStr   = endDate.toLocaleDateString('en-GB', { ...opts, year: 'numeric' });
  if (startDate.toDateString() === endDate.toDateString()) return endStr;
  return `${startStr}–${endStr}`;
}

// Returns whether every fixture in a window has reached a completed status.
function isWindowComplete(window, liveMap) {
  return window.fixtures.every(f => {
    const status = (liveMap[String(f.id)] || f).status || f.status || '';
    return COMPLETED.includes(status);
  });
}

// Builds the composite standings-table header, e.g.:
//   "GW10 (GW6 4/6, GW9 5/6, GW15 1/6)"
// Headline = highest gameweek number where ALL of that gw's fixtures are complete.
// Parenthetical = every other gameweek currently present with 1-5 of 6 fixtures complete.
function buildGwCompositeLabel() {
  const gwNumbers = getDistinctGameweeksInFixtures();
  const liveMap   = buildLiveMap();

  const gwStatus = gwNumbers.map(gwNum => {
    const gwFixtures = getFixturesForGameweek(gwNum);
    const total = gwFixtures.length;
    const completed = gwFixtures.filter(f => {
      const status = (liveMap[String(f.id)] || f).status || f.status || '';
      return COMPLETED.includes(status);
    }).length;
    return { gwNum, completed, total };
  });

  const fullyDone = gwStatus.filter(g => g.total > 0 && g.completed === g.total);
  const partial   = gwStatus.filter(g => g.completed > 0 && g.completed < g.total);

  const headlineGw = fullyDone.length > 0
    ? Math.max(...fullyDone.map(g => g.gwNum))
    : (gwNumbers.length > 0 ? Math.min(...gwNumbers) : CONFIG.currentGameweek);

  if (partial.length === 0) return `GW${headlineGw}`;

  const parenthetical = partial
    .sort((a, b) => a.gwNum - b.gwNum)
    .map(g => `GW${g.gwNum} ${g.completed}/${g.total}`)
    .join(', ');

  return `GW${headlineGw} (${parenthetical})`;
}
