import os, json, requests, sys
from datetime import datetime, timezone

API_KEY   = os.environ['API_KEY']
LEAGUE_ID = 179
SEASON    = 2025
HEADERS   = {
    'x-rapidapi-host': 'v3.football.api-sports.io',
    'x-rapidapi-key':  API_KEY,
}

def fetch(endpoint, params=None):
    r = requests.get(
        f'https://v3.football.api-sports.io/{endpoint}',
        headers=HEADERS, params=params or {}, timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    print(f"[{endpoint}] results={data.get('results')} errors={data.get('errors')}")
    return data['response']

round_data    = fetch('fixtures/rounds', {'league': LEAGUE_ID, 'season': SEASON, 'current': 'true'})
current_round = round_data[0] if round_data else None
print(f"Current round: {current_round}")

if not current_round:
    all_rounds    = fetch('fixtures/rounds', {'league': LEAGUE_ID, 'season': SEASON})
    current_round = all_rounds[-1] if all_rounds else None
    print(f"Fallback round: {current_round}")

fixtures   = []
livescores = []
LIVE_ST    = ['1H','HT','2H','ET','P','FT','AET','PEN','LIVE']

if not current_round:
    print("ERROR: no round found", file=sys.stderr)
    sys.exit(1)

data = fetch('fixtures', {'league': LEAGUE_ID, 'season': SEASON, 'round': current_round})
print(f"Fixtures returned: {len(data)}")

for f in data:
    entry = {
        'id':         f['fixture']['id'],
        'round':      current_round,
        'kickoff':    f['fixture']['date'],
        'status':     f['fixture']['status']['short'],
        'home_team':  f['teams']['home']['name'],
        'away_team':  f['teams']['away']['name'],
        'home_score': f['goals']['home'],
        'away_score': f['goals']['away'],
        'elapsed':    f['fixture']['status']['elapsed'],
    }
    fixtures.append(entry)
    if entry['status'] in LIVE_ST:
        livescores.append(entry)

os.makedirs('data', exist_ok=True)
now = datetime.now(timezone.utc).isoformat()

with open('data/fixtures.json', 'w') as fh:
    json.dump({'updated': now, 'round': current_round, 'fixtures': fixtures}, fh, indent=2)

with open('data/livescores.json', 'w') as fh:
    json.dump({'updated': now, 'livescores': livescores}, fh, indent=2)

print(f"Done: {len(fixtures)} fixtures, {len(livescores)} live/completed.")
