**Sitemap URL Extractor** gets every URL a website lists in its XML sitemaps, in one clean table. Enter a domain and this sitemap extractor finds the sitemaps through robots.txt and common paths, follows sitemap indexes and `.gz` files, and returns each URL with `lastmod`, `changefreq` and `priority`. Turn on change tracking to see which URLs were **added** or **removed** since your last run, check whether the site publishes `llms.txt`, and optionally record the HTTP status of every URL. Use it for SEO audits, site migrations, content monitoring and seeding your own crawlers.

## What does Sitemap URL Extractor do?

This sitemap URL extractor reads the files a website already publishes for crawlers. It does not download page HTML.

### Extract URLs from sitemap (XML, .gz, sitemap index)

Paste a domain, a homepage, a robots.txt URL, or a sitemap URL (`.xml`, `.xml.gz`, or a plain-text sitemap). Sitemap index files are followed up to the depth and file caps you set. Gzip is detected from the file bytes, not only from the file name. Each URL row includes `lastmod`, `changefreq`, and `priority` when the sitemap provides them.

Image, video, news, and hreflang extensions are counted only (`imageCount`, `videoCount`, `hreflangCount`, `sitemapKind`). Captions, titles, uploaders, and keywords are never stored.

### Find sitemaps automatically via robots.txt

For a domain or homepage, the Actor reads `Sitemap:` lines from robots.txt. If none are listed, it probes `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap-index.xml`, `/sitemap.xml.gz`, and `/wp-sitemap.xml`.

### Sitemap monitoring: added and removed URLs

Turn on change tracking to compare this run with the previous one. The first run only stores a baseline snapshot and does not charge `site-compared`. Each later run marks current URLs `added` or `unchanged`. URLs that disappeared are extra rows with `changeType` `removed` and the `source` saved in the snapshot (`sitemap` or `llms.txt`). If that snapshot did not record a source, `source` is empty.

Snapshots live in a named key-value store in your own Apify account (default name `sitemap-url-diff-state`). The store key is a hash of the site plus your filter settings. Nobody else can read that store. You can delete it at any time. Storage charges for that store, if any, are billed to your account.

`outputMode` `changesOnly` writes only added and removed URL rows once a baseline exists. The first compare run stores the snapshot and is not charged `site-compared`. A later run that compares against that snapshot is billed one `site-compared` event per site, plus a `url-extracted` event for each row that is written.

### llms.txt checker

The Actor requests `/llms.txt` and `/llms-full.txt` and records whether each file exists. For `llms.txt` it also records the byte size and how many links it contains. The check itself is free. Turn on **Also output URLs listed in llms.txt** if those links should become URL rows (`source` `llms.txt`). Those rows are billed like any other URL row.

### Optional HTTP status check

When enabled, each URL gets a HEAD request. If the server answers 405 or 501, the Actor sends GET and closes the body without reading it. The row then includes `httpStatus` and `finalUrl` (up to 5 redirects). This is billed as `status-checked` per URL that returns a status code. It respects robots.txt and a low per-host concurrency.

Typical uses: SEO audits, site migrations, content monitoring, sitemap to CSV export, and building a seed list for your own crawler.

## How to use the sitemap extractor

1. Open Sitemap URL Extractor and paste one domain or sitemap URL per line.
2. Optionally set a URL cap, an include or exclude regex, or a lastmod range. Filtered URLs are not written and not billed.
3. Optionally turn on change tracking, `changesOnly`, or the HTTP status check.
4. Start the run. When it finishes, open the dataset and export CSV, JSON, or Excel.
5. For sitemap monitoring, schedule the same input every day. The next run reads the snapshot from your named key-value store.

You can start a run from the Apify API with the same input JSON, or connect the dataset to another Actor on the platform. A daily schedule is the usual way to watch for added and removed URLs.

## Input

