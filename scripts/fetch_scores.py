import json, os, sys, requests, time
from datetime import datetime, timezone, timedelta
from collections import defaultdict

LEAGUE_ID = '4330'
TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/123'

DONE_ST = {'FT', 'AET', 'PEN', 'PPD'}
LIVE_ST = {'1H', 'HT', '2H', 'ET', 'LIVE'}
STATUS_RANK = {'NS': 0, 'LIVE': 1, '1H': 1, 'HT': 1, '2H': 1, 'ET': 1, 'FT': 2, 'AET': 2, 'PEN': 2, 'PPD': 0}

WINDOW_PRE_MINS  = 5
WINDOW_POST_MINS = 120

ROUND_LOOKBACK  = 2
ROUND_LOOKAHEAD = 3


def current_season_str(now):
    if now.month >= 7:
        return f'{now.year}-{now.year + 1}'
    return f'{now.year - 1}-{now.year}'


def fetch_round(season, round_num, retries=5):
    url = f'{TSDB_BASE}/eventsround.php?id={LEAGUE_ID}&r={round_num}&s={season}'
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=25)
            if r.status_code == 200:
                data = r.json()
                return data.get('events') or []
            print(f'  Round {round_num} attempt {attempt + 1}: HTTP {r.status_code}', file=sys.stderr)
        except Exception as e:
            print(f'  Round {round_num} attempt {attempt + 1} error: {e}', file=sys.stderr)
        if attempt < retries - 1:
            backoff = min(2 ** attempt, 20)
            print(f'  Retrying round {round_num} in {backoff}s...', file=sys.stderr)
            time.sleep(backoff)
    return None


def parse_event(ev):
    home = ev.get('strHomeTeam', '')
    away = ev.get('strAwayTeam', '')
    date_str = ev.get('dateEvent')
    time_str = ev.get('strTime') or '00:00:00'
    kickoff = f'{date_str}T{time_str}Z' if date_str else None

    h_score = a_score = None
    try:
        if ev.get('intHomeScore') not in (None, ''):
            h_score = int(ev['intHomeScore'])
    except Exception:
        pass
    try:
        if ev.get('intAwayScore') not in (None, ''):
            a_score = int(ev['intAwayScore'])
    except Exception:
        pass

    raw_status = (ev.get('strStatus') or '').upper()
    POSTPONED_MARKERS = ('PST', 'PPD', 'POSTPON', 'CANC', 'ABD', 'ABANDON', 'SUSP')

    if any(marker in raw_status for marker in POSTPONED_MARKERS):
        status = 'PPD'
    elif h_score is not None and a_score is not None:
        status = 'FT'
    elif kickoff:
        try:
            ko_dt = datetime.fromisoformat(kickoff.replace('Z', '+00:00'))
            if datetime.now(timezone.utc) >= ko_dt:
                status = 'LIVE'
            else:
                status = 'NS'
        except Exception:
            status = raw_status or 'NS'
    else:
        status = raw_status or 'NS'

    round_num = None
    try:
        round_num = int(ev.get('intRound'))
    except (TypeError, ValueError):
        pass

    return {
        'id': str(ev.get('idEvent', '')),
        'round': f"Round {round_num}" if round_num is not None else 'Unknown',
        'week_number': round_num,
        'kickoff': kickoff,
        'status': status,
        'home_team': home,
        'away_team': away,
        'home_score': h_score,
        'away_score': a_score,
        'elapsed': None,
        'elapsed_extra': None,
    }


def is_live_window(fixtures):
    now = datetime.now(timezone.utc)
    for f in fixtures:
        if f.get('status') in LIVE_ST:
            print('Live match detected — running update.')
            return True

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
    latest = max(todays_kos)
    window_open = earliest - timedelta(minutes=WINDOW_PRE_MINS)
    window_close = latest + timedelta(minutes=WINDOW_POST_MINS)

    if window_open <= now <= window_close:
        print(f'Within live window ({window_open.strftime("%H:%M")}–{window_close.strftime("%H:%M")} UTC) — running update.')
        return True

    print(f'Outside live window ({window_open.strftime("%H:%M")}–{window_close.strftime("%H:%M")} UTC) — skipping update.')
    return False


