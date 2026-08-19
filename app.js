/* ============================================================
   app.js — Scottish Premiership Predictor
   ============================================================ */

const COMPLETED = ['FT', 'AET', 'PEN'];
const LIVE      = ['1H', 'HT', '2H', 'ET', 'P', 'LIVE'];
const IN_PLAY   = [...LIVE, ...COMPLETED];

let fixturesData    = { fixtures: [], updated: null };
let livescoresData  = { livescores: [] };
let predictionsData = null;
let archiveData      = null;
let scheduleData      = { fixtures: [] };

let predFormDirty = false;
let scoreFormDirty = false;
