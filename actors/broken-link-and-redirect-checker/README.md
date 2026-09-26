**Broken Link Checker** finds broken links on your website and checks lists of URLs in bulk. In crawl mode, give it a start URL: it scans pages on the same host, checks every link it finds — internal and, if you want, external — and tells you the **source page**, the **anchor text**, the **status code** and a **specific reason** for each failure (404, 5xx, DNS error, timeout, TLS error, redirect loop, blocked by robots.txt). In list mode, paste URLs or load them from a dataset, such as the output of a sitemap URL extractor, and get status code, final URL, full redirect chain and response time for each one. It uses plain HTTP requests (HEAD with GET fallback), no browser and no proxy, stays polite with per-host rate limits, and never bills links it could not verify.

## What does Broken Link Checker do?

This broken link checker is a dead link checker for SEO audits, site migrations, and QA. It does not render JavaScript and it does not download page text into the dataset.

- Crawl a website and check every internal link, plus outbound links when you leave that option on.
- Check a list of URLs in bulk and record the redirect chain.
- Point at a dataset from another Actor, including a sitemap extract, and scan those URLs.
- Sort results into ok, redirect, broken, restricted, unverified, and skipped. Unverified and skipped rows are not charged.
- Export a fix list with the source page and anchor text, plus a CSV of links that need attention.

## How to find broken links on a website

Use crawl mode when you want to find broken links on a website, including a broken internal link checker pass and an outbound link checker pass.

1. Open the Actor and leave **Mode** on `crawl`.
2. Enter one or more **Start URLs**. `www` and non-`www` are the same site. Turn on **Treat subdomains as internal** only when you want subdomains included.
3. Set **Max pages to crawl** and **Max crawl depth**. Pages outside those limits are still checked as links, but their HTML is not parsed.
4. Leave **Check external links** on to check outbound links. External pages are never crawled.
5. Start the run. Download the dataset (links and pages) and the key-value record `BROKEN_LINKS.csv`.

The same flow works from the Apify API and from a Schedule. A weekly schedule plus **Output rows** `brokenOnly` keeps the dataset to broken links. You can integrate the dataset with any Apify integration that reads a default dataset.

## How to check a list of URLs in bulk

List mode is a bulk url status checker, a 404 checker, and a redirect chain checker. It does not read page HTML.

1. Set **Mode** to `list`.
2. Paste URLs into **URLs to check**, or set **Load URLs from a dataset** to a dataset id (for example the default dataset of a finished sitemap run).
3. Start the run. Each row has the first status code, the final status code, the final URL, the redirect chain, the response time, and the method (`HEAD` or `GET`).

`mailto:` and `tel:` links are counted in crawl mode and are not requested. Their targets are never stored.

## Use it after Sitemap URL Extractor

Run Sitemap URL Extractor first, then pass its default dataset id to **Load URLs from a dataset**.

- List mode checks each sitemap URL and returns status and redirect chain. That is the bulk http status check.
- Crawl mode with **Max crawl depth** `0` opens each of those pages (up to **Max pages to crawl**) and checks the links on them. That is how you check every page in a sitemap without following the whole site.

Rows that are not URL rows are ignored and counted in the summary as `datasetRowsIgnored`.

## Input

