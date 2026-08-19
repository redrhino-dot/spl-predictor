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

/* PLACEHOLDER_MARKER_FOR_LENGTH_CHECK */