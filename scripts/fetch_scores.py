import json, os, re, sys
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

FIXTURES_URL  = 'https://www.flashscore.co.uk/football/scotland/premiership/fixtures/'
RESULTS_URL   = 'https://www.flashscore.co.uk/football/scotland/premiership/results/'
CURRENT_ROUND = 'Regular Season - 33'   # ← update each gameweek

DONE_ST = {'FT', 'AET', 'PEN'}
LIVE_ST = {'1H', 'HT', '2H', 'ET', 'P', 'LIVE'}
COUNT_ST = DONE_ST | LIVE_ST

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
      'AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/122.0.0.0 Safari/537.36')

def parse_status(t):
    t = (t or '').strip().upper().replace("'", '').split('+')[0].strip()
    if not t or t == '-':      return 'NS'
    if t == 'HT':              return 'HT'
    if t in ('FT', 'FINISHED', 'ENDED'): return 'FT'
    if t == 'AET':             return 'AET'
    if t in ('AP', 'PEN'):     return 'PEN'
    if 'POSTP' in t:           return 'PST'
    if 'CANC' in t:            return 'CANC'
    if re.match(r'^\d+', t):
        mins = int(re.match(r'^(\d+)', t).group(1))
        return '2H' if mins > 45 else '1H'
    return 'NS'

def scrape(url, fallback_status):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            user_agent=UA,
            viewport={'width': 1280, 'height': 900},
            locale='en-GB',
            timezone_id='Europe/London',
        )
        pg = ctx.new_page()
        pg.goto(url, wait_until='domcontentloaded', timeout=30000)

        try:
            pg.click('#onetrust-accept-btn-handler', timeout=4000)
        except Exception:
            pass

        try:
            pg.wait_for_selector('[id^="g_1_"]', timeout=15000)
        except Exception:
            print(f'WARNING: no match elements on {url}')
            browser.close()
            return []

        pg.wait_for_timeout(2000)

        raw = pg.evaluate('''() => {
            const out = [];
            document.querySelectorAll('[id^="g_1_"]').forEach(el => {
                const hEl = el.querySelector('[class*="participant--home"]');
                const aEl = el.querySelector('[class*="participant--away"]');
                if (!hEl || !aEl) return;
                const sh  = el.querySelector('[class*="score--home"]');
                const sa  = el.querySelector('[class*="score--away"]');
                const tm  = el.querySelector('[class*="event__time"]');
                out.push({
                    id:    el.id.replace('g_1_', ''),
                    home:  hEl.innerText.trim(),
                    away:  aEl.innerText.trim(),
                    sh:    sh ? sh.innerText.trim() : null,
                    sa:    sa ? sa.innerText.trim() : null,
                    tt:    tm ? tm.innerText.trim() : '',
                    stamp: el.getAttribute('data-stamp'),
                });
            });
            return out;
        }''')

        browser.close()
        print(f'  {url}: {len(raw)} events')

        out = []
        for r in raw:
            h_sc = int(r['sh']) if r.get('sh') and str(r['sh']).isdigit() else None
            a_sc = int(r['sa']) if r.get('sa') and str(r['sa']).isdigit() else None
            status = parse_status(r.get('tt')) or fallback_status
            kickoff = None
            if r.get('stamp'):
                try:
                    kickoff = datetime.fromtimestamp(
                        int(r['stamp']), tz=timezone.utc).isoformat()
                except Exception:
                    pass
            elapsed = None
            m = re.match(r'^(\d+)', (r.get('tt') or '').strip())
            if m:
                elapsed = int(m.group(1))
            out.append({
                'id':         r['id'],
                'round':      CURRENT_ROUND,
                'kickoff':    kickoff,
                'status':     status,
                'home_team':  r['home'],
                'away_team':  r['away'],
                'home_score': h_sc,
                'away_score': a_sc,
                'elapsed':    elapsed,
            })
        return out

print('Scraping fixtures...')
fix = scrape(FIXTURES_URL, fallback_status='NS')

print('Scraping results...')
res = scrape(RESULTS_URL,  fallback_status='FT')

# Merge — results override fixtures for completed matches
merged = {m['id']: m for m in res}
for m in fix:
    if m['id'] not in merged:
        merged[m['id']] = m

all_matches = list(merged.values())
livescores  = [m for m in all_matches if m['status'] in COUNT_ST]

if not all_matches:
    print('ERROR: no matches found — possible Cloudflare block', file=sys.stderr)
    sys.exit(1)

os.makedirs('data', exist_ok=True)
now = datetime.now(timezone.utc).isoformat()

with open('data/fixtures.json', 'w') as fh:
    json.dump({'updated': now, 'round': CURRENT_ROUND,
               'fixtures': all_matches}, fh, indent=2)
with open('data/livescores.json', 'w') as fh:
    json.dump({'updated': now, 'livescores': livescores}, fh, indent=2)

print(f'Done: {len(all_matches)} fixtures, {len(livescores)} live/completed.')
