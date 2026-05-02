/* ============================================================
   stats.js — Scottish Premiership Predictor
   Dynamic legend replaces tooltip popup — hover/touch a GW to
   see all four players' values update in the legend below the chart.
   Cumulative points chart also supports pinch-to-zoom and drag-to-pan.
   ============================================================ */

const PLAYER_COLORS = {
  Graham: '#4ade80',
  Jon:    '#60a5fa',
  Kris:   '#f472b6',
  Doug:   '#fb923c',
};

let _pointsChart   = null;
let _positionChart = null;

/* ── Entry point ───────────────────────────────────────────── */
async function renderStatsTab() {
  const container = document.getElementById('stats-container');
  if (!container) return;

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

  const players = gameweeks[0].closing_standings
    .slice()
    .sort((a, b) => b.points - a.points)
    .map(s => s.name);

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
        ? pos[sorted[i-1]] : i + 1;
    });
    players.forEach(p => positions[p].push(pos[p] ?? players.length));
  });

  const lastGW = gameweeks[gameweeks.length - 1];

  container.innerHTML = `
    <section class="card">
      <h2>Current Standings — GW${lastGW.gameweek}</h2>
      <div id="stats-standings"></div>
    </section>
    <section class="card">
      <h2>Cumulative Points by Gameweek</h2>
      <div class="stats-chart-hint">Pinch to zoom · Drag to pan</div>
      <div class="stats-chart-wrap"><canvas id="statsPointsChart"></canvas></div>
      <div class="stats-chart-controls">
        <button class="stats-reset-btn" onclick="_resetPointsZoom()">↺ Reset Zoom</button>
      </div>
      <div class="stats-legend" id="stats-legend-points"></div>
    </section>
    <section class="card">
      <h2>League Position by Gameweek</h2>
      <div class="stats-chart-wrap"><canvas id="statsPositionChart"></canvas></div>
      <div class="stats-legend" id="stats-legend-position"></div>
    </section>`;

  _buildStandings(players, points);
  _buildPointsChart(labels, players, points);
  _buildPositionChart(labels, players, positions);
}

function _resetPointsZoom() {
  if (_pointsChart) _pointsChart.resetZoom();
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

/* ── Dynamic legend builder ────────────────────────────────── */
// Renders legend items with a value that updates on hover/touch
// suffix: ' pts' for points chart, '' for position chart
// ordinals: null for points, array for position
function _buildDynamicLegend(containerId, players, dataMap, defaultIdx, suffix, ordinals) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const renderLegend = (idx) => {
    // Sort by value at this index so legend order matches current ranking
    const sorted = [...players].sort((a, b) => {
      const va = dataMap[a][idx] ?? 0;
      const vb = dataMap[b][idx] ?? 0;
      return suffix === ' pts' ? vb - va : va - vb; // pts: desc, position: asc
    });

    el.innerHTML = sorted.map(name => {
      const val   = dataMap[name][idx] ?? 0;
      const color = PLAYER_COLORS[name] || '#94a3b8';
      const label = ordinals ? (ordinals[val] || val) : val + suffix;
      return `
        <div class="stats-legend-item">
          <span class="stats-legend-dot" style="background:${color}"></span>
          <span class="stats-legend-name">${name}</span>
          <span class="stats-legend-val" style="color:${color}">${label}</span>
        </div>`;
    }).join('');
  };

  // Default: show last GW values
  renderLegend(defaultIdx);

  // Return the update function so the chart can call it
  return renderLegend;
}