| Field | What it does |
|---|---|
| Mode | `crawl` scans pages on the same host. `list` checks URLs directly. |
| Start URLs (crawl mode) | Pages to start from. Prefill is a short, cheap run. |
| URLs to check (list mode) | One URL per item. |
| Load URLs from a dataset (optional) | Dataset id to read. The picker grants read access to that dataset. |
| URL field in the dataset | Dot path of the URL string. Default `url`. |
| Max rows to read from the dataset | Cap on rows read from that dataset. |
| Max pages to crawl | How many HTML pages to parse. Default 100. Prefill 5. |
| Max crawl depth | Link hops from a start URL. `0` means only the start pages. |
| Treat subdomains as internal | When off, other subdomains are external. |
| Check external links | When off, external links are counted as not checked. |
| Also check images, scripts, stylesheets and iframes | Off by default. Anchor text for those elements is empty. |
| Only crawl and check URLs matching (regex) | Optional include filter. |
| Skip URLs matching (regex) | Optional exclude filter. |
| Max links to check | Unique http(s) links that may be requested. Default 10,000. Prefill 100. |
| Output rows | `all`, `problemsOnly` (hide ok), or `brokenOnly`. Billing does not change. |
| Max source pages listed per link | How many source pages are stored per link and in the CSV. |
| Parallel requests per host | Default 2, maximum 5. |
| Parallel requests in total | Default 20, maximum 50. |
| Minimum delay between requests to the same host (ms) | Default 250. A longer robots.txt crawl-delay wins, capped at 10 seconds. |
| Respect robots.txt | Default on. Disallowed URLs are not requested. |
| Use HEAD requests first | Default on. A 4xx or a network error other than DNS-not-found or connection-refused is retried once with GET. |
| Request timeout (seconds) | Connect and response-header timeout. |
| Max redirects to follow | Default 10. |

```json
{
  "mode": "crawl",
  "startUrls": ["https://docs.apify.com/academy"],
  "maxPages": 5,
  "maxLinks": 100
}
```

There is no API key and no proxy field. The Actor does not send a custom user agent.

## Output example

Link row (crawl mode):

```json
{
  "recordType": "link",
  "site": "https://docs.apify.com",
  "linkUrl": "https://docs.apify.com/academy/missing",
  "linkType": "internal",
  "element": "a",
  "checkStatus": "broken",
  "statusCode": 404,
  "finalStatusCode": 404,
  "finalUrl": "https://docs.apify.com/academy/missing",
  "redirectCount": 0,
  "redirectChain": null,
  "responseTimeMs": 180,
  "method": "GET",
  "errorCode": "HTTP_404_NOT_FOUND",
  "errorDetail": "404",
  "errorMessage": "Server answered 404 Not Found",
  "sourcePage": "https://docs.apify.com/academy",
  "anchorText": "Missing lesson",
  "sourceCount": 2,
  "sources": [{ "pageUrl": "https://docs.apify.com/academy", "anchorText": "Missing lesson", "element": "a" }],
  "charged": true,
  "checkedAt": "2026-09-26T06:12:08Z"
}
```

Page rows (`recordType` `page`) record depth, how many links were found, and whether HTML was truncated at 2 MB. They are not charged. Error rows (`recordType` `error`) are free and cover bad input, a start URL that could not be opened, a bad regex, or a dataset that could not be read.

`BROKEN_LINKS.csv` has one line per source page and non-ok link (broken, restricted, unverified, skipped): `source_page`, `anchor_text`, `link_url`, `link_type`, `check_status`, `status_code`, `error_code`, `final_url`. A cell that starts with `=`, `+`, `-`, or `@` is prefixed with a quote. The file stops at 200,000 rows or 50 MB (`csvTruncated` on the summary).

The key-value record `SUMMARY` has per-site counts: pages crawled, status totals, error codes, not-checked reasons, `mailto` / `tel` counts, and `chargedEvents`.

Dataset views:

- **Checked links** — one row per unique link, plus page and error rows. In crawl mode, problem links are written first.
- **Fix list** — source page, anchor text, link URL, status, and failure reason.
- **Broken links report (CSV)** — the `BROKEN_LINKS.csv` record.
- **Summary** — the `SUMMARY` record.

Anchor text is collapsed and cut at 100 characters (an ellipsis makes it at most 101). A link whose only content is an image is stored as `[image]`. Email-like and phone-like text is replaced with `[redacted]`. Query values that look like an email or a long phone number are replaced in the URL.

## What each status and error code means

