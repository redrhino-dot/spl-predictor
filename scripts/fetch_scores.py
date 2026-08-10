import json, os, sys, requests, time, urllib.parse
from datetime import datetime, timezone, timedelta
from collections import defaultdict

BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/sco.1'
HDRS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.espn.com/',
    'Origin': 'https://www.espn.com',
}

PROXY_BUILDERS = [
    lambda u: 'https://api.allorigins.win/raw?url=' + urllib.parse.quote(u, safe=''),
    lambda u: 'https://corsproxy.io/?url=' + urllib.parse.quote(u, safe=''),
    lambda u: 'https://api.codetabs.com/v1/proxy?quest=' + urllib.parse.quote(u, safe=''),
]

DONE_ST = {'FT', 'AET', 'PEN'}
LIVE_ST = {'1H', 'HT', '2H', 'ET', 'LIVE'}

WINDOW_PRE_MINS  = 5
WINDOW_POST_MINS = 120
STALE_LIVE_MINS  = 115
PRECHECK_HORIZON_SECS = 7200


def resolve_match_status(status, kickoff, elapsed):
    if status not in LIVE_ST:
        return status
    try:
        kickoff_dt = datetime.fromisoformat(kickoff.replace('Z', '+00:00'))
        age = datetime.now(timezone.utc) - kickoff_dt
        if age > timedelta(minutes=STALE_LIVE_MINS) and elapsed is None:
            print(f'  Overriding stale LIVE -> FT (age={int(age.total_seconds()//60)}m, elapsed=null)')
            return 'FT'
    except Exception:
        pass
    return status


def espn_status(detail, clock, state, period=None):
    d = (detail or '').upper()
    if any(x in d for x in ('FINAL', 'FULL TIME', 'FT')): return 'FT'
    if state == 'post': return 'FT'
    if any(x in d for x in ('HALF TIME', 'HALFTIME', 'HALF-TIME')): return 'HT'
    if d in ('HT', 'HALF TIME', 'HALFTIME'): return 'HT'
    if 'POSTPONE' in d:  return 'PST'
    if 'CANCEL'   in d:  return 'CANC'
    if state == 'in' or 'HALF' in d or 'PROGRESS' in d or 'LIVE' in d:
        if period is not None:
            try:
                return '2H' if int(period) >= 2 else '1H'
            except Exception:
                pass
        try:
            mins = int((clock or '0:00').split(':')[0].replace("'", ""))
            return '2H' if mins > 45 else '1H'
        except Exception:
            return 'LIVE'
    return 'NS'


def fetch_via_proxy(target_url):
    """Try each proxy relay in turn. Diversifying providers means a single
    proxy outage (e.g. a Cloudflare 522) doesn't take down the whole fallback."""
    for i, build_url in enumerate(PROXY_BUILDERS):
        proxied_url = build_url(target_url)
        proxy_host = proxied_url.split('/')[2]
        try:
            r = requests.get(proxied_url, headers=HDRS, timeout=15)
            if r.status_code == 200:
                try:
                    return r.json()
                except ValueError:
                    print(f'  Proxy {proxy_host}: HTTP 200 but non-JSON body', file=sys.stderr)
            else:
                print(f'  Proxy {proxy_host}: HTTP {r.status_code}', file=sys.stderr)
        except Exception as e:
            print(f'  Proxy {proxy_host} error: {e}', file=sys.stderr)
    return None


def fetch_day(date_str, retries=3):
    url = f'{BASE}/scoreboard?dates={date_str}&limit=20'
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=HDRS, timeout=20)
            if r.status_code == 200:
                return r.json().get('events', [])
            print(f'  Attempt {attempt + 1}: HTTP {r.status_code} for {date_str}', file=sys.stderr)
            if r.status_code == 403:
                print(f'  Body: {r.text[:300]}', file=sys.stderr)
        except requests.RequestException as e:
            print(f'  Attempt {attempt + 1} error for {date_str}: {e}', file=sys.stderr)
        if attempt < retries - 1:
            time.sleep(2 ** attempt)

    print(f'  Primary domain exhausted for {date_str} — trying proxy relays...', file=sys.stderr)
    data = fetch_via_proxy(url)
    if data is not None:
        events = data.get('events', [])
        print(f'  Proxy relay succeeded for {date_str} ({len(events)} events)', file=sys.stderr)
        return events
    print(f'  All proxy relays failed for {date_str}', file=sys.stderr)
    return None


