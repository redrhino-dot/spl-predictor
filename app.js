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

let predFormDirty = false;

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
    renderFixturesTable();
    renderProjectedStandings();
    checkAndRenderBlockEnding();

    if (!predFormDirty) {
      renderPredictionForm();
    }
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
      if (btn.dataset.tab === 'stats') renderStatsTab();
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
  const el = docum