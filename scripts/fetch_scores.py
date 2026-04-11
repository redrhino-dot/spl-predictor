import os
import json
import requests
from datetime import datetime

API_KEY   = os.environ['API_KEY']
LEAGUE_ID = 179
SEASON    = 2024
HEADERS   = {
    'x-rapidapi-host': 'v3.football.api-sports.io',
    'x-rapidapi-key':  API_KEY,
}

def fetch(endpoint, params=None):
    r = requests.get(
        f'https://v3.football.api-sports.io/{endpoint}',
        headers=HEADERS,
        params=params or {},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()['response']

# Determine current round
round_data    = fetch('fixtures/rounds', {'league': LEAGUE_ID, 'season': SEASON, 'current': 'true'})
current_round = round_data[0] if round_data else None

fixtures, livescores = [], []

if current_round:
    data = fetch('fixtures', {'league': LEAGUE_ID, 'season': SEASON, 'round': current_round})
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
        if entry['status'] in ['1H','HT','2H','ET','P','FT','AET','PEN','LIVE']:
            livescores.append(entry)

os.makedirs('data', exist_ok=True)

with open('data/fixtures.json', 'w') as fh:
    json.dump({
        'updated':  datetime.utcnow().isoformat() + 'Z',
        'round':    current_round,
        'fixtures': fixtures,
    }, fh, indent=2)

with open('data/livescores.json', 'w') as fh:
    json.dump({
        'updated':    datetime.utcnow().isoformat() + 'Z',
        'livescores': livescores,
    }, fh, indent=2)

print(f'Done: {len(fixtures)} fixtures, {len(livescores)} live/completed.')
