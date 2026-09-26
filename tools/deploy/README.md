# Deploy helpers

Python scripts that talk to the Apify public API. They use only the standard library. The token is read from the `APIFY_TOKEN` environment variable and is never written into this repository.

## Deploy an Actor

From the repository root:

```bash
export APIFY_TOKEN=...
python3 tools/deploy/deploy.py . actors/bulk-core-web-vitals-checker
```

`deploy.py` uploads the repository tree as Apify `SOURCE_FILES`. It skips `node_modules`, `dist`, `storage`, `.apify`, `.git`, `coverage`, `docs` and `.github`. It also uploads a temporary root `.actor/actor.json` that is not committed. That file sets `dockerContextDir` to `..` (the upload root, which is the repository root) and points `dockerfile`, `input`, `storages.dataset`, `output` and `readme` at `actors/<name>/`. The platform resolves those paths from the uploaded `.actor/` folder, so `..` is the repository root inside the upload.

The same command works for any Actor folder under `actors/`, for example `actors/sitemap-url-diff-extractor`.

Optional: `--fixed-memory 4096` overrides `defaultMemoryMbytes` on the uploaded actor.json and on the Actor's default run options.

## Other commands

Each script adds `tools/deploy` to `sys.path`, so they can be run from the repository root.

- `waitbuild.py <buildId>` polls a build and prints the last log lines when it fails. Log text is scrubbed.
- `run.py <actorId> <label> '<input-json>' [memoryMB]` starts a run and writes `input.json`, `run.json`, `items.json`, `SUMMARY.json` and `log.txt` under `/workspace/apify-actors/build/runs/<label>`. The log is scrubbed.
- `api.py METHOD PATH [json-body-file]` calls any `/v2` path. A path that starts with `/v2/` is trimmed. The response is scrubbed.
- `withtoken.py COMMAND ...` reads a local secrets file and execs the command with `APIFY_TOKEN` set. The file path is `APIFY_TOKEN_FILE` (default `/home/box/agent-data/box-secrets.json`). Expected shape: `{"card": {"APIFY_TOKEN": "..."}}`. The token is not printed. Do not commit that file.
- `redact.py` reads stdin, replaces the token from that same secrets file with `***`, and writes stdout.

API responses are scrubbed with the `APIFY_TOKEN` environment value. `withtoken.py` and `redact.py` read the secrets file only when you run them.
