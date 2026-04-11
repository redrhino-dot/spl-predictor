import json, os, re, sys, requests
from datetime import datetime, timezone
from bs4 import BeautifulSoup

FIXTURES_URL = 'https://www.bbc.co.uk/sport/football/scottish-premiership/scores-fixtures'
RESULTS_URL  = 'https://www.bbc.co.uk/sport/football/scottish-premiership/results'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.5',
}

STATUS_MAP = {
    'ft': 'FT', 'fulltime': 'FT', 'full-time': 'FT',
    'ht': 'HT', 'half-time': 'HT', 'halftime': 'HT',
    'live': 'LIVE', 'inprogress': 'LIVE',
    'ns': 'NS', 'fixture': 'NS',
    'postponed': 'PST', 'cancelled': 'CANC', 'aet': 'AET', 'pen': 'PEN',
}

def parse_status(s):
    if not s:
        return 'NS'
    s = s.lower().replace(' ', '').replace('-', '')
    for k, v in STATUS_MAP.items():
        if k in s:
            return v
    if re.search(r'\d+', s):
        mins = int(re.search(r'(\d+)', s).group(1))
        return '2H' if mins > 45 else '1H'
    return 'NS'

def scrape_bbc(url):
    print(f'Fetching {url}')
    r = requests.get(url, headers=HEADERS, timeout=20)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, 'html.parser')

    # BBC Sport embeds data as JSON in a script tag
    for script in soup.find_all('script'):
        if script.string and 'matchData' in (script.string or ''):
            match = re.search(r'"matchData"\s*:\s*(\\[.*?\\])\s*[,}]', script.string, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group(1))
                except Exception:
                    pass

    # Fallback: parse HTML match elements directly
    matches = []
    for el in soup.select('[data-reactid], .sp-c-fixture, article'):
        home_el  = el.select_one('[class*="home"] [class*="team-name"], [class*="fixture__team--home"]')
        away_el  = el.select_one('[class*="away"] [class*="team-name"], [class*="fixture__team--away"]')
        if not home_el or not away_el:
            continue
        scores = el.select('[class*="score"], [class*="fixture__score"]')
        h_score = a_score = None
        if len(scores) >= 2:
            try: h_score = int(scores[0].get_text(strip=True))
            except: pass
            try: a_score = int(scores[1].get_text(strip=True))
            except: pass
        status_el = el.select_one('[class*="status"], [class*="fixture__status"]')
        status = parse_status(status_el.get_text(strip=True) if status_el else '')
        mid = el.get('data-fixture-id') or el.get('id') or f'{home_el.get_text()}{away_el.get_text()}'
        matches.append({
            'raw_id': mid,
            'home':   home_el.get_text(strip=True),
            'away':   away_el.get_text(strip=True),
            'h_score': h_score,
            'a_score': a_score,
            'status':  status,
            'kickoff': None,
        })
    print(f'  HTML fallback: {len(matches)} matches')
    return matches

def scrape_page(url, fallback_status):
    r = requests.get(url, headers=HEADERS, timeout=20)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, 'html.parser')
    print(f'  Got {len(r.text)} bytes from {url}')

    matches = []
    current_round = None

    for el in soup.find_all(True):
        cls = ' '.join(el.get('class', []))

        if 'round' in cls.lower() or 'matchday' in cls.lower():
            txt = el.get_text(strip=True)
            if txt:
                current_round = txt
            continue

        home_el = (el.select_one('[class*="fixture__team--home"] [class*="fixture__team-name"]') or
                   el.select_one('[class*="home-team"] [class*="name"]'))
        away_el = (el.select_one('[class*="fixture__team--away"] [class*="fixture__team-name"]') or
                   el.select_one('[class*="away-team"] [class*="name"]'))
        if not home_el or not away_el:
            continue

        score_els = el.select('[class*="fixture__score-container"] [class*="fixture__number"]')
        h_score = a_score = None
        if len(score_els) >= 2:
            try: h_score = int(score_els[0].get_text(strip=True))
            except: pass
            try: a_score = int(score_els[1].get_text(strip=True))
            except: pass

        status_el = el.select_one('[class*="fixture__status"]')
        status = parse_status(status_el.get_text(strip=True) if status_el else '') or fallback_status

        time_el = el.select_one('[class*="fixture__number--time"], time')
        kickoff = None
        if time_el:
            dt_str = time_el.get('datetime') or time_el.get_text(strip=True)
            try:
                kickoff = datetime.fromisoformat(dt_str.replace('Z', '+00:00')).isoformat()
            except Exception:
                pass

        mid = (el.get('data-fixture-id') or el.get('data-id') or
               f'{home_el.get_text().strip()}_v_{away_el.get_text().strip()}')

        matches.append({
            'raw_id':   mid,
            'round':    current_round,
            'home':     home_el.get_text(strip=True),
            'away':     away_el.get_text(strip=True),
            'h_score':  h_score,
            'a_score':  a_score,
            'status':   status,
            'kickoff':  kickoff,
        })

    print(f'  Parsed {len(matches)} matches, round={current_round}')
    return current_round, matches

print('Scraping BBC Sport fixtures...')
fix_round, fix_matches = scrape_page(FIXTURES_URL, 'NS')
print('Scraping BBC Sport results...')
res_round, res_matches = scrape_page(RESULTS_URL, 'FT')

current_round = fix_round or res_round or 'Unknown'
print(f'Round: {current_round}')

DONE_ST  = {'FT', 'AET', 'PEN'}
LIVE_ST  = {'1H', 'HT', '2H', 'ET', 'P', 'LIVE'}
COUNT_ST = DONE_ST | LIVE_ST

merged = {}
for m in res_matches:
    merged[m['raw_id']] = m
for m in fix_matches:
    if m['raw_id'] not in merged:
        merged[m['raw_id']] = m

all_matches = []
for i, m in enumerate(merged.values()):
    all_matches.append({
        'id':         m['raw_id'],
        'round':      m.get('round') or current_round,
        'kickoff':    m.get('kickoff'),
        'status':     m.get('status', 'NS'),
        'home_team':  m['home'],
        'away_team':  m['away'],
        'home_score': m['h_score'],
        'away_score': m['a_score'],
        'elapsed':    None,
    })

livescores = [m for m in all_matches if m['status'] in COUNT_ST]

if not all_matches:
    print('ERROR: no matches scraped from BBC Sport', file=sys.stderr)
    sys.exit(1)

os.makedirs('data', exist_ok=True)
now = datetime.now(timezone.utc).isoformat()

with open('data/fixtures.json', 'w') as fh:
    json.dump({'updated': now, 'round': current_round, 'fixtures': all_matches}, fh, indent=2)
with open('data/livescores.json', 'w') as fh:
    json.dump({'updated': now, 'livescores': livescores}, fh, indent=2)

print(f'Done: {len(all_matches)} fixtures, {len(livescores)} live/completed.')
