// data/config.js — update these values after initial setup
// DO NOT commit a real PAT to a public repo.

const CONFIG = {

  // ── GitHub repo ──────────────────────────────────────────
githubOwner: 'redrhino-dot',
githubRepo:  'spl-predictor',
githubPAT:   ['github_pat_11B4JHOFQ00M5KnxT8h4jU','_BCRac2McVqIi8kKAhKCM1pG4WCpg3XVcRcC2yiN00lB2D3Q7WG39xz8u0Og'].join(''),

  // ── League / Season ──────────────────────────────────────
  leagueId: 179,
  season:   2025,

  // ── Current Gameweek ─────────────────────────────────────
  currentGameweek: 33,
  currentGwLabel:  'GW33 — 11 Apr 2026',

  // ── Participants ─────────────────────────────────────────
  participants: ['Graham', 'Jon', 'Kris', 'Doug'],

  // ── PINs — change these after setup, share privately ─────
  pins: {
    Graham: '0726',
    Jon:    '0712',
    Kris:   '1006',
    Doug:   '1030',
  },

  // ── Standings at START of GW33 ───────────────────────────
openingStandings: [
  { name: 'Graham', points: 139 },
  { name: 'Jon',    points: 132 },
  { name: 'Kris',   points: 130 },
  { name: 'Doug',   points: 110 },
],

  // ── Team alias map: colloquial → api-football name ───────
  teamAliases: {
    'Hibs':    'Hibernian',
    'Huns':    'Rangers',
    'Celtic':  'Celtic',
    'St M':    'St Mirren',
    'Dons':    'Aberdeen',
    'Yinited': 'Dundee United',
    'Utd':     'Dundee United',
    'Livi':    'Livingston',
    'Well':    'Motherwell',
    'Killie':  'Kilmarnock',
    'Hearts':  'Heart of Midlothian',
    'Dundee':  'Dundee',
  },

  // ── Pre-seeded GW33 predictions ──────────────────────────
  // Written to predictions.json on first load if GW33 is empty.
  // Requires fixtures.json to be populated first (run the workflow).
  seededPredictions: {
    gw:          33,
    submittedAt: '2026-04-11T13:55:00Z',
    byFixture: [
      { homeTeam: 'Aberdeen',            awayTeam: 'Hibernian',
        Graham: [1,1], Jon: [1,2], Doug: [1,2], Kris: [0,2] },
      { homeTeam: 'Celtic',              awayTeam: 'St Mirren',
        Graham: [2,0], Jon: [3,0], Doug: [1,1], Kris: [3,1] },
      { homeTeam: 'Dundee United',       awayTeam: 'Livingston',
        Graham: [1,0], Jon: [2,1], Doug: [2,1], Kris: [2,0] },
      { homeTeam: 'Heart of Midlothian', awayTeam: 'Motherwell',
        Graham: [1,0], Jon: [2,0], Doug: [2,1], Kris: [2,1] },
      { homeTeam: 'Kilmarnock',          awayTeam: 'Dundee',
        Graham: [2,1], Jon: [2,2], Doug: [1,0], Kris: [1,1] },
    ],
  },

};
