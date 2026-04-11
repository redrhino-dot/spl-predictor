import json, os, sys, requests
from datetime import datetime, timezone, timedelta

BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/sco.1'
HDRS = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}

DONE_ST = {'FT', 'AET', 'PEN'}
LIVE_ST = {'1H', 'HT', '2H', 'ET', 'LIVE'}

def espn_status(detail, clock):
    d = (detail or '').upper()
    if any(x in d for x in ('FINAL', 'FULL TIME', 'FT')): return 'FT'
    if any(x in d for x in ('HALF TIME', 'HALFTIME')):    return 'HT'
    if 'POSTPONE' in d:  return 'PST'
    if 'CANCEL'   in d:  return 'CANC'
    if 'PROGRESS' in d or 'LIVE' in d:
        try:
            mins = int((clock or '0:00').split(':')[0])
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
    clock      = status_obj.get('displayClock', '')
    status     = espn_status(detail, clock)
    elapsed    = None
    try:
        elapsed = int(clock.split(':')[0]) if clock and clock != '0:00' else None
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

# Scan 10 days back and 10 days forward to find gameweek matches
now    = datetime.now(timezone.utc)
events = {}
print('Scanning date range for current gameweek...')
for delta in range(-3, 8):
    day  = (now + timedelta(days=delta)).strftime('%Y%m%d')
    evs  = fetch_day(day)
    for e in evs:
        events[str(e.get('id'))] = e
    if evs:
        print(f'  {day}: {len(evs)} events')

all_events = list(events.values())
print(f'Total unique events found: {len(all_events)}')

if not all_events:
    print('ERROR: no events found from ESPN API', file=sys.stderr)
    sys.exit(1)

# Group by round — find the round with most recent/active matches
from collections import defaultdict
by_round = defaultdict(list)
for ev in all_events:
    parsed = parse_event(ev)
    if parsed:
        by_round[parsed['round']].append(parsed)

# Pick the round that contains the most recent kickoff
best_round = None
best_time  = None
for rnd, matches in by_round.items():
    for m in matches:
        if m['kickoff']:
            try:
                t = datetime.fromisoformat(m['kickoff'].replace('Z', '+00:00'))
                if best_time is None or abs((t - now).total_seconds()) < abs((best_time - now).total_seconds()):
                    best_time  = t
                    best_round = rnd
            except Exception:
                pass

if not best_round:
    best_round = list(by_round.keys())[0]

fixtures   = by_round[best_round]
livescores = [m for m in fixtures if m['status'] in (DONE_ST | LIVE_ST)]
print(f'Current round: {best_round} ({len(fixtures)} fixtures, {len(livescores)} live/done)')

os.makedirs('data', exist_ok=True)
ts = datetime.now(timezone.utc).isoformat()

with open('data/fixtures.json', 'w') as fh:
    json.dump({'updated': ts, 'round': best_round, 'fixtures': fixtures}, fh, indent=2)
with open('data/livescores.json', 'w') as fh:
    json.dump({'updated': ts, 'livescores': livescores}, fh, indent=2)

print(f'Done: {len(fixtures)} fixtures, {len(livescores)} live/completed.')
