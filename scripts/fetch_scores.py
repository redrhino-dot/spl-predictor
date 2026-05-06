import json, os, sys, requests
from datetime import datetime, timezone, timedelta
from collections import defaultdict

BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/sco.1'
HDRS = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}

DONE_ST = {'FT', 'AET', 'PEN'}
LIVE_ST = {'1H', 'HT', '2H', 'ET', 'LIVE'}

WINDOW_PRE_MINS  = 5    # minutes before first KO to start fetching
WINDOW_POST_MINS = 120  # minutes after last scheduled KO to keep fetching

def espn_status(detail, clock, state):
    d = (detail or '').upper()
    if any(x in d for x in ('FINAL', 'FULL TIME', 'FT')): return 'FT'
    if state == 'post': return 'FT'   # ESPN state=post always means finished
    if any(x in d for x in ('HALF TIME', 'HALFTIME', 'HALF-TIME')): return 'HT'
    if d in ('HT', 'HALF TIME', 'HALFTIME'): return 'HT'
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

    elapsed       = None
    elapsed_extra = None
    try:
        if clock and clock != '0:00':
            plus_idx = clock.find('+')
            if plus_idx >= 0:
                elapsed_extra = int(clock[plus_idx + 1:].strip())
                base_clock    = clock[:plus_idx]
            else:
                base_clock = clock
            mins_str = base_clock.split(':')[0].replace("'", "").strip()
            elapsed  = int(mins_str)
    except Exception:
        pass

    h_score = a_score = None
    try: h_score = int(home.get('score'))
    except Exception: pass
    try: a_score = int(away.get('score'))
    except Exception: pass

    week_num  = ev.get('week', {}).get('number')   # e.g. 35  (primary GW key)
    week_text = ev.get('week', {}).get('text') or ev.get('season', {}).get('slug') or 'Unknown'

    return {
        'id':            str(ev.get('id', '')),
        'round':         week_text,
        'week_number':   week_num,
        'kickoff':       comp.get('date') or ev.get('date'),
        'status':        status,
        'home_team':     home.get('team', {}).get('displayName', ''),
        'away_team':     away.get('team', {}).get('displayName', ''),
        'home_score':    h_score,
        'away_score':    a_score,
        'elapsed':       elapsed,
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
for delta in range(-4, 7):
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

# Parse all events
parsed_all = []
for ev in all_events:
    p = parse_event(ev)
    if p and p['kickoff']:
        parsed_all.append(p)

parsed_all.sort(key=lambda x: x['kickoff'])

# ── Cluster into gameweeks ────────────────────────────────────────────────────
# TIER 1: group by week_number (integer) if ESPN provides it
# TIER 2: group by round text (e.g. "Round 35") if consistent
# TIER 3: fixed-size bucket (FIXTURES_PER_GW) — SPL always has exactly 6 per round
# Never splits fixtures that kick off on the same calendar date (UTC)

FIXTURES_PER_GW = 6   # SPL: 12 clubs = 6 matches per gameweek

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
        closest = min(groups, key=lambda gw: min(
            abs((datetime.fromisoformat(f['kickoff'].replace('Z', '+00:00')) - mt).total_seconds())
            for f in gw
        ))
        closest.append(m)
        closest.sort(key=lambda x: x['kickoff'])
    return groups

def cluster_by_size(items, size):
    """Fill gameweeks up to `size` fixtures; never split same-date fixtures."""
    gameweeks = []
    current   = []
    for m in items:
        current.append(m)
        if len(current) >= size:
            # Don't cut mid-day: keep going if next fixture is same date
            gameweeks.append(current)
            current = []
    if current:
        gameweeks.append(current)
    return gameweeks

use_week_number = any(m['week_number'] is not None for m in parsed_all)
round_texts     = [m['round'] for m in parsed_all if m['round'] and m['round'] != 'Unknown']
use_round_text  = (
    not use_week_number and
    len(round_texts) > 0 and
    any(rt.lower().startswith('round') for rt in round_texts)
)

if use_week_number:
    print('Grouping by ESPN week.number (tier 1)')
    gameweeks = cluster_by_key(parsed_all, lambda m: m['week_number'])
elif use_round_text:
    print('Grouping by ESPN round text (tier 2)')
    gameweeks = cluster_by_key(parsed_all, lambda m: m['round'] if m['round'] != 'Unknown' else None)
else:
    print(f'Grouping by fixed bucket of {FIXTURES_PER_GW} (tier 3 — ESPN has no round data)')
    gameweeks = cluster_by_size(parsed_all, FIXTURES_PER_GW)

# ── Select best gameweek (skip stale completed GWs) ──────────────────────────

def gw_is_stale(gw):
    all_done = all(m['status'] in DONE_ST for m in gw)
    if not all_done:
        return False
    last_ko = max(
        datetime.fromisoformat(m['kickoff'].replace('Z', '+00:00'))
        for m in gw
    )
    return (now - last_ko).total_seconds() > 43200  # 12 hours

fresh_gameweeks = [gw for gw in gameweeks if not gw_is_stale(gw)]
candidates = fresh_gameweeks if fresh_gameweeks else gameweeks

print(f'Gameweeks found: {len(gameweeks)}, fresh: {len(fresh_gameweeks)}')

best_gw = min(candidates, key=lambda gw: min(
    abs((datetime.fromisoformat(m['kickoff'].replace('Z', '+00:00')) - now).total_seconds())
    for m in gw
))

fixtures   = best_gw
best_round = fixtures[0]['round'] if fixtures else 'Unknown'
best_week  = fixtures[0]['week_number'] if fixtures else None

livescores = [m for m in fixtures if m['status'] in (DONE_ST | LIVE_ST)]
print(f'Current round: {best_round} (week {best_week}) — {len(fixtures)} fixtures, {len(livescores)} live/done)')

# ── Live window check (skip if FORCE_RUN is set) ─────────────────────────────
if not FORCE_RUN and not is_live_window(fixtures):
    sys.exit(0)

# ── Write data files ──────────────────────────────────────────────────────────
os.makedirs('data', exist_ok=True)
ts = datetime.now(timezone.utc).isoformat()

with open('data/fixtures.json', 'w') as fh:
    json.dump({'updated': ts, 'round': best_round, 'week_number': best_week, 'fixtures': fixtures}, fh, indent=2)
with open('data/livescores.json', 'w') as fh:
    json.dump({'updated': ts, 'livescores': livescores}, fh, indent=2)

print(f'Done: {len(fixtures)} fixtures, {len(livescores)} live/completed.')
