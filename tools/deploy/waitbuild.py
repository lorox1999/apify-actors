#!/usr/bin/env python3
import os, sys, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apify_api import call, scrub
bid = sys.argv[1]
while True:
    st, b = call('GET', f'/actor-builds/{bid}?waitForFinish=60')
    if b['data']['status'] not in ('READY', 'RUNNING'): break
d = b['data']; print(d['status'], d.get('buildNumber'), d.get('stats'), d.get('usageTotalUsd'))
if d['status'] != 'SUCCEEDED':
    st, log = call('GET', f'/logs/{bid}', raw=True)
    lines = [l for l in scrub(log).splitlines() if l.strip() and 'Progress:' not in l]
    print('\n'.join(lines[-60:]))
