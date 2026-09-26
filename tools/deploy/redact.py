#!/usr/bin/env python3
"""Replace the operator token on stdin with ***. Path is APIFY_TOKEN_FILE.

The default path is the operator-machine secrets file. Do not commit that file.
Expected JSON: {"card": {"APIFY_TOKEN": "..."}}.
"""
import json, os, sys

DEFAULT_SECRETS = '/home/box/agent-data/box-secrets.json'

def main() -> None:
    path = os.environ.get('APIFY_TOKEN_FILE', DEFAULT_SECRETS)
    with open(path, encoding='utf-8') as handle:
        token = json.load(handle)['card']['APIFY_TOKEN']
    if not isinstance(token, str) or not token:
        raise SystemExit('APIFY_TOKEN missing from secrets file')
    for line in sys.stdin:
        sys.stdout.write(line.replace(token, '***'))
        sys.stdout.flush()

if __name__ == '__main__':
    main()