def determine_focus_round(existing_fixtures):
    incomplete_rounds = [
        f['week_number'] for f in existing_fixtures
        if f.get('week_number') is not None and f.get('status') not in DONE_ST
    ]
    if incomplete_rounds:
        return min(incomplete_rounds)
    all_rounds = [f['week_number'] for f in existing_fixtures if f.get('week_number') is not None]
    return (max(all_rounds) + 1) if all_rounds else 1


FORCE_RUN = os.getenv('FORCE_RUN', '').lower() in ('1', 'true', 'yes')
now = datetime.now(timezone.utc)
season = current_season_str(now)

existing_path = 'data/fixtures.json'
existing_fixtures = []
if os.path.exists(existing_path):
    with open(existing_path) as fh:
        existing_fixtures = json.load(fh).get('fixtures', [])

focus_round = determine_focus_round(existing_fixtures)
round_range = list(range(max(1, focus_round - ROUND_LOOKBACK), focus_round + ROUND_LOOKAHEAD + 1))
print(f'Focus round: {focus_round}. Fetching rounds {round_range} for season {season}...')

all_new_fixtures = []
any_success = False
for rn in round_range:
    raw = fetch_round(season, rn)
    if raw is None:
        print(f'WARNING: round {rn} unavailable after all retries — skipping this round this run.', file=sys.stderr)
        continue
    any_success = True
    print(f'  Round {rn}: {len(raw)} events')
    for ev in raw:
        p = parse_event(ev)
        if p and p['kickoff']:
            all_new_fixtures.append(p)

if not any_success:
    print('WARNING: TheSportsDB unavailable for all requested rounds — skipping this run, data/fixtures.json left unchanged.', file=sys.stderr)
    sys.exit(0)

print(f'Total fixtures fetched this run: {len(all_new_fixtures)}')

def team_key(f):
    return (f.get('home_team', ''), f.get('away_team', ''))

existing_map = {team_key(f): f for f in existing_fixtures}
new_map = {team_key(f): f for f in all_new_fixtures}

merged = []
seen_keys = set()

for key, new_fx in new_map.items():
    existing_fx = existing_map.get(key)
    if existing_fx:
        new_rank = STATUS_RANK.get(new_fx['status'], 0)
        existing_rank = STATUS_RANK.get(existing_fx.get('status'), 0)
        if existing_rank > new_rank:
            merged.append(existing_fx)
        else:
            new_fx['id'] = existing_fx['id']
            merged.append(new_fx)
    else:
        merged.append(new_fx)
    seen_keys.add(key)

# Only retain a not-refetched fixture if it's still within the active
# round window or not yet resolved. Fully-played/postponed fixtures whose
# round has scrolled outside round_range are dropped here — they're either
# already safely archived, or (if postponed) will reappear once TheSportsDB
# assigns them a round back inside range. Without this, fixtures.json grows
# forever since nothing else ever prunes it.
retained = 0
dropped = 0
for key, existing_fx in existing_map.items():
    if key in seen_keys:
        continue
    wn = existing_fx.get('week_number')
    is_resolved = existing_fx.get('status') in DONE_ST
    if wn is None or wn in round_range or not is_resolved:
        merged.append(existing_fx)
        retained += 1
    else:
        dropped += 1

fixtures = merged
fixtures.sort(key=lambda x: x['kickoff'])
print(f'After merge: {len(fixtures)} fixtures total (retained {retained}, dropped {dropped} stale not refetched this run)')

if not FORCE_RUN and not is_live_window(fixtures):
    sys.exit(0)

livescores = [m for m in fixtures if m['status'] in (DONE_ST | LIVE_ST)]

os.makedirs('data', exist_ok=True)
ts = datetime.now(timezone.utc).isoformat()
with open('data/fixtures.json', 'w') as fh:
    json.dump({
        'updated': ts,
        'round': f'Round {focus_round}',
        'week_number': focus_round,
        'fixtures': fixtures,
    }, fh, indent=2)
with open('data/livescores.json', 'w') as fh:
    json.dump({'updated': ts, 'livescores': livescores}, fh, indent=2)
print(f'Done: {len(fixtures)} fixtures, {len(livescores)} live/completed.')
