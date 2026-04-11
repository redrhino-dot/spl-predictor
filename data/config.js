// data/config.js — update these values after initial setup
// DO NOT commit a real PAT to a public repo.

const CONFIG = {

  // ── GitHub repo ──────────────────────────────────────────
  githubOwner: 'YOUR_GITHUB_USERNAME',
  githubRepo:  'YOUR_REPO_NAME',
  // Fine-grained PAT — Contents: Read + Write on this repo only
  githubPAT:   'YOUR_FINE_GRAINED_PAT',

  // ── League / Season ──────────────────────────────────────
  leagueId: 179,
  season:   2024,

  // ── Current Gameweek ─────────────────────────────────────
  currentGameweek: 33,
  currentGwLabel:  'GW33 — 12 Apr 2025',

  // ── Participants ─────────────────────────────────────────
  participants: ['Graham', 'Jon', 'Kris', 'Doug'],

  // ── PINs — change these after setup, share privately ─────
  pins: {
    Graham: '1234',
    Jon:    '2345',
    Kris:   '3456',
    Doug:   '4567',
  },

  // ── Standings at START of GW33 ───────────────────────────
  openingStandings: [
    { name: 'Graham', points: 134 },
    { name: 'Jon',    points: 130 },
    { name: 'Kris',   points: 125 },
    { name: 'Doug',   points: 107 },
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
    submittedAt: '2025-04-12T13:55:00Z',
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
