**Bulk Core Web Vitals Checker** runs real Lighthouse audits on a list of URLs and gives you one row per page: Performance, Accessibility, Best Practices and SEO scores, plus the lab metrics behind Core Web Vitals — LCP, CLS, TBT and FCP — and the top fixes ranked by estimated savings. Lighthouse runs inside the Actor, so **no API key is needed**. If you have your own PageSpeed Insights API key, you can switch to it for a lower per-URL price and real-user (Chrome UX Report) field data. Paste URLs, or load them from a dataset such as the output of a sitemap extractor, and export the results to CSV, Excel or JSON.

Scores are lab data from Lighthouse run in this Actor's cloud environment. They are not Chrome UX Report field data unless you supply your own PageSpeed Insights API key.

## What does Bulk Core Web Vitals Checker do?

This bulk core web vitals checker runs a Lighthouse audit for every URL and device you select.

### Lighthouse audit for many URLs (mobile and desktop)

Paste a list of URLs, or point the Actor at a dataset. Choose mobile, desktop, or both. Each audit is one URL on one device. Mobile uses Lighthouse's mobile emulation. Desktop uses the Lighthouse desktop preset. Audits run one at a time so they do not compete for CPU.

### Core Web Vitals: LCP, CLS, TBT, FCP, Speed Index

Each successful row includes Performance, Accessibility, Best Practices and SEO scores (0–100) and the lab metrics LCP, CLS, TBT, FCP, Speed Index and TTFB. LCP, CLS and TBT are rated good, needs-improvement or poor using the usual thresholds (LCP 2.5s/4s, CLS 0.1/0.25, TBT 200ms/600ms). The row also includes `benchmarkIndex` so you can see how fast the machine was.

### Top fixes ranked by estimated savings

Up to N Lighthouse opportunities are included, sorted by estimated time saved. Each fix has an id, a title and numeric savings only. The Actor does not return screenshots, HTML reports, DOM snippets or the full Lighthouse JSON.

### Optional: your own PageSpeed Insights API key for field data

Leave the engine on local Lighthouse and no API key is required. If you set the engine to PageSpeed Insights and paste your own key, the Actor calls the PageSpeed Insights API with that key, bills the cheaper `url-audited` event, and adds Chrome UX Report field data when Google has it (LCP p75, INP p75, CLS p75). The key is a secret input: it is not written to the dataset, the summary or the log.

Typical uses: a page speed checker before a release, a bulk pagespeed test of a template, a weekly lighthouse scores export, and a full-site pass that starts from a sitemap extractor dataset.

## How to check Core Web Vitals in bulk

1. Open Bulk Core Web Vitals Checker and keep the default 4096 MB memory for local Lighthouse.
2. Paste URLs, or choose one of your datasets and the field that holds the URL (default `url`).
3. Choose the device and the Lighthouse categories, then start the run.
4. Open the Core Web Vitals table and export CSV, Excel or JSON.

Call the same input from the Apify API, or schedule a weekly run from the Apify Console to watch the same URL list over time. You can chain a sitemap extractor dataset in as `urlsDataset`.

## Input

| Field | What it does |
| --- | --- |
| URLs to audit | One http(s) URL per line. |
| Load URLs from a dataset (optional) | Read-only access to one dataset you pick. |
| URL field in the dataset | Field name that holds the URL. Default `url`. Error rows in that dataset are ignored. |
| Max URLs per run | Cap on how many URLs are audited. Default 500. |
| Device | Mobile, desktop, or mobile + desktop. Both devices are two audits. |
| Lighthouse categories | Performance, Accessibility, Best practices, SEO. |
| Top improvement suggestions per page | How many fixes to keep. Default 5. |
| Audit engine | Local Lighthouse (no API key) or PageSpeed Insights API (your own key). |
| Your PageSpeed Insights API key | Secret. Used only for this run's requests when the engine is PageSpeed Insights. |
| Timeout per audit (seconds) | Default 60. Audits that exceed it are `TIMEOUT` and are not billed. |
| Retries per failed audit | Extra attempts after a timeout or a Chrome crash. Default 1. |
| Pre-check that URLs respond | Skip DNS failures and HTTP 4xx/5xx before launching Lighthouse. Those rows are free. |

```json
{
  "urls": ["https://example.com"],
  "strategy": "mobile"
}
```

## Output example

One row per URL and device. Views in the output schema: **Core Web Vitals**, **Field data (PSI key only)** and **Top fixes**.

```json
{
  "url": "https://example.com/",
  "finalUrl": "https://example.com/",
  "strategy": "mobile",
  "engine": "local",
  "status": "ok",
  "performanceScore": 92,
  "accessibilityScore": 96,
  "bestPracticesScore": 100,
  "seoScore": 90,
  "lcpMs": 812,
  "fcpMs": 400,
  "cls": 0.04,
  "tbtMs": 80,
  "speedIndexMs": 901,
  "ttfbMs": 35,
  "lcpRating": "good",
  "clsRating": "good",
  "tbtRating": "good",
  "fieldDataAvailable": null,
  "topOpportunities": [
    {
      "id": "render-blocking-resources",
      "title": "Eliminate render-blocking resources",
      "savingsMs": 300,
      "savingsBytes": 12000
    }
  ],
  "lighthouseVersion": "13.5.0",
  "benchmarkIndex": 1650,
  "charged": true,
  "errorCode": null,
  "errorMessage": null,
  "auditedAt": "2026-09-26T03:50:00.000Z"
}
```