/* ── Clear hover state helper ─────────────────────────────── */
function _clearChartHover(chart) {
  chart.setActiveElements([]);
  if (chart.tooltip) chart.tooltip.setActiveElements([], { x: 0, y: 0 });
  // Dispatch a synthetic mouseleave into Chart.js internals to flush _active
  const canvas = chart.canvas;
  if (canvas) {
    const evt = new MouseEvent('mouseout', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(evt);
  }
  chart.update('none');
}

/* ── Shared chart helpers ──────────────────────────────────── */
function _makeDatasets(players, dataMap) {
  return players.map(name => ({
    label:               name,
    data:                dataMap[name],
    borderColor:         PLAYER_COLORS[name] || '#94a3b8',
    backgroundColor:     (PLAYER_COLORS[name] || '#94a3b8') + '22',
    borderWidth:         2.5,
    pointRadius:         2,
    pointHoverRadius:    5,
    pointBackgroundColor: PLAYER_COLORS[name] || '#94a3b8',
    tension:             0.3,
    fill:                false,
  }));
}

function _baseOptions() {
  return {
    responsive:          true,
    maintainAspectRatio: false,
    animation:           { duration: 500, easing: 'easeInOutQuart' },
    interaction:         { mode: 'index', intersect: false },
    plugins: {
      legend:  { display: false },
      tooltip: { enabled: false },
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

/* ── Points chart ──────────────────────────────────────────── */
function _buildPointsChart(labels, players, points) {
  const ctx = document.getElementById('statsPointsChart');
  if (!ctx) return;

  const lastIdx      = labels.length - 1;
  const updateLegend = _buildDynamicLegend('stats-legend-points', players, points, lastIdx, ' pts', null);

  const opts = _baseOptions();

  opts.scales.y.ticks.callback = v => v + ' pts';

  // Mouse hover — desktop
  ctx.addEventListener('mousemove', (e) => {
    if (!_pointsChart) return;
    const els = _pointsChart.getElementsAtEventForMode(e, 'index', { intersect: false }, false);
    if (els.length) updateLegend(els[0].index);
  });
  ctx.addEventListener('mouseleave', () => {
    updateLegend(lastIdx);
    _clearChartHover(_pointsChart);
  });

  // Touch — mobile: track finger movement, reset after 5s with cancellable timer
  let _pointsResetTimer = null;
  ctx.addEventListener('touchmove', (e) => {
    if (!_pointsChart) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect  = ctx.getBoundingClientRect();
    const nativeEvent = { clientX: touch.clientX, clientY: touch.clientY, target: ctx };
    const els = _pointsChart.getElementsAtEventForMode(nativeEvent, 'index', { intersect: false }, false);
    if (els.length) {
      clearTimeout(_pointsResetTimer);
      updateLegend(els[0].index);
    }
  }, { passive: false });
  ctx.addEventListener('touchend', () => {
    clearTimeout(_pointsResetTimer);
    _pointsResetTimer = setTimeout(() => {
      updateLegend(lastIdx);
      if (_pointsChart) {
        _clearChartHover(_pointsChart);
      }
    }, 5000);
  });

  opts.plugins.zoom = {
    pan:  { enabled: true, mode: 'x' },
    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
  };

  _pointsChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: _makeDatasets(players, points) },
    options: opts,
  });
}

/* ── Position chart ────────────────────────────────────────── */
function _buildPositionChart(labels, players, positions) {
  const ctx = document.getElementById('statsPositionChart');
  if (!ctx) return;

  const ordinals  = ['', '1st', '2nd', '3rd', '4th'];
  const lastIdx   = labels.length - 1;
  const updateLegend = _buildDynamicLegend('stats-legend-position', players, positions, lastIdx, '', ordinals);

  const opts = _baseOptions();

  // Mouse hover — desktop
  ctx.addEventListener('mousemove', (e) => {
    if (!_positionChart) return;
    const els = _positionChart.getElementsAtEventForMode(e, 'index', { intersect: false }, false);
    if (els.length) updateLegend(els[0].index);
  });
  ctx.addEventListener('mouseleave', () => {
    updateLegend(lastIdx);
    _clearChartHover(_positionChart);
  });

  // Touch — mobile
  let _posResetTimer = null;
  ctx.addEventListener('touchmove', (e) => {
    if (!_positionChart) return;
    e.preventDefault();
    const touch = e.touches[0];
    const nativeEvent = { clientX: touch.clientX, clientY: touch.clientY, target: ctx };
    const els = _positionChart.getElementsAtEventForMode(nativeEvent, 'index', { intersect: false }, false);
    if (els.length) {
      clearTimeout(_posResetTimer);
      updateLegend(els[0].index);
    }
  }, { passive: false });
  ctx.addEventListener('touchend', () => {
    clearTimeout(_posResetTimer);
    _posResetTimer = setTimeout(() => {
      updateLegend(lastIdx);
      if (_positionChart) {
        _clearChartHover(_positionChart);
      }
    }, 5000);
  });

  opts.scales.y.reverse        = true;
  opts.scales.y.min            = 1;
  opts.scales.y.max            = players.length;
  opts.scales.y.ticks.stepSize = 1;
  opts.scales.y.ticks.callback = v => ordinals[v] || '';

  _positionChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: _makeDatasets(players, positions) },
    options: opts,
  });
}
