#!/usr/bin/env python3
"""Run a command with APIFY_TOKEN injected from a local secrets file (never printed).

The file path is APIFY_TOKEN_FILE. The default is the operator-machine path
used by the original helper. Do not commit that file.
Expected JSON: {"card": {"APIFY_TOKEN": "..."}}.
"""
import json, os, sys

DEFAULT_SECRETS = '/home/box/agent-data/box-secrets.json'

def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit('usage: withtoken.py COMMAND [ARGS...]')
    path = os.environ.get('APIFY_TOKEN_FILE', DEFAULT_SECRETS)
    with open(path, encoding='utf-8') as handle:
        token = json.load(handle)['card']['APIFY_TOKEN']
    if not isinstance(token, str) or not token:
        raise SystemExit('APIFY_TOKEN missing from secrets file')
    env = dict(os.environ)
    env['APIFY_TOKEN'] = token
    os.execvpe(sys.argv[1], sys.argv[1:], env)

if __name__ == '__main__':
    main()