| Status | Meaning | Charged as link-checked? |
|---|---|---|
| ok | Final response is 2xx and there was no redirect. | Yes |
| redirect | One or more redirects and a final 2xx. | Yes |
| broken | A definite failure: 404, 410, other 4xx, 5xx after one retry, DNS not found, connection refused, timeout, TLS error, redirect loop, too many redirects, or an invalid redirect. | Yes |
| restricted | 401, 403, 407, or 451. The server refused the request. This is not a dead link. | Yes |
| unverified | No conclusion: 429 after one retry, bot protection, robots.txt 5xx, temporary DNS failure, connection reset, a redirect to a non-http URL, or a non-standard status. | No |
| skipped | Not requested: blocked by robots.txt, private or link-local host, or an invalid URL. | No |

Common `errorCode` values: `HTTP_404_NOT_FOUND`, `HTTP_410_GONE`, `HTTP_4XX`, `HTTP_401_UNAUTHORIZED`, `HTTP_403_FORBIDDEN`, `HTTP_407_PROXY_AUTH`, `HTTP_451_LEGAL`, `HTTP_5XX`, `RATE_LIMITED`, `BOT_PROTECTION`, `DNS_NOT_FOUND`, `DNS_TEMPORARY_FAILURE`, `CONNECTION_REFUSED`, `CONNECTION_RESET`, `TIMEOUT`, `TLS_ERROR`, `REDIRECT_LOOP`, `TOO_MANY_REDIRECTS`, `INVALID_REDIRECT`, `UNSUPPORTED_REDIRECT_SCHEME`, `UNEXPECTED_STATUS`, `BLOCKED_BY_ROBOTS`, `ROBOTS_UNREACHABLE`, `PRIVATE_HOST`, `INVALID_URL`.

`errorMessage` is a fixed sentence. The response body is never copied into it. `TIMEOUT` uses `errorDetail` `connect` or `headers`.

Not checked, and not stored as link rows: `EXTERNAL_NOT_CHECKED`, `EXCLUDED_BY_FILTER`, `NOT_CHECKED_LIMIT`, `CHARGE_LIMIT_REACHED`, `TIME_LIMIT_REACHED`, plus `mailto`, `tel`, `javascript`, and other non-http schemes, and fragment-only links. The summary identity is: unique links = checked + skipped rows + those not-checked counts.

A run with bad input still finishes successfully and writes an error row (`MODE_INPUT_MISMATCH`, `NO_VALID_INPUT`, `INVALID_REGEX`, `DATASET_NOT_ACCESSIBLE`, `DATASET_FIELD_MISSING`, `INVALID_INPUT_URL`). A start page that cannot be opened is `START_URL_FAILED` and is not charged. Other sites in the same run continue.

## How much does it cost to check broken links?

`link-checked` — $0.60 per 1,000 links (FREE), $0.50 (BRONZE), $0.45 (SILVER), $0.40 (GOLD); crawl mode also `page-crawled` — $1.00 / $0.90 / $0.80 / $0.70 per 1,000 pages; links that could not be verified (rate limits, bot protection, robots.txt) and pages that fail to load are free; plus the default Actor start fee.

| Event | When it is charged | FREE | BRONZE | SILVER | GOLD |
|---|---|---|---|---|---|
| link-checked (primary) | A unique link ends as ok, redirect, broken, or restricted. The same URL is charged once per run. | $0.0006 | $0.0005 | $0.00045 | $0.0004 |
| page-crawled | Crawl mode parsed a 2xx HTML page. | $0.001 | $0.0009 | $0.0008 | $0.0007 |
| Actor start | Platform default, once per run at or below 1 GB. | $0.00005 | $0.00005 | $0.00005 | $0.00005 |

A small site of 200 pages and 1,500 unique links is about **$0.93** on BRONZE (1,500 × $0.0005 + 200 × $0.0009). A bulk list of 10,000 URLs is **$5.00** on BRONZE (10,000 × $0.0005) plus the start fee. On the free plan, about $5 of usage covers that 10,000 URL list at the FREE link price, or a smaller crawl once page charges are included.

These are not charged:

- unverified links (429, bot protection, robots.txt server error, temporary DNS, connection reset)
- skipped links (robots.txt disallow, private host, invalid URL)
- pages that are not 2xx HTML (a PDF can still be a charged link check)
- a crawl start URL that could not be opened
- duplicate input URLs
- links that were filtered, skipped because external checks are off, or left unchecked because of the link cap, the charge cap, or the time limit
- `mailto:`, `tel:`, and other non-http links