| Field | What it does |
| --- | --- |
| Websites, sitemap URLs or robots.txt URLs | Domain, homepage, robots.txt, sitemap, or llms.txt URL. One per line. |
| Max URLs per website | Stop after this many URL rows per site. This is also a cost cap. |
| Discover sitemaps from robots.txt | Read `Sitemap:` lines. |
| Probe common sitemap paths | Try the usual sitemap paths when robots.txt lists none. |
| Check llms.txt and llms-full.txt | Free existence, size, and link-count check. |
| Also output URLs listed in llms.txt | Write those links as URL rows (billed). |
| Max sitemap files per website | Safety cap for large sitemap indexes. |
| Max sitemap index depth | How many nested index levels to follow. |
| Include URLs matching (regex) | Keep only matching URLs. |
| Exclude URLs matching (regex) | Drop matching URLs. |
| Last modified on or after / on or before | Absolute date (`2026-09-01`) or relative (`7 days`). |
| Drop URLs without lastmod when a date filter is set | Applies only when a lastmod filter is set. |
| Keep only URLs on the same host | Drop entries that point at other hosts. |
| Compare with previous run (added / removed URLs) | Turn on change tracking. |
| Snapshot store name | Named key-value store in your account. |
| Output mode | All URLs, or only added and removed URLs. |
| Check HTTP status of each URL | Billed separately as `status-checked`. |
| Max URLs to status-check per website | Cap for the status check. |
| Parallel status checks per host | Kept low so the target site is not overloaded. |
| Respect robots.txt | Skip disallowed sitemap files and status checks. |
| Request timeout (seconds) | Timeout for each robots.txt, sitemap, or llms.txt request. |

```json
{ "startUrls": ["https://docs.apify.com"], "maxUrlsPerSite": 100 }
```

## Output example

URL row:

```json
{
  "recordType": "url",
  "site": "https://docs.apify.com",
  "url": "https://docs.apify.com/platform/actors",
  "source": "sitemap",
  "sourceSitemap": "https://docs.apify.com/sitemap.xml",
  "lastmod": "2026-09-20T08:14:00.000Z",
  "changefreq": "weekly",
  "priority": 0.8,
  "sitemapKind": "standard",
  "imageCount": 0,
  "videoCount": 0,
  "hreflangCount": 0,
  "changeType": "added",
  "firstSeenAt": "2026-09-26T03:40:00.000Z",
  "httpStatus": null,
  "finalUrl": null,
  "errorCode": null,
  "errorMessage": null,
  "extractedAt": "2026-09-26T03:40:12.000Z"
}
```

Error row (not billed):

```json
{
  "recordType": "error",
  "site": "https://example.com",
  "url": null,
  "errorCode": "NO_SITEMAP_FOUND",
  "errorMessage": "robots.txt lists no Sitemap and none of the common paths returned a sitemap.",
  "extractedAt": "2026-09-26T03:40:12.000Z"
}
```

The default key-value store record `SUMMARY` has one object per site: sitemaps found, files parsed, URL counts, llms.txt status, added and removed counts, and the events charged for that site. `chargedEvents` counts events `Actor.charge` actually billed. `wouldBeChargedEvents` counts the same work when it was accepted; on a run that is not pay-per-event, `chargedEvents` stays at zero and `wouldBeChargedEvents` holds the events that would have been billed. URL rows do not have a `charged` field. If a run hits your maximum charge, the summary includes `CHARGE_LIMIT_REACHED` and the run ends successfully with the rows already written.

Dataset views:

- **URLs** — one row per URL, including removed URLs when change tracking is on.
- **Errors** — failures with `errorCode` and a fixed explanation. Response bodies are not copied into the message.

| Field | Meaning |
| --- | --- |
| recordType | `url` or `error`. |
| site | Site root derived from your input. |
| url | Public URL from a sitemap or from llms.txt. |
| source | `sitemap` or `llms.txt`. |
| sourceSitemap | Sitemap or llms file the URL came from. |
| lastmod, changefreq, priority | Copied from the sitemap when present. |
| sitemapKind | `standard`, `news`, `image`, `video`, or `text`. |
| imageCount, videoCount, hreflangCount | Counts only. No captions, titles, or names. |
| changeType | `added`, `unchanged`, `removed`, or null when change tracking is off. |
| firstSeenAt | When the URL first appeared in your snapshot. |
| httpStatus, finalUrl | Filled only when the HTTP status check is on. |
| errorCode, errorMessage | Set on error rows. The message is a fixed template. |
| extractedAt | Time the row was created. |

## How much does it cost to extract sitemap URLs?

Pricing is pay per event. You are not billed for filtered URLs, duplicate URLs, or error rows.

| Event | When it is charged | FREE | BRONZE | SILVER | GOLD |
| --- | --- | --- | --- | --- | --- |
| `url-extracted` | One URL row is written, including a `removed` row | $0.0005 | $0.0004 | $0.00035 | $0.0003 |
| `status-checked` | One URL returned an HTTP status code | $0.0004 | $0.0003 | $0.00025 | $0.0002 |
| `site-compared` | One site was compared with a stored snapshot from an earlier run | $0.002 | $0.0018 | $0.0016 | $0.0014 |
| Actor start | Platform start fee, once per run at or under 1 GB | $0.00005 | $0.00005 | $0.00005 | $0.00005 |

