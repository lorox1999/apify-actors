"""Shared Apify API helper; token from APIFY_TOKEN env only."""
import json, os, time, http.client, urllib.request, urllib.error
TOK = os.environ['APIFY_TOKEN']; API = 'https://api.apify.com/v2'
def call(method, path, body=None, raw=False, ctype='application/json', tries=4):
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    for i in range(tries):
        req = urllib.request.Request(API + path, data=data, method=method,
              headers={'Authorization': 'Bearer ' + TOK, 'Content-Type': ctype})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                b = r.read().decode(); return r.status, (b if raw else json.loads(b or '{}'))
        except urllib.error.HTTPError as e:
            b = e.read().decode(); return e.code, (b if raw else json.loads(b or '{}'))
        except (urllib.error.URLError, ConnectionError, TimeoutError, http.client.HTTPException):
            if i == tries - 1 or method == 'POST': raise
            time.sleep(3)
def scrub(s): return s.replace(TOK, '***')