def parse_event(ev):
    comp = ev.get('competitions', [{}])[0]
    competitors = comp.get('competitors', [])
    if len(competitors) < 2:
        return None
    home = next((c for c in competitors if c.get('homeAway') == 'home'), competitors[0])
    away = next((c for c in competitors if c.get('homeAway') == 'away'), competitors[1])
    status_obj = comp.get('status', {})
    detail = status_obj.get('type', {}).get('description', '')
    state = status_obj.get('type', {}).get('state', '')
    clock = status_obj.get('displayClock', '')
    period = status_obj.get('period')
    status = espn_status(detail, clock, state, period)

    elapsed = None
    elapsed_extra = None
    try:
        if clock and clock != '0:00':
            plus_idx = clock.find('+')
            if plus_idx >= 0:
                elapsed_extra = int(clock[plus_idx + 1:].strip())
                base_clock = clock[:plus_idx]
            else:
                base_clock = clock
            mins_str = base_clock.split(':')[0].replace("'", "").strip()
            elapsed = int(mins_str)
    except Exception:
        pass

    h_score = a_score = None
    try: h_score = int(home.get('score'))
    except Exception: pass
    try: a_score = int(away.get('score'))
    except Exception: pass

    kickoff = comp.get('date') or ev.get('date')
    week_num = ev.get('week', {}).get('number')
    week_text = ev.get('week', {}).get('text') or ev.get('season', {}).get('slug') or 'Unknown'

    resolved_status = resolve_match_status(status, kickoff or '', elapsed)

    return {
        'id': str(ev.get('id', '')),
        'round': week_text,
        'week_number': week_num,
        'kickoff': kickoff,
        'status': resolved_status,
        'home_team': home.get('team', {}).get('displayName', ''),
        'away_team': away.get('team', {}).get('displayName', ''),
        'home_score': h_score,
        'away_score': a_score,
        'elapsed': elapsed,
        'elapsed_extra': elapsed_extra,
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

if not FORCE_RUN:
    print('Running lightweight pre-check (today only)...')
    today_str = now.strftime('%Y%m%d')
    today_raw_events = fetch_day(today_str)
    if today_raw_events is None:
        print('Pre-check failed: could not reach ESPN API for today.', file=sys.stderr)
        sys.exit(2)

    today_parsed = [p for p in (parse_event(e) for e in today_raw_events) if p and p['kickoff']]
    has_relevant_activity = False
    for p in today_parsed:
        if p['status'] in LIVE_ST:
            has_relevant_activity = True
            break
        try:
            ko = datetime.fromisoformat(p['kickoff'].replace('Z', '+00:00'))
            if abs((ko - now).total_seconds()) < PRECHECK_HORIZON_SECS:
                has_relevant_activity = True
                break
        except Exception:
            continue

    if not has_relevant_activity:
        print('Pre-check: no live or imminent match today — skipping full scan.')
        sys.exit(0)

    print('Pre-check: relevant activity detected — proceeding with full scan.')

_weekday = now.weekday()
_lookback = -4 if _weekday in (4, 5, 6, 0) else -1

LOOKAHEAD_STEPS = [7, 14, 21, 30]

events = {}
scanned_up_to = _lookback - 1

for lookahead in LOOKAHEAD_STEPS:
    print(f'Scanning day {scanned_up_to + 1} to +{lookahead} (weekday={now.strftime("%A")})...')
    for delta in range(scanned_up_to + 1, lookahead + 1):
        day = (now + timedelta(days=delta)).strftime('%Y%m%d')
        evs = fetch_day(day)
        if evs is None:
            print(f'ERROR: ESPN API unavailable for {day}', file=sys.stderr)
            sys.exit(2)
        for e in evs:
            events[str(e.get('id'))] = e
        if evs:
            print(f'  {day}: {len(evs)} events')
    scanned_up_to = lookahead
    if events:
        print(f'Found {len(events)} unique events within +{lookahead}-day window — stopping expansion.')
        break
    print(f'No events found within +{lookahead} days — expanding window...')

all_events = list(events.values())
print(f'Total unique events found: {len(all_events)}')
if not all_events:
    print(
        f'ERROR: no events found from ESPN API even after expanding to +{LOOKAHEAD_STEPS[-1]} days. '
        f'This most likely means ESPN is blocking/failing requests rather than a genuine fixture gap — '
        f'check the HTTP status codes logged above by fetch_day().',
        file=sys.stderr
    )
    sys.exit(1)

parsed_all = []
for ev in all_events:
    p = parse_event(ev)
    if p and p['kickoff']:
        parsed_all.append(p)

parsed_all.sort(key=lambda x: x['kickoff'])

FIXTURES_PER_GW = 6

def cluster_by_key(items, key_fn):
    gw_map = defaultdict(list)
    no_key = []
    for m in items:
        k = key_fn(m)
        if k is not None:
            gw_map[k].append(m)
        else:
            no_key.append(m)
    groups = [sorted(v, key=lambda x: x['kickoff']) for _, v in sorted(gw_map.items())]
    for m in no_key:
        if not groups:
            groups.append([m])
            continue
        mt = datetime.fromisoformat(m['kickoff'].replace('Z', '+00:00'))
        closest = min(groups, key=lambda gw: min(abs((datetime.fromisoformat(f['kickoff'].replace('Z', '+00:00')) - mt).total_seconds()) for f in gw))
        closest.append(m)
        closest.sort(key=lambda x: x['kickoff'])
    return groups

def cluster_by_size(items, size):
    gameweeks = []
    current = []
    for m in items:
        current.append(m)
        if len(current) >= size:
            gameweeks.append(current)
            current = []
    if current:
        gameweeks.append(current)
    return gameweeks

use_week_number = any(m['week_number'] is not None for m in parsed_all)
round_texts = [m['round'] for m in parsed_all if m['round'] and m['round'] != 'Unknown']
use_round_text = (not use_week_number and len(round_texts) > 0 and any(rt.lower().startswith('round') for rt in round_texts))

if use_week_number:
    print('Grouping by ESPN week.number (tier 1)')
    gameweeks = cluster_by_key(parsed_all, lambda m: m['week_number'])
elif use_round_text:
    print('Grouping by ESPN round text (tier 2)')
    gameweeks = cluster_by_key(parsed_all, lambda m: m['round'] if m['round'] != 'Unknown' else None)
else:
    print(f'Grouping by fixed bucket of {FIXTURES_PER_GW} (tier 3 — ESPN has no round data)')
    gameweeks = cluster_by_size(parsed_all, FIXTURES_PER_GW)

def gw_is_stale(gw):
    all_done = all(m['status'] in DONE_ST for m in gw)
    if not all_done:
        return False
    last_ko = max(datetime.fromisoformat(m['kickoff'].replace('Z', '+00:00')) for m in gw)
    return (now - last_ko).total_seconds() > 129600

fresh_gameweeks = [gw for gw in gameweeks if not gw_is_stale(gw)]
candidates = fresh_gameweeks if fresh_gameweeks else gameweeks
print(f'Gameweeks found: {len(gameweeks)}, fresh: {len(fresh_gameweeks)}')

best_gw = min(candidates, key=lambda gw: min(abs((datetime.fromisoformat(m['kickoff'].replace('Z', '+00:00')) - now).total_seconds()) for m in gw))
fixtures = best_gw
best_round = fixtures[0]['round'] if fixtures else 'Unknown'
best_week = fixtures[0]['week_number'] if fixtures else None
livescores = [m for m in fixtures if m['status'] in (DONE_ST | LIVE_ST)]
print(f'Current round: {best_round} (week {best_week}) — {len(fixtures)} fixtures, {len(livescores)} live/done)')

if not FORCE_RUN and not is_live_window(fixtures):
    sys.exit(0)

existing_path = 'data/fixtures.json'
if os.path.exists(existing_path):
    with open(existing_path) as fh:
        existing_data = json.load(fh)
    def team_key(f):
        return (f.get('home_team', ''), f.get('away_team', ''))
    existing_map = {team_key(f): f for f in existing_data.get('fixtures', [])}
    new_keys = {team_key(f) for f in fixtures}
    retained = 0
    for key, fx in existing_map.items():
        if key not in new_keys:
            fixtures.append(fx)
            retained += 1
    fixtures.sort(key=lambda x: x['kickoff'])
    print(f'After merge: {len(fixtures)} fixtures (retained {retained} from existing, ESPN provided {len(new_keys)})')

os.makedirs('data', exist_ok=True)
ts = datetime.now(timezone.utc).isoformat()
with open('data/fixtures.json', 'w') as fh:
    json.dump({'updated': ts, 'round': best_round, 'week_number': best_week, 'fixtures': fixtures}, fh, indent=2)
with open('data/livescores.json', 'w') as fh:
    json.dump({'updated': ts, 'livescores': livescores}, fh, indent=2)
print(f'Done: {len(fixtures)} fixtures, {len(livescores)} live/completed.')
