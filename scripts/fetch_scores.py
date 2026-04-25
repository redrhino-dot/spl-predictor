import json, os, sys, requests
from datetime import datetime, timezone, timedelta

BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/sco.1'
HDRS = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}

DONE_ST = {'FT', 'AET', 'PEN'}
LIVE_ST = {'1H', 'HT', '2H', 'ET', 'LIVE'}

WINDOW_PRE_MINS  = 5    # minutes before first KO to start fetching
WINDOW_POST_MINS = 120  # minutes after last scheduled KO to keep fetching

def espn_status(detail, clock, state):
    d = (detail or '').upper()
    if any(x in d for x in ('FINAL', 'FULL TIME', 'FT')): return 'FT'
    if any(x in d for x in ('HALF TIME', 'HALFTIME')):    return 'HT'
    if 'POSTPONE' in d:  return 'PST'
    if 'CANCEL'   in d:  return 'CANC'
    if state == 'in' or 'HALF' in d or 'PROGRESS' in d or 'LIVE' in d:
        try:
            mins = int((clock or '0:00').split(':')[0].replace("'", ""))
            return '2H' if mins > 45 else '1H'
        except Exception:
            return 'LIVE'
    return 'NS'

def fetch_day(date_str):
    url = f'{BASE}/scoreboard?dates={date_str}&limit=20'
    r = requests.get(url, headers=HDRS, timeout=20)
    if r.status_code != 200:
        return []
    return r.json().get('events', [])

def parse_event(ev):
    comp        = ev.get('competitions', [{}])[0]
    competitors = comp.get('competitors', [])
    if len(competitors) < 2:
        return None
    home = next((c for c in competitors if c.get('homeAway') == 'home'), competitors[0])
    away = next((c for c in competitors if c.get('homeAway') == 'away'), competitors[1])
    status_obj = comp.get('status', {})
    detail     = status_obj.get('type', {}).get('description', '')
    state      = status_obj.get('type', {}).get('state', '')
    clock      = status_obj.get('displayClock', '')
    status     = espn_status(detail, clock, state)
    elapsed    = None
    try:
        if clock and clock != '0:00':
            clean_clock = clock.split(':')[0].replace("'", "").replace("+", "")
            elapsed = int(clean_clock)
    except Exception:
        pass

    h_score = a_score = None
    try: h_score = int(home.get('score'))
    except Exception: pass
    try: a_score = int(away.get('score'))
    except Exception: pass
    note = ev.get('week', {}).get('text') or ev.get('season', {}).get('slug') or 'Unknown'
    return {
        'id':         str(ev.get('id', '')),
        'round':      note,
        'kickoff':    comp.get('date') or ev.get('date'),
        'status':     status,
        'home_team':  home.get('team', {}).get('displayName', ''),
        'away_team':  away.get('team', {}).get('displayName', ''),
        'home_score': h_score,
        'away_score': a_score,
        'elapsed':    elapsed,
    }

def is_live_window(fixtures):
    """
    Returns True if now is within the active match window for today's fixtures.
    Window opens WINDOW_PRE_MINS before the earliest KO today,
    and closes WINDOW_POST_MINS after the latest KO today.
    Also returns True if any fixture is currently live (catches overruns).
    """
    now = datetime.now(timezone.utc)

    # Always run if any match is currently live
    for f in fixtures:
        if f.get('status') in LIVE_ST:
            print('Live match detected — running update.')
            return True

    # Get kick-off times for today's fixtures only
    todays_kos = []
    for f in fixtures:
        if not f.get('kickoff'):
            continue
        try:
            ko = datetime.fromisoformat(f['kickoff'].replace('Z', '+00:00'))
            if ko.date() == now.date():
                todays_kos.append(ko)
        except Exception:
            continue

    if not todays_kos:
        print('No fixtures today — skipping update.')
        return False

    earliest = min(todays_kos)
    latest   = max(todays_kos)

    window_open  = earliest - timedelta(minutes=WINDOW_PRE_MINS)
    window_close = latest   + timedelta(minutes=WINDOW_POST_MINS)

    if window_open <= now <= window_close:
        print(f'Within live window ({window_open.strftime("%H:%M")}–{window_close.strftime("%H:%M")} UTC) — running update.')
        return True

    print(f'Outside live window ({window_open.strftime("%H:%M")}–{window_close.strftime("%H:%M")} UTC) — skipping update.')
    return False

# ── Main ──────────────────────────────────────────────────────────────────────

FORCE_RUN = os.getenv('FORCE_RUN', '').lower() in ('1', 'true', 'yes')

now    = datetime.now(timezone.utc)
events = {}
print('Scanning date range for current gameweek...')
for delta in range(-1, 10):
    day = (now + timedelta(days=delta)).strftime('%Y%m%d')
    evs = fetch_day(day)
    for e in evs:
        events[str(e.get('id'))] = e
    if evs:
        print(f'  {day}: {len(evs)} events')

all_events = list(events.values())
print(f'Total unique events found: {len(all_events)}')

if not all_events:
    print('ERROR: no events found from ESPN API', file=sys.stderr)
    sys.exit(1)

# Parse and cluster into gameweeks
parsed_all = []
for ev in all_events:
    p = parse_event(ev)
    if p and p['kickoff']:
        parsed_all.append(p)

parsed_all.sort(key=lambda x: x['kickoff'])

gameweeks   = []
current_gw  = []
for m in parsed_all:
    if not current_gw:
        current_gw.append(m)
    else:
        prev_t = datetime.fromisoformat(current_gw[-1]['kickoff'].replace('Z', '+00:00'))
        this_t = datetime.fromisoformat(m['kickoff'].replace('Z', '+00:00'))
        if (this_t - prev_t).days <= 4:
            current_gw.append(m)
        else:
            gameweeks.append(current_gw)
            current_gw = [m]
if current_gw:
    gameweeks.append(current_gw)

best_gw = min(gameweeks, key=lambda gw: min(
    abs((datetime.fromisoformat(m['kickoff'].replace('Z', '+00:00')) - now).total_seconds())
    for m in gw
))
fixtures   = best_gw
best_round = fixtures[0]['round'] if fixtures else 'Unknown'

livescores = [m for m in fixtures if m['status'] in (DONE_ST | LIVE_ST)]
print(f'Current round: {best_round} ({len(fixtures)} fixtures, {len(livescores)} live/done)')

# ── Live window check (skip if FORCE_RUN is set) ─────────────────────────────
if not FORCE_RUN and not is_live_window(fixtures):
    sys.exit(0)

# ── Write data files ──────────────────────────────────────────────────────────
os.makedirs('data', exist_ok=True)
ts = datetime.now(timezone.utc).isoformat()

with open('data/fixtures.json', 'w') as fh:
    json.dump({'updated': ts, 'round': best_round, 'fixtures': fixtures}, fh, indent=2)
with open('data/livescores.json', 'w') as fh:
    json.dump({'updated': ts, 'livescores': livescores}, fh, indent=2)

print(f'Done: {len(fixtures)} fixtures, {len(livescores)} live/completed.')
