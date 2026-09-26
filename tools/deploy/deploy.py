#!/usr/bin/env python3
"""Deploy a monorepo Actor privately via the Apify API (replacement for `apify push`, which needs a
token file and cannot push a dockerContextDir outside the Actor folder).
Uploads the monorepo root as SOURCE_FILES plus a staging-only root .actor/actor.json whose paths point
at actors/<name>/. Token comes from APIFY_TOKEN env only.
Usage: deploy.py <monorepo-root> <actors/NAME> [--fixed-memory MB]"""
import json, os, sys, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apify_api import call
ROOT, ACTOR_DIR = sys.argv[1], sys.argv[2].rstrip('/')
fixed_mem = int(sys.argv[sys.argv.index('--fixed-memory') + 1]) if '--fixed-memory' in sys.argv else None
cfg = json.load(open(os.path.join(ROOT, ACTOR_DIR, '.actor/actor.json')))
stage = dict(cfg)
stage.update({'dockerfile': f'../{ACTOR_DIR}/Dockerfile', 'dockerContextDir': '..',
              'input': f'../{ACTOR_DIR}/.actor/input_schema.json',
              'storages': {'dataset': f'../{ACTOR_DIR}/.actor/dataset_schema.json'},
              'output': f'../{ACTOR_DIR}/.actor/output_schema.json',
              'readme': f'../{ACTOR_DIR}/README.md'})
if fixed_mem: stage['defaultMemoryMbytes'] = fixed_mem
print('staging defaultMemoryMbytes =', repr(stage.get('defaultMemoryMbytes')))
SKIP_DIRS = {'node_modules', 'dist', 'storage', '.apify', '.git', 'coverage', 'docs', '.github'}
files = [{'name': '.actor/actor.json', 'format': 'TEXT', 'content': json.dumps(stage, indent=2)}]
total = 0
for d, dirs, fns in os.walk(ROOT):
    dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
    for fn in fns:
        p = os.path.join(d, fn); rel = os.path.relpath(p, ROOT)
        if rel.startswith('.actor/'): continue
        b = open(p, 'rb').read(); total += len(b)
        try: files.append({'name': rel, 'format': 'TEXT', 'content': b.decode('utf-8')})
        except UnicodeDecodeError: files.append({'name': rel, 'format': 'BASE64', 'content': base64.b64encode(b).decode()})
print(f'{len(files)} files, {total} bytes')
mem = stage.get('defaultMemoryMbytes'); mem = mem if isinstance(mem, int) else (fixed_mem or 4096)
version = {'versionNumber': cfg['version'], 'buildTag': cfg.get('buildTag', 'latest'), 'sourceType': 'SOURCE_FILES', 'sourceFiles': files}
run_opts = {'build': 'latest', 'timeoutSecs': 3600, 'memoryMbytes': mem}
st, me = call('GET', '/users/me'); user = me['data']['username']
st, act = call('GET', f'/acts/{user}~{cfg["name"]}')
if st == 404:
    st, act = call('POST', '/acts', {'name': cfg['name'], 'title': cfg['title'], 'description': cfg['description'],
        'isPublic': False, 'defaultRunOptions': run_opts, 'versions': [version]})
    print('create actor', st, act.get('error'))
    if st >= 300: sys.exit(1)
    actor_id = act['data']['id']
else:
    actor_id = act['data']['id']
    st, r = call('PUT', f'/acts/{actor_id}/versions/{cfg["version"]}', version)
    if st == 404: st, r = call('POST', f'/acts/{actor_id}/versions', version)
    print('update version', st, r.get('error'))
    if st >= 300: sys.exit(1)
    st, r = call('PUT', f'/acts/{actor_id}', {'isPublic': False, 'defaultRunOptions': run_opts})
    print('update actor defaults', st, r.get('error'))
st, a = call('GET', f'/acts/{actor_id}')
print('actorId', actor_id, 'isPublic', a['data'].get('isPublic'), 'pricingInfos', a['data'].get('pricingInfos'), 'defaultRunOptions', a['data'].get('defaultRunOptions'))
st, b = call('POST', f'/acts/{actor_id}/builds?version={cfg["version"]}&tag={cfg.get("buildTag","latest")}&waitForFinish=0')
print('build', st, json.dumps({k: b.get('data', {}).get(k) for k in ('id', 'status', 'buildNumber')}), b.get('error'))
