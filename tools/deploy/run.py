#!/usr/bin/env python3
"""Usage: run.py <actorId> <label> '<input-json>' [memoryMB]  -> saves build/runs/<label>/..."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apify_api import call, scrub
actor, label, inp = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
mem = sys.argv[4] if len(sys.argv) > 4 else None
out = f'/workspace/apify-actors/build/runs/{label}'; os.makedirs(out, exist_ok=True)
json.dump(inp, open(f'{out}/input.json', 'w'), indent=2)
q = f'?memory={mem}' if mem else ''
st, r = call('POST', f'/acts/{actor}/runs{q}', inp)
if st >= 300: print('start failed', st, r); sys.exit(1)
rid = r['data']['id']; print('run', rid, 'memory', r['data']['options'].get('memoryMbytes'), flush=True)
while True:
    st, r = call('GET', f'/actor-runs/{rid}?waitForFinish=60')
    if r['data']['status'] not in ('READY', 'RUNNING'): break
time.sleep(10)
st, r = call('GET', f'/actor-runs/{rid}'); run = r['data']
json.dump(run, open(f'{out}/run.json', 'w'), indent=2)
st, items = call('GET', f'/datasets/{run["defaultDatasetId"]}/items?clean=false&format=json')
json.dump(items, open(f'{out}/items.json', 'w'), indent=2)
st, summ = call('GET', f'/key-value-stores/{run["defaultKeyValueStoreId"]}/records/SUMMARY', raw=True)
open(f'{out}/SUMMARY.json', 'w').write(summ)
st, log = call('GET', f'/logs/{rid}', raw=True)
open(f'{out}/log.txt', 'w').write(scrub(log))
print(json.dumps({'label': label, 'id': rid, 'status': run['status'], 'statusMessage': run.get('statusMessage'),
    'memMB': run['options'].get('memoryMbytes'), 'memMaxMB': round(run['stats'].get('memMaxBytes', 0) / 2**20),
    'durationSecs': run['stats'].get('runTimeSecs'), 'CU': run['stats'].get('computeUnits'),
    'usageTotalUsd': run.get('usageTotalUsd'), 'chargedEventCounts': run.get('chargedEventCounts'),
    'items': len(items) if isinstance(items, list) else items}, indent=1))
