#!/usr/bin/env python3
"""Usage: api.py METHOD PATH [json-body-file]"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apify_api import call, scrub
body = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None
p = sys.argv[2][3:] if sys.argv[2].startswith('/v2/') else sys.argv[2]
st, r = call(sys.argv[1], p, body, raw=True)
if st >= 300: print('HTTP', st, file=sys.stderr)
print(scrub(r))
