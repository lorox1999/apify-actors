# apify-actors

Apify Store pay-per-event Actors (monorepo).

This repository is an npm-workspaces monorepo. Each Actor lives under
[`actors/`](./actors) and is an independently runnable [Apify](https://apify.com)
Actor using the pay-per-event pricing model.

## Actors

| Actor | Description |
| --- | --- |
| [`pay-per-event-scraper`](./actors/pay-per-event-scraper) | Scrapes page titles/headings and charges once per scraped page. |

## Requirements

- Node.js >= 20 (Node 22 recommended)
- npm >= 10

## Getting started

```bash
# Install all workspace dependencies
npm install

# Run the linter
npm run lint

# Run all unit tests
npm test

# Run the example Actor locally (uses Crawlee/Apify local storage under ./storage)
npm start
# or run a specific Actor:
npm start --workspace=pay-per-event-scraper
```

Results are written to the local Apify storage under
`actors/<actor>/storage/` (git-ignored). Pay-per-event charges are logged to the
console when running locally.

## Working with the Apify CLI

The [`apify-cli`](https://docs.apify.com/cli) is installed as a dev dependency:

```bash
# From an actor directory, e.g. actors/pay-per-event-scraper
npx apify run --purge
```

## Adding a new Actor

1. Create a new directory under `actors/<your-actor>`.
2. Add a `package.json` (with `start` and `test` scripts), `src/`, and an
   `.actor/` folder (`actor.json`, `input_schema.json`, `pay_per_event.json`).
3. Run `npm install` at the repo root to link the new workspace.
