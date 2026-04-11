import json, requests, sys, os
from datetime import datetime, timezone

LEAGUE_ID = 4328
API_BASE  = 'https://www.thesportsdb.com/api/v1/json/3'

STATUS_MAP = {
    'Match Finished': 'FT',
    'Not Started':    'NS',
    'In Progress':    'LIVE',
    'Half Time':      'HT',
    'Extra Time':     'ET',
    'Postponed':      'PST',
    'Cancelled':      'CANC',
}

TEAM_FIX = {
    'Rangers FC':              'Rangers',
    'Celtic FC':               'Celtic',
    'Heart of Midlothian FC':  'Heart of Midlothian',
    'Hibernian FC':            'Hibernian',
    'Aberdeen FC':             'Aberdeen',
    'Kilmarnock FC':           'Kilmarnock',
    'Motherwell FC':           'Motherwell',
    'St Mirren FC':            'St Mirren',
    'Dundee FC':               'Dundee',
    'Dundee United FC':        'Dundee United',
    'Livingston FC':           'Livingston',
    'Ross County FC':          'Ross County',
    'St Johnstone FC':         'St Johnstone',
    'Partick Thistle FC':      'Partick Thistle',
}

def clean_team(name):
    return TEAM_FIX.get(name, name)

def fetch(endpoint):
    r = requests.get(f'{API_BASE}/{endpoint}', timeout=30)
    r.raise_for_status()
    return r.json()

def parse_event(e):
    status   = STATUS_MAP.get(e.get('strStatus', ''), 'NS')
    d        = e.get('dateEvent', '')
    t        = e.get('strTime') or '00:00:00'
    kickoff  = f"{d}T{t}Z" if d else None
    h        = e.get('intHomeScore')
    a        = e.get('intAwayScore')
    return {
        'id':         int(e['idEvent']),
        'round':      str(e.get('intRound', '')),
        'kickoff':    kickoff,
        'status':     status,
        'home_team':  clean_team(e.get('strHomeTeam', '')),
        'away_team':  clean_team(e.get('strAwayTeam', '')),
        'home_score': int(h) if h not in (None, '') else None,
        'away_score': int(a) if a not in (None, '') else None,
        'elapsed':    None,
    }

past = (fetch(f'eventspastleague.php?id={LEAGUE_ID}').get('events') or [])
nxt  = (fetch(f'eventsnextleague.php?id={LEAGUE_ID}').get('events') or [])
print(f"Past: {len(past)}, Next: {len(nxt)}")

if not past and not nxt:
    print("ERROR: no events returned", file=sys.stderr)
    sys.exit(1)

current_round = past[-1]['intRound'] if past else nxt[0]['intRound']
print(f"Current round: {current_round}")

all_events    = past + nxt
round_events  = [e for e in all_events if e.get('intRound') == current_round]
print(f"Round events: {len(round_events)}")

LIVE_ST    = ['1H','HT','2H','ET','P','FT','AET','PEN','LIVE']
fixtures   = [parse_event(e) for e in round_events]
livescores = [f for f in fixtures if f['status'] in LIVE_ST]

os.makedirs('data', exist_ok=True)
now = datetime.now(timezone.utc).isoformat()

with open('data/fixtures.json', 'w') as fh:
    json.dump({'updated': now, 'round': current_round, 'fixtures': fixtures}, fh, indent=2)
with open('data/livescores.json', 'w') as fh:
    json.dump({'updated': now, 'livescores': livescores}, fh, indent=2)

print(f"Done: {len(fixtures)} fixtures, {len(livescores)} live/completed.")
