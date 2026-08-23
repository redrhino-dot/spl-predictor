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

const CLUB_ALIASES = {
  'Huns': 'Rangers', 'HUNS': 'Rangers',
  'Well': 'Motherwell', 'WELL': 'Motherwell',
  'Hibs': 'Hibernian', 'HIBS': 'Hibernian',
  'Dons': 'Aberdeen', 'DONS': 'Aberdeen',
  'Killie': 'Kilmarnock', 'KILLIE': 'Kilmarnock',
  'Livi': 'Livingston',
  'St M': 'St Mirren', 'StM': 'St Mirren', 'ST M': 'St Mirren',
  'Kings': 'Dundee',
  'JAMBOS': 'Hearts', 'Jambos': 'Hearts',
  'Glory Glory Dundee United': 'Dundee Utd',
  'Utd': 'Dundee Utd',
  'Yinited': 'Dundee Utd', 'Yinited 1': 'Dundee Utd',
  'StJ': 'St Johnstone',
  'ICT': 'Inverness',
};
function _normClub(name) { return CLUB_ALIASES[name.trim()] || name.trim(); }

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

  // Schema note: archive.json stores completed periods under "windows",
  // not "gameweeks" — a window may span more than one gameweek (e.g. a
  // rescheduled fixture landing alongside the current round). Window
  // entries have no numeric "gameweek" field — use the pre-built "label"
  // string (e.g. "08 Aug 2026") instead. All other fields inside each
  // entry (opening_standings, closing_standings, points_breakdown, etc.)
  // remain snake_case, unchanged from the pre-windows schema.
  const gameweeks = archive.windows || [];
  if (!gameweeks.length) {
    container.innerHTML = '<div class="stats-error">No archived windows yet.</div>';
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
    labels.push(gw.label);
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

  /* ── Compute extended stats ─────────────────────────────── */
  const gwEarned = {};   // per-window points earned
  players.forEach(p => {
    gwEarned[p] = gameweeks.map((gw, i) => {
      const open  = (gw.opening_standings.find(s => s.name === p) || {}).points || 0;
      const close = (gw.closing_standings.find(s => s.name === p) || {}).points || 0;
      return close - open;
    });
  });

  // Window winner(s) each period
  const gwWinners = gameweeks.map((gw, i) => {
    const scores = players.map(p => gwEarned[p][i]);
    const max = Math.max(...scores);
    return players.filter((p, pi) => scores[pi] === max);
  });

  // Window last(s) each period
  const gwLasts = gameweeks.map((gw, i) => {
    const scores = players.map(p => gwEarned[p][i]);
    const min = Math.min(...scores);
    return players.filter((p, pi) => scores[pi] === min);
  });

  // Per-player stats
  const stats = {};
  players.forEach(p => {
    const earned = gwEarned[p];
    const wins           = gwWinners.filter(w => w.includes(p)).length;
    const outrightWins   = gwWinners.filter(w => w.length === 1 && w[0] === p).length;
    const spoons         = gwLasts.filter(l => l.includes(p)).length;
    const outrightSpoons = gwLasts.filter(l => l.length === 1 && l[0] === p).length;
    const avg    = earned.reduce((a, b) => a + b, 0) / earned.length;
    const maxPts      = Math.max(...earned);
    const maxGW       = earned.indexOf(maxPts) + 1;
    const validIdx    = earned.map((v, i) => i).filter(i => players.some(pl => gwEarned[pl][i] > 0));
    const validEarned = validIdx.map(i => earned[i]);
    const minPts      = validEarned.length ? Math.min(...validEarned) : 0;
    const minGW       = validIdx[validEarned.indexOf(minPts)] + 1;

    // Win streak, no-win streak, current no-win streak
    let bestWinStreak = 0, curWin = 0;
    let bestNoWinStreak = 0, curNoWin = 0;
    earned.forEach((_, i) => {
      if (gwWinners[i].includes(p)) { curWin++; bestWinStreak = Math.max(bestWinStreak, curWin); curNoWin = 0; }
      else { curNoWin++; bestNoWinStreak = Math.max(bestNoWinStreak, curNoWin); curWin = 0; }
    });
    let curNoWinActive = 0;
    for (let i = earned.length - 1; i >= 0; i--) {
      if (!gwWinners[i].includes(p)) curNoWinActive++; else break;
    }

    // Windows in 1st
    const weeksIn1st = gameweeks.filter((gw, i) => {
      const maxCum = Math.max(...players.map(pl => points[pl][i]));
      return points[p][i] === maxCum;
    }).length;

    // First window in OUTRIGHT lead (sole leader only)
    let firstLead = null;
    for (let i = 0; i < gameweeks.length; i++) {
      const maxCum  = Math.max(...players.map(pl => points[pl][i]));
      const leaders = players.filter(pl => points[pl][i] === maxCum);
      if (points[p][i] === maxCum && leaders.length === 1) { firstLead = i + 1; break; }
    }

    // 3pt predictions & best club from notation
    let threePtCount = 0;
    const clubPts = {};
    gameweeks.forEach(gw => {
      const bp = gw.points_breakdown && gw.points_breakdown[p];
      if (!bp || !bp.notation) return;
      const entries = bp.notation.split(',').map(e => e.trim());
      entries.forEach(entry => {
        const is3 = entry.endsWith(' 3') || entry.endsWith('!!');
        if (is3) threePtCount++;
        const pts3 = is3 ? 3 : 1;
        const clubStr = entry.replace(/\s*3$/, '').replace(/!!$/, '').trim();
        clubStr.split('/').forEach(raw => {
          const club = _normClub(raw);
          if (club) clubPts[club] = (clubPts[club] || 0) + pts3;
        });
      });
    });
    const bestClubEntry = Object.entries(clubPts).sort((a, b) => b[1] - a[1])[0] || ['—', 0];

    stats[p] = { wins, outrightWins, spoons, outrightSpoons,
                 avg, maxPts, minPts, maxGW, minGW,
                 bestWinStreak, bestNoWinStreak, curNoWinActive,
                 weeksIn1st, firstLead, threePtCount,
                 bestClub: bestClubEntry[0], bestClubPts: bestClubEntry[1] };
  });

  // Club leaderboard across all players
  const allClubPts = {};
  gameweeks.forEach(gw => {
    players.forEach(p => {
      const bp = gw.points_breakdown && gw.points_breakdown[p];
      if (!bp || !bp.notation) return;
      bp.notation.split(',').map(e => e.trim()).forEach(entry => {
        const pts3 = (entry.endsWith(' 3') || entry.endsWith('!!')) ? 3 : 1;
        const clubStr = entry.replace(/\s*3$/, '').replace(/!!$/, '').trim();
        clubStr.split('/').forEach(raw => {
          const club = _normClub(raw);
          if (club) allClubPts[club] = (allClubPts[club] || 0) + pts3;
        });
      });
    });
  });
  const clubLeaderboard = Object.entries(allClubPts).sort((a, b) => b[1] - a[1]);

  const lastGW = gameweeks[gameweeks.length - 1];

  container.innerHTML = `
    <section class="card">
      <h2>Current Standings — ${lastGW.label}</h2>
      <div id="stats-standings"></div>
    </section>
    <section class="card">
      <h2>Cumulative Points by Window</h2>
      <div class="stats-chart-hint">Pinch to zoom · Drag to pan</div>
      <div class="stats-chart-wrap"><canvas id="statsPointsChart"></canvas></div>
      <div class="stats-chart-controls">
        <button class="stats-reset-btn" onclick="_resetPointsZoom()">↺ Reset Zoom</button>
      </div>
      <div class="stats-legend" id="stats-legend-points"></div>
    </section>
    <section class="card">
      <h2>League Position by Window</h2>
      <div class="stats-chart-wrap"><canvas id="statsPositionChart"></canvas></div>
      <div class="stats-legend" id="stats-legend-position"></div>
    </section>
    <section class="card">
      <h2>Window Performance</h2>
      <div id="stats-gw-perf"></div>
    </section>
    <section class="card">
      <h2>Overall Standing</h2>
      <div id="stats-overall"></div>
    </section>
    <section class="card">
      <h2>Prediction Quality</h2>
      <div id="stats-prediction"></div>
    </section>
    <section class="card">
      <h2>Club Leaderboard</h2>
      <div id="stats-clubs"></div>
    </section>`;

  _buildStandings(players, points);
  _buildPointsChart(labels, players, points);
  _buildPositionChart(labels, players, positions);
  _buildGWPerf(players, stats);
  _buildOverall(players, stats);
  _buildPrediction(players, stats);
  _buildClubs(clubLeaderboard);
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

  // Default: show last window's values
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

/* ── Stat section builders ─────────────────────────────────── */

function _buildGWPerf(players, stats) {
  const el = document.getElementById('stats-gw-perf');
  if (!el) return;
  const medals = ['🥇','🥈','🥉',''];

  const rows = [
    { label: 'Outright Window Wins',      key: 'outrightWins',   suffix: ' wins', desc: true },
    { label: 'Window Wins (inc. shared)',  key: 'wins',           suffix: ' wins', desc: true },
    { label: 'Best Win Streak',     key: 'bestWinStreak',  suffix: ' wins', desc: true },
    { label: 'Longest No-Win Run',  key: 'bestNoWinStreak',suffix: ' windows', desc: false },
    { label: 'Current No-Win Run',  key: 'curNoWinActive', suffix: ' windows', desc: false },
    { label: 'Highest Window Score',    key: 'maxPts',         suffix: ' pts', desc: true, sub: p => `#${stats[p].maxGW}` },
    { label: 'Lowest Window Score',     key: 'minPts',         suffix: ' pts', desc: false, sub: p => `#${stats[p].minGW}` },
    { label: 'Avg Points / Window',     key: 'avg',            suffix: ' pts', desc: true, fmt: v => v.toFixed(1) },
    { label: 'Outright Wooden Spoons', key: 'outrightSpoons', suffix: ' windows', desc: false },
    { label: 'Wooden Spoon Windows (inc. shared)', key: 'spoons', suffix: ' windows', desc: false },
  ];

  el.innerHTML = rows.map(row => {
    const sorted = [...players].sort((a, b) =>
      row.desc ? stats[b][row.key] - stats[a][row.key] : stats[a][row.key] - stats[b][row.key]);
    const best = stats[sorted[0]][row.key];

    return `<div class="stat-row-group">
      <div class="stat-row-label">${row.label}</div>
      ${sorted.map((p, i) => {
        const val   = stats[p][row.key];
        const color = PLAYER_COLORS[p] || '#94a3b8';
        const disp  = row.fmt ? row.fmt(val) : val;
        const sub   = row.sub ? `<span class="stat-sub">${row.sub(p)}</span>` : '';
        const pct   = best > 0 ? Math.round((val / best) * 100) : 0;
        const barPct = row.desc ? pct : (best > 0 ? Math.round(((best - val + 1) / (best + 1)) * 100) : 50);
        return `<div class="stat-player-row">
          <span class="stat-medal">${medals[i] || ''}</span>
          <span class="stat-name" style="color:${color}">${p}</span>
          <div class="stat-bar-wrap"><div class="stat-bar" style="width:${Math.max(barPct,8)}%;background:${color}"></div></div>
          <span class="stat-val" style="color:${color}">${disp}${row.suffix}${sub}</span>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

function _buildOverall(players, stats) {
  const el = document.getElementById('stats-overall');
  if (!el) return;
  const medals = ['🥇','🥈','🥉',''];

  const sortedWeeks = [...players].sort((a,b) => stats[b].weeksIn1st - stats[a].weeksIn1st);
  const maxWeeks    = stats[sortedWeeks[0]].weeksIn1st || 1;

  const sortedFirst = [...players].sort((a,b) => (stats[a].firstLead||999) - (stats[b].firstLead||999));

  el.innerHTML = `
    <div class="stat-row-group">
      <div class="stat-row-label">Windows in 1st Place</div>
      ${sortedWeeks.map((p, i) => {
        const val   = stats[p].weeksIn1st;
        const color = PLAYER_COLORS[p] || '#94a3b8';
        const pct   = Math.round((val / maxWeeks) * 100);
        return `<div class="stat-player-row">
          <span class="stat-medal">${medals[i]||''}</span>
          <span class="stat-name" style="color:${color}">${p}</span>
          <div class="stat-bar-wrap"><div class="stat-bar" style="width:${Math.max(pct,8)}%;background:${color}"></div></div>
          <span class="stat-val" style="color:${color}">${val} windows</span>
        </div>`;
      }).join('')}
    </div>
    <div class="stat-row-group">
      <div class="stat-row-label">First Window in Outright Lead</div>
      ${sortedFirst.map((p, i) => {
        const val   = stats[p].firstLead;
        const color = PLAYER_COLORS[p] || '#94a3b8';
        return `<div class="stat-player-row">
          <span class="stat-medal">${medals[i]||''}</span>
          <span class="stat-name" style="color:${color}">${p}</span>
          <div class="stat-bar-wrap stat-bar-wrap--empty"></div>
          <span class="stat-val" style="color:${color}">${val ? '#' + val : 'Never'}</span>
        </div>`;
      }).join('')}
  `;
}

function _buildPrediction(players, stats) {
  const el = document.getElementById('stats-prediction');
  if (!el) return;
  const medals = ['🥇','🥈','🥉',''];

  const sorted3pt  = [...players].sort((a,b) => stats[b].threePtCount - stats[a].threePtCount);
  const max3pt     = stats[sorted3pt[0]].threePtCount || 1;
  const sortedClub = [...players].sort((a,b) => stats[b].bestClubPts - stats[a].bestClubPts);

  el.innerHTML = `
    <div class="stat-row-group">
      <div class="stat-row-label">Exact Score Predictions (3 pts)</div>
      ${sorted3pt.map((p, i) => {
        const val   = stats[p].threePtCount;
        const color = PLAYER_COLORS[p] || '#94a3b8';
        const pct   = Math.round((val / max3pt) * 100);
        return `<div class="stat-player-row">
          <span class="stat-medal">${medals[i]||''}</span>
          <span class="stat-name" style="color:${color}">${p}</span>
          <div class="stat-bar-wrap"><div class="stat-bar" style="width:${Math.max(pct,8)}%;background:${color}"></div></div>
          <span class="stat-val" style="color:${color}">${val} hits</span>
        </div>`;
      }).join('')}
    </div>
    <div class="stat-row-group">
      <div class="stat-row-label">Best Club (Points Earned)</div>
      ${sortedClub.map((p, i) => {
        const color = PLAYER_COLORS[p] || '#94a3b8';
        return `<div class="stat-player-row">
          <span class="stat-medal">${medals[i]||''}</span>
          <span class="stat-name" style="color:${color}">${p}</span>
          <div class="stat-bar-wrap stat-bar-wrap--empty"></div>
          <span class="stat-val stat-val--club" style="color:${color}">${stats[p].bestClub} <span class="stat-sub">${stats[p].bestClubPts}pts</span></span>
        </div>`;
      }).join('')}
    </div>`;
}

function _buildClubs(clubLeaderboard) {
  const el = document.getElementById('stats-clubs');
  if (!el) return;
  const medals = ['🥇','🥈','🥉'];
  const maxPts = clubLeaderboard[0] ? clubLeaderboard[0][1] : 1;
  const CLUB_BADGE_COLOR = '#1e3a5a';

  el.innerHTML = clubLeaderboard.map(([club, pts], i) => {
    const pct   = Math.round((pts / maxPts) * 100);
    const medal = medals[i] || '';
    return `<div class="stat-player-row">
      <span class="stat-medal">${medal}</span>
      <span class="stat-name stat-name--club">${club}</span>
      <div class="stat-bar-wrap"><div class="stat-bar stat-bar--club" style="width:${Math.max(pct,4)}%"></div></div>
      <span class="stat-val stat-val--neutral">${pts} pts</span>
    </div>`;
  }).join('');
}
