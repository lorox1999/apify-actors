# apify-actors

Private monorepo for Apify Store pay-per-event Actors.

## Layout

- `actors/sitemap-url-diff-extractor` — sitemap URL extractor with change tracking and an llms.txt check (implemented).
- `actors/broken-link-and-redirect-checker` — broken link checker with site crawl and bulk URL status (implemented).
- `actors/rising-repos-for-github` — placeholder until a later task.
- `actors/bulk-core-web-vitals-checker` — bulk Lighthouse Core Web Vitals audits (local Chrome, optional user PageSpeed Insights key).
- `packages/common` — shared charging, errors, redaction, URL helpers, and HTTP retry.
- `docs/specs` — product specs copied in for reference.
- `tools/selftest` and `tools/costreport` — reserved for later tasks.

## Local run

Install dependencies with pnpm (Node.js 22), build, then run an Actor from its directory:

```bash
pnpm install
pnpm build
cd actors/sitemap-url-diff-extractor
ACTOR_TEST_PAY_PER_EVENT=true apify run
```

`apify run` does not need a token. Pay-per-event test charges are written under the local storage directory when `ACTOR_TEST_PAY_PER_EVENT=true`.

## Tests

```bash
pnpm test
```

The sitemap Actor tests use a local fixture server. They do not call live websites unless you set `E2E=1`.

## Secrets

Do not put Apify, GitHub, or Google tokens in source, tests, logs, or commits. This repository's CI workflow does not read any secrets. Redaction helpers live in `packages/common` and must stay on every log line that could contain a header or a token.