Failed audits are rows too, with `status` `error`, `charged` false, and an `errorCode` such as `DNS_ERROR`, `UNREACHABLE`, `HTTP_4XX_PRECHECK`, `HTTP_5XX_PRECHECK`, `TIMEOUT`, `CHROME_CRASH`, `BLOCKED_BY_ROBOTS`, `LIGHTHOUSE_ERROR` or `LOW_MEMORY_FOR_LIGHTHOUSE`.

The key-value record `SUMMARY` has audited, failed (grouped by error code), billed counts and the average audit duration.

## How much does a bulk Lighthouse audit cost?

`url-audited-local` — $0.02 per audit (FREE/BRONZE), $0.018 (SILVER), $0.016 (GOLD); `url-audited` (your own PageSpeed Insights key) — $0.003 / $0.002 / $0.0018 / $0.0016; failed audits are free; plus the default Actor start fee.

| Event | When it is charged | FREE | BRONZE | SILVER | GOLD |
| --- | --- | --- | --- | --- | --- |
| `url-audited-local` | One successful local Lighthouse audit (one URL, one device) | $0.02 | $0.02 | $0.018 | $0.016 |
| `url-audited` | One successful PageSpeed Insights call with your own key | $0.003 | $0.002 | $0.0018 | $0.0016 |

Actor start uses the platform default (about $0.00005 per GB of memory, so about $0.0002 at 4096 MB). This Actor does not use `apify-default-dataset-item`.

Example 1: Starter (BRONZE), 100 URLs, mobile only = 100 × $0.02 = **$2.00**, plus about $0.0002 to start.

Example 2: the same 100 URLs on mobile and desktop = **$4.00**.

Example 3: the same 100 URLs with your own PageSpeed Insights key on BRONZE = 100 × $0.002 = **$0.20**.

Failed audits stay free (`charged` is false): timeouts, DNS errors, HTTP 4xx/5xx found by the pre-check, Chrome crashes, robots.txt blocks and Lighthouse runtime errors. A page that returns 4xx/5xx but still produces a Lighthouse result when the pre-check is off is a completed audit and is billed. Set a maximum charge on the run. The Actor checks that the next audit still fits before it starts, then stops and keeps the rows already written.

## FAQ

### Why are my scores different from PageSpeed Insights?

These scores are lab data from Lighthouse run in the Actor's cloud environment (default 4096 MB, one CPU). PageSpeed Insights uses different hardware, a different network and sometimes a different Lighthouse build. Compare `benchmarkIndex` and `lighthouseVersion` between runs, and compare trends with the same tool. A single run moves around; run an important URL a few times and use the median.

### Do I need a Google API key?

No. Local Lighthouse is the default and needs no key. Add your own PageSpeed Insights API key only if you want the lower `url-audited` price and Chrome UX Report field data.

### What is the difference between lab data and field data?

Lab data is this run's Lighthouse measurement (LCP, CLS, TBT, FCP, Speed Index). Field data is aggregated real-user Chrome UX Report data and is returned only in PageSpeed Insights mode, when Google has enough traffic for that URL or origin. Local mode does not include INP. INP is a field metric (`fieldInpP75Ms`).

### How many URLs can I audit per run, and how long does it take?

The input cap is 10,000 URLs. Local audits are sequential, so a long list should be split or scheduled. Plan on roughly one audit per minute until you measure your own URLs, and keep a single run to a few hundred URLs. The per-URL timeout defaults to 60 seconds.

### Which memory setting should I use?

Use **4096 MB** for local Lighthouse. Below that the Actor does not start Chrome and every row is `LOW_MEMORY_FOR_LIGHTHOUSE` (not billed). PageSpeed Insights mode only makes HTTP calls and can run at 1024 MB. You can raise local runs to 8192 MB. Do not run several Lighthouse audits at once on the same machine; this Actor does not.

### Can I audit pages behind a login?

No. The Actor does not sign in, does not use a proxy, and does not bypass access controls. HTTP 403 stays 403.

### Can I use the output of Sitemap URL Extractor as input?

Yes. Choose that run's dataset and leave the URL field as `url`. Rows with `recordType` `error` are ignored.

## Limitations

- Results are lab data from Lighthouse in the Actor's cloud environment, not a guarantee of what users see. Field data exists only when you bring a PageSpeed Insights key and Chrome UX Report has data.
- Scores vary from run to run. Use `benchmarkIndex` and repeat important pages.
- Local mode has no INP. TBT is the lab stand-in.
- Login walls, paywalls and bot walls are not bypassed. robots.txt Disallow is respected.
- No screenshots, no HTML report, no DOM snippets, no full Lighthouse JSON.
- One local audit at a time. Very large lists should be batched.
- URLs with a username or password, and private or local hosts, are rejected so credentials are not stored.

## Disclaimer

Lighthouse, PageSpeed Insights and Chrome are trademarks of Google LLC. This Actor is an independent tool and is not affiliated with or endorsed by Google.

If you use your own PageSpeed Insights API key, you are responsible for following the Google API terms that apply to that key. The key is used only to call PageSpeed Insights for the URLs in that run.
