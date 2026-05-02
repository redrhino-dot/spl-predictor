/* ============================================================
   stats.js — Stats tab for Scottish Premiership Predictor
   Reads live from data/archive.json on every tab open so it
   automatically reflects any Archive Current GW / Roll Forward.
   ============================================================ */

const PLAYER_COLORS = {
  Graham: '#4ade80',
  Jon:    '#60a5fa',
  Kris:   '#f472b6',
  Doug:   '#fb923c',
};

let _pointsChart   = null;
let _positionChart = null;

/* ── Entry point — called by setupNavigation() when Stats tab opens ── */
async function renderStatsTab() {
  const container = document.getElementById('stats-container');
  if (!container) return;

  // Destroy old charts to avoid canvas reuse errors
  if (_pointsChart)   { _pointsChart.destroy();   _pointsChart   = null; }
  if (_positionChart) { _positionChart.destroy(); _positionChart = null; }

  container.innerHTML = '<div class="stats-loading">Loading stats…</div>';

  let archive;
  try {
    const res = await fetch('data/archive.json?_=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    archive = await res.json();
  } catch (e) {
    container.innerHTML = '<div class="stats-error">Could not load archive data.<br><small>' + e.message + '</small></div>';
    return;
  }

  const gameweeks = archive.gameweeks || [];
  if (!gameweeks.length) {
    container.innerHTML = '<div class="stats-error">No archived gameweeks yet.</div>';
    return;
  }

  /* ── Derive players from first GW closing standings ── */
  const players = gameweeks[0].closing_standings
    .slice()
    .sort((a, b) => b.points - a.points)
    .map(s => s.name);

  /* ── Build series data ── */
  const labels    = [];
  const points    = {};
  const positions = {};
  players.forEach(p => { points[p] = []; positions[p] = []; });

  gameweeks.forEach(gw => {
    labels.push('GW' + gw.gameweek);
    const closing = {};
    gw.closing_standings.forEach(s => closing[s.name] = s.points);

    players.forEach(p => points[p].push(closing[p] ?? 0));

    const sorted = [...players].sort((a, b) => (closing[b] ?? 0) - (closing[a] ?? 0));
    const pos = {};
    sorted.forEach((name, i) => {
      pos[name] = (i > 0 && (closing[name] ?? 0) === (closing[sorted[i-1]] ?? 0))
        ? pos[sorted[i-1]]
        : i + 1;
    });
    players.forEach(p => positions[p].push(pos[p] ?? players.length));
  });

  const lastGW = gameweeks[gameweeks.length - 1];

  /* ── Render shell ── */
  container.innerHTML = `
    <section class="card">
      <h2>Current Standings — GW${lastGW.gameweek}</h2>
      <div id="stats-standings"></div>
    </section>
    <section class="card">
      <h2>Cumulative Points by Gameweek</h2>
      <div class="stats-chart-wrap"><canvas id="statsPointsChart"></canvas></div>
      <div class="stats-legend" id="stats-legend-points"></div>
    </section>
    <section class="card">
      <h2>League Position by Gameweek</h2>
      <div class="stats-chart-wrap"><canvas id="statsPositionChart"></canvas></div>
      <div class="stats-legend" id="stats-legend-position"></div>
    </section>`;

  _buildStandings(players, points, lastGW);
  _buildPointsChart(labels, players, points);
  _buildPositionChart(labels, players, positions);
}

/* ── Standings summary ─────────────────────────────────────── */
function _buildStandings(players, points) {
  const container = document.getElementById('stats-standings');
  if (!container) return;

  const lastPts = {};
  players.forEach(p => lastPts[p] = points[p][points[p].length - 1]);
  const sorted = [...players].sort((a, b) => lastPts[b] - lastPts[a]);
  const max    = lastPts[sorted[0]];

  const medals = ['🥇', '🥈', '🥉', ''];

  container.innerHTML = sorted.map((name, i) => {
    const pts   = lastPts[name];
    const color = PLAYER_COLORS[name] || '#94a3b8';
    const pct   = Math.round((pts / max) * 100);
    return `
      <div class="stats-standing-row">
        <span class="stats-medal">${medals[i] || ''}</span>
        <div class="stats-standing-info">
          <div class="stats-standing-top">
            <span class="stats-standing-name" style="color:${color}">${name}</span>
            <span class="stats-standing-pts">${pts} pts</span>
          </div>
          <div class="stats-bar-wrap">
            <div class="stats-bar" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>
      </div>`;
  }).join('');
}

/* ── Shared chart helpers ──────────────────────────────────── */
function _makeDatasets(players, dataMap) {
  return players.map(name => ({
    label:              name,
    data:               dataMap[name],
    borderColor:        PLAYER_COLORS[name] || '#94a3b8',
    backgroundColor:    (PLAYER_COLORS[name] || '#94a3b8') + '22',
    borderWidth:        2.5,
    pointRadius:        2,
    pointHoverRadius:   5,
    pointBackgroundColor: PLAYER_COLORS[name] || '#94a3b8',
    tension:            0.3,
    fill:               false,
  }));
}

function _baseOptions(tooltipLabel) {
  return {
    responsive:          true,
    maintainAspectRatio: false,
    animation:           { duration: 500, easing: 'easeInOutQuart' },
    interaction:         { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a2a3d',
        borderColor:     '#2a3f5a',
        borderWidth:     1,
        titleColor:      '#8ba3c0',
        bodyColor:       '#e2e8f0',
        padding:         10,
        callbacks:       { label: tooltipLabel },
      },
    },
    scales: {
      x: {
        ticks: { color: '#4a6080', font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
        grid:  { color: '#1a2f47', lineWidth: 0.5 },
      },
      y: {
        ticks: { color: '#4a6080', font: { size: 10 } },
        grid:  { color: '#1a2f47', lineWidth: 0.5 },
      },
    },
  };
}

function _buildLegend(id, players) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = players.map(name => `
    <div class="stats-legend-item">
      <span class="stats-legend-dot" style="background:${PLAYER_COLORS[name] || '#94a3b8'}"></span>
      <span>${name}</span>
    </div>`).join('');
}

/* ── Points chart ──────────────────────────────────────────── */
function _buildPointsChart(labels, players, points) {
  const ctx = document.getElementById('statsPointsChart');
  if (!ctx) return;
  const opts = _baseOptions(c => ' ' + c.dataset.label + ': ' + c.parsed.y + ' pts');
  opts.scales.y.ticks.callback = v => v + ' pts';
  _pointsChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: _makeDatasets(players, points) },
    options: opts,
  });
  _buildLegend('stats-legend-points', players);
}

/* ── Position chart ────────────────────────────────────────── */
function _buildPositionChart(labels, players, positions) {
  const ctx = document.getElementById('statsPositionChart');
  if (!ctx) return;
  const ordinals = ['', '1st', '2nd', '3rd', '4th'];
  const opts = _baseOptions(c => ' ' + c.dataset.label + ': ' + (ordinals[c.parsed.y] || c.parsed.y));
  opts.scales.y.reverse      = true;
  opts.scales.y.min          = 1;
  opts.scales.y.max          = players.length;
  opts.scales.y.ticks.stepSize = 1;
  opts.scales.y.ticks.callback = v => ordinals[v] || '';
  _positionChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: _makeDatasets(players, positions) },
    options: opts,
  });
  _buildLegend('stats-legend-position', players);
}
