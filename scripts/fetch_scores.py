import json, os, sys, requests, time
from datetime import datetime, timezone, timedelta
from collections import defaultdict

LEAGUE_ID = '4330'
TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/123'

DONE_ST = {'FT', 'AET', 'PEN'}
LIVE_ST = {'1H', 'HT', '2H', 'ET', 'LIVE'}
STATUS_RANK = {'NS': 0, 'LIVE': 1, '1H': 1, 'HT': 1, '2H': 1, 'ET': 1, 'FT': 2, 'AET': 2, 'PEN': 2}

WINDOW_PRE_MINS  = 5
WINDOW_POST_MINS = 120


def current_season_str(now):
    if now.month >= 7:
        return f'{now.year}-{now.year + 1}'
    return f'{now.year - 1}-{now.year}'


def fetch_season(season, retries=5):
    url = f'{TSDB_BASE}/eventsseason.php?id={LEAGUE_ID}&s={season}'
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=25)
            if r.status_code == 200:
                data = r.json()
                return data.get('events') or []
            print(f'  Attempt {attempt + 1}: HTTP {r.status_code}', file=sys.stderr)
        except Exception as e:
            print(f'  Attempt {attempt + 1} error: {e}', file=sys.stderr)
        if attempt < retries - 1:
            backoff = min(2 ** attempt, 20)
            print(f'  Retrying in {backoff}s...', file=sys.stderr)
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
    if h_score is not None and a_score is not None:
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


FORCE_RUN = os.getenv('FORCE_RUN', '').lower() in ('1', 'true', 'yes')
now = datetime.now(timezone.utc)

season = current_season_str(now)
print(f'Fetching season {season} for league {LEAGUE_ID}...')
raw_events = fetch_season(season)
if raw_events is None:
    print('WARNING: TheSportsDB API unavailable after all retries — skipping this run, data/fixtures.json left unchanged.', file=sys.stderr)
    sys.exit(0)

print(f'Total events in season: {len(raw_events)}')
if not raw_events:
    print('ERROR: no events returned for season', file=sys.stderr)
    sys.exit(1)

parsed_all = [parse_event(ev) for ev in raw_events]
parsed_all = [p for p in parsed_all if p['kickoff']]
parsed_all.sort(key=lambda x: x['kickoff'])

rounds = defaultdict(list)
for m in parsed_all:
    rounds[m['week_number']].append(m)

def round_is_stale(matches):
    all_done = all(m['status'] in DONE_ST for m in matches)
    if not all_done:
        return False
    last_ko = max(datetime.fromisoformat(m['kickoff'].replace('Z', '+00:00')) for m in matches)
    return (now - last_ko).total_seconds() > 129600  # 36 hours

fresh_rounds = {k: v for k, v in rounds.items() if not round_is_stale(v)}
candidates = fresh_rounds if fresh_rounds else rounds
print(f'Rounds found: {len(rounds)}, fresh: {len(fresh_rounds)}')

incomplete_candidates = {k: v for k, v in candidates.items() if any(m['status'] not in DONE_ST for m in v)}

if incomplete_candidates:
    best_round_num = min(incomplete_candidates)
    print(f'Selecting round {best_round_num}: has unplayed fixtures — takes priority over completed rounds.')
else:
    best_round_num = min(
        candidates,
        key=lambda k: min(abs((datetime.fromisoformat(m['kickoff'].replace('Z', '+00:00')) - now).total_seconds()) for m in candidates[k])
    )
    print(f'All fresh rounds complete — falling back to nearest-in-time: round {best_round_num}.')

fixtures = candidates[best_round_num]
best_round = fixtures[0]['round']
best_week = best_round_num
livescores = [m for m in fixtures if m['status'] in (DONE_ST | LIVE_ST)]
print(f'Current round: {best_round} — {len(fixtures)} fixtures, {len(livescores)} live/done')

if not FORCE_RUN and not is_live_window(fixtures):
    sys.exit(0)

existing_path = 'data/fixtures.json'
if os.path.exists(existing_path):
    with open(existing_path) as fh:
        existing_data = json.load(fh)

    def team_key(f):
        return (f.get('home_team', ''), f.get('away_team', ''))

    existing_map = {team_key(f): f for f in existing_data.get('fixtures', [])}
    new_map = {team_key(f): f for f in fixtures}

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
                merged.append(new_fx)
        else:
            merged.append(new_fx)
        seen_keys.add(key)

    retained = 0
    for key, existing_fx in existing_map.items():
        if key not in seen_keys:
            merged.append(existing_fx)
            retained += 1

    fixtures = merged
    fixtures.sort(key=lambda x: x['kickoff'])
    print(f'After merge: {len(fixtures)} fixtures (retained {retained} not in new round)')

os.makedirs('data', exist_ok=True)
ts = datetime.now(timezone.utc).isoformat()
with open('data/fixtures.json', 'w') as fh:
    json.dump({'updated': ts, 'round': best_round, 'week_number': best_week, 'fixtures': fixtures}, fh, indent=2)
with open('data/livescores.json', 'w') as fh:
    json.dump({'updated': ts, 'livescores': livescores}, fh, indent=2)
print(f'Done: {len(fixtures)} fixtures, {len(livescores)} live/completed.')