**Output rows** only chooses which link rows are written. Links that were checked are still charged. Set a maximum charge in the run options. The run stops before a new check would pass that limit, keeps the rows already written, sets `stopReason` to `CHARGE_LIMIT_REACHED`, and finishes successfully. The suggested minimum charge limit is $0.10.

Above about 100,000 links, use at least 1 GB of memory. Above about 400,000 links, use 2 GB. The default is 512 MB.

## Politeness and robots.txt

The Actor sends a fixed user agent that identifies `BrokenLinkAndRedirectChecker`. It does not pretend to be a browser.

Each host has its own concurrency cap and a minimum gap between request starts. robots.txt is fetched once per origin and matched for this Actor's token and for `*`, following RFC 9309. A 4xx robots.txt allows every URL. A 5xx robots.txt blocks the origin and those links are unverified, not charged. `Crawl-delay` is honored when it is longer than your minimum delay, and it is capped at 10 seconds (`crawlDelayCapped` on the summary).

A page with `nofollow` in meta robots or `X-Robots-Tag` still has its links checked. Those links are not added to the crawl queue.

After HTTP 429, or 503 with `Retry-After`, the Actor waits at most 30 seconds, retries once, and then keeps that host at one request at a time. Timeouts, connection resets, and 5xx responses are retried once. There is no proxy and no retry from another address.

HTML is read only for pages that are actually crawled, and only the first 2 MB.

## FAQ

### Why is a link marked restricted (403) when it works in my browser?

`restricted` means the server answered 401, 403, 407, or 451 to this Actor's HTTP request. Browsers send cookies and a different user agent. The Actor does not reuse your cookies and does not try to look like a browser. A 403 is not reported as a broken link. It is still a completed check, so it is charged once.

### Why are some external links unverified?

The server rate-limited the request, returned a bot challenge or status 999, reset the connection, or the DNS failure looked temporary. Those rows are unverified and are not charged. LinkedIn and similar sites often answer 999 to automated HTTP clients. That is expected.

### Does it store emails or phone numbers?

No. `mailto:` and `tel:` links are counted only. The address is not written to the dataset, the CSV, the summary, or the log. Anchor text that looks like an email or a phone number is replaced with `[redacted]`. The same replacement is applied to query values. Usernames and passwords in URLs are removed.

### Can I run it weekly and get only broken links?

Yes. Create a Schedule and set **Output rows** to `brokenOnly`. The summary still counts every status. Integrations can read the default dataset after each run.

### How do I check every page in my sitemap?

Run a sitemap extractor, then this Actor in crawl mode with **Max crawl depth** `0` and the sitemap dataset selected. Each sitemap URL is opened and the links on that page are checked, up to **Max pages to crawl**.

### Do I need a proxy or a custom user agent?

No. The Actor does not use a proxy and does not offer a custom user agent. It will not bypass bot protection.

### Why was a link not checked?

The summary lists a reason: max links, external checks off, a URL filter, the charge limit, or the time limit. Nothing is dropped without a count.

## Limitations

- JavaScript is not executed. Links that exist only after a script runs are not found.
- Soft 404 pages that answer 200 are reported as ok. The Actor does not read the page text to guess otherwise.
- `#fragment` links are counted and not requested.
- Login-only pages are not supported.
- There is no proxy, no proxy rotation, and no custom user agent.
- Bot-protected sites are unverified. The Actor does not try to unblock them.
- Results are the HTTP response at the time of the run, not a guarantee that a link stays valid. This is not a 100% accurate prediction of what a browser will do.
- Very large HTML pages are parsed only up to 2 MB.

## Responsible use

The Actor sends small HTTP requests to public URLs, respects robots.txt, and does not collect personal data. `mailto:` and `tel:` links are only counted. Do not point it at networks or hosts you are not allowed to request. Private, loopback, and link-local addresses are skipped so the run cannot be used to reach internal infrastructure.