Per 1,000 URL rows that is $0.50 (FREE), $0.40 (BRONZE), $0.35 (SILVER), or $0.30 (GOLD). Optional status checks are $0.40 / $0.30 / $0.25 / $0.20 per 1,000 URLs. `site-compared` is $2.00 / $1.80 / $1.60 / $1.40 per 1,000 sites.

Example 1. Starter (BRONZE) plan, 10,000 URL rows, no status check and no change tracking: 10,000 × $0.0004 = **$4.00**, plus the $0.00005 start fee.

Example 2. The same 10,000 URLs with the HTTP status check: $4.00 + 10,000 × $0.0003 = **$7.00**, plus the start fee.

Example 3. On the free plan, $5 of usage at the FREE price is about **10,000** URL rows ($5 / $0.0005), plus a small start fee.

Set a maximum charge on the run. When that budget is reached the Actor stops writing, keeps the rows already charged, records `CHARGE_LIMIT_REACHED` on the summary, and finishes with status succeeded. The suggested minimum max charge is $0.05, enough for the start fee and a short trial.

`url-extracted` is the event to configure as the main pricing event. Do not also bill the default dataset-item event, or each URL row would be charged twice.

## FAQ

### How do I get all URLs from a sitemap?

Enter the domain, or paste the sitemap URL. Leave the filters empty and raise **Max URLs per website** if the site is larger than the default cap. Export the URLs view to CSV, Excel, or JSON.

### Can it read sitemap index files and .xml.gz sitemaps?

Yes. Index files are followed until **Max sitemap index depth** or **Max sitemap files per website**. Gzipped sitemaps are inflated in a stream and rejected if the file is over 100 MB uncompressed or the compression ratio is over 100.

### How does change tracking work, and where are snapshots stored?

The snapshot is a gzip-compressed list of URLs and the time each URL was first seen. It is stored in the named key-value store you choose, inside your Apify account. A later run with the same site and the same filters reads that snapshot. Delete the store to forget the history.

### What if a website has no sitemap?

The run still succeeds. That site gets one error row with `NO_SITEMAP_FOUND`, and the llms.txt check still runs. Use a crawler-style Actor if you need URLs that are not listed in a sitemap.

### Does it check llms.txt?

Yes, by default. The summary records whether `/llms.txt` and `/llms-full.txt` exist, plus the size and link count of `llms.txt`. Link rows are optional and billed.

### Can I export the sitemap to CSV or Excel?

Yes. Open the dataset and use the platform export. The URLs view is the one to export for a sitemap to CSV file.

### Why was a site blocked (403)?

The error code is `SITEMAP_HTTP_403`. The Actor records the status and stops for that file. It does not change IP address, pretend to be a browser, or bypass access controls.

### Can I call it from the API / schedule it daily?

Yes. Pass the same JSON input the console uses. A daily schedule plus change tracking is the sitemap monitoring setup. `changesOnly` keeps each day's dataset to added and removed URLs. The first run only saves the baseline. Each later run charges one `site-compared` event per site that is compared with that snapshot.

## Limitations

- The Actor only reads robots.txt, sitemaps, and llms.txt. It does not download page content, titles, or meta tags.
- If the sitemap is incomplete, the URL list is incomplete. lastmod is whatever the site published.
- HTTP 403 and other access blocks are reported and not bypassed.
- A single sitemap over 100 MB uncompressed, or a gzip compression ratio over 100, is rejected for that file.
- Change tracking is skipped above 500,000 URLs (`STATE_TOO_LARGE`).
- Very large snapshots use memory. The default is 512 MB. 256 MB is the minimum and is enough for a small site without change tracking.
- Requests to the same host are serialized with at least 200 ms between sitemap downloads. One site that fails does not fail the whole run.
- Private hosts and localhost are rejected. There is no proxy and no browser.

## Responsible use

Do not use this Actor to collect personal data, including personal profile URLs, names, or contact details. Output is limited to URLs and sitemap fields that sites publish for crawlers. Respect the target site's terms and robots.txt. The HTTP status check stays at a low concurrency on purpose. You are responsible for how you use the URL list.
