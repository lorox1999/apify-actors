import { Actor, Configuration } from 'apify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATASET_FIELDS, type ActorInput } from '../src/types.js';
import { startFixture, type Fixture } from './fixtures/a3b-server.js';
import { clearLogs, logLines, runInput, storageText, useStorage } from './runActor.js';
import { execute as extractSitemap } from '../../sitemap-url-diff-extractor/src/execute.js';

function fast(input: ActorInput): ActorInput {
    return {
        minDelayPerHostMs: 0,
        maxConcurrency: 20,
        maxConcurrencyPerHost: 5,
        requestTimeoutSecs: 5,
        ...input,
    };
}

function rows(items: Record<string, unknown>[], type: string): Record<string, unknown>[] {
    return items.filter((item) => item.recordType === type);
}

interface SiteSummary {
    site: string;
    robotsTxtFound: boolean;
    crawlDelayMs: number;
    crawlDelayCapped: boolean;
    pagesCrawled: number;
    pagesFailed: number;
    uniqueLinks: number;
    linksChecked: number;
    byStatus: Record<string, number>;
    byErrorCode: Record<string, number>;
    notChecked: Record<string, number>;
    schemes: { mailto: number; tel: number; javascript: number; other: number };
    fragmentOnlyLinks: number;
}

function sitesOf(summary: Record<string, unknown>): SiteSummary[] {
    return (summary.sites as SiteSummary[]) ?? [];
}

function oneSite(summary: Record<string, unknown>): SiteSummary {
    const sites = sitesOf(summary);
    expect(sites.length).toBeGreaterThan(0);
    return sites[0] as SiteSummary;
}

function byUrl(items: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
    return new Map(items.map((item) => [String(item.linkUrl), item]));
}

const PII = ['jane.doe', '555-0100', 'secret', 'Photo of', 'session-secret-cookie', 'FIXTURE_BODY_SECRET_MARKER'];

describe('broken link checker acceptance', () => {
    let fixture: Fixture;

    beforeAll(async () => {
        fixture = await startFixture();
    });

    afterAll(async () => {
        await fixture.close();
    });

    it('A3-01 local prefill stand-in finishes under 60s with a non-empty dataset', async () => {
        const started = Date.now();
        const result = await runInput(fast({
            mode: 'crawl',
            startUrls: [fixture.url('site.test', '/site')],
            maxPages: 5,
            maxLinks: 100,
            maxDepth: 2,
        }));
        expect(Date.now() - started).toBeLessThan(60_000);
        expect(result.items.length).toBeGreaterThan(0);
        expect(rows(result.items, 'page').length).toBeLessThanOrEqual(5);
        expect(rows(result.items, 'link').length).toBeLessThanOrEqual(100);
        expect(result.charges['page-crawled'] ?? 0).toBeLessThanOrEqual(5);
        expect(result.charges['link-checked'] ?? 0).toBeLessThanOrEqual(100);
        expect(oneSite(result.summary).robotsTxtFound).toBe(true);
        expect(result.message).toMatch(/^Done: /);
        expect(result.summary.stopReason === null || result.summary.stopReason === 'MAX_PAGES_REACHED').toBe(true);
    });

    it('A3-02 classifies list results and retries a 500 once', async () => {
        clearLogs();
        fixture.reset();
        const urls = ['/ok', '/r301', '/chain1', '/404', '/410', '/500'].map((path) => fixture.url('site.test', path));
        const result = await runInput(fast({ mode: 'list', urls }));
        const linkRows = rows(result.items, 'link');
        expect(linkRows).toHaveLength(6);
        const found = byUrl(linkRows);
        const ok = found.get(fixture.url('site.test', '/ok'));
        expect(ok?.checkStatus).toBe('ok');
        expect(ok?.statusCode).toBe(200);
        expect(ok?.finalStatusCode).toBe(200);
        expect(Number(ok?.responseTimeMs)).toBeGreaterThan(0);
        expect(ok?.charged).toBe(true);
        const redirect = found.get(fixture.url('site.test', '/r301'));
        expect(redirect?.checkStatus).toBe('redirect');
        expect(redirect?.redirectCount).toBe(1);
        expect(redirect?.finalStatusCode).toBe(200);
        const chain = found.get(fixture.url('site.test', '/chain1'));
        expect(chain?.checkStatus).toBe('redirect');
        expect(chain?.redirectCount).toBe(3);
        expect(chain?.redirectChain).toHaveLength(4);
        const missing = found.get(fixture.url('site.test', '/404'));
        expect(missing?.checkStatus).toBe('broken');
        expect(missing?.errorCode).toBe('HTTP_404_NOT_FOUND');
        expect(missing?.errorMessage).toBe('Server answered 404 Not Found');
        const gone = found.get(fixture.url('site.test', '/410'));
        expect(gone?.checkStatus).toBe('broken');
        expect(gone?.errorCode).toBe('HTTP_410_GONE');
        const server = found.get(fixture.url('site.test', '/500'));
        expect(server?.checkStatus).toBe('broken');
        expect(server?.errorCode).toBe('HTTP_5XX');
        expect(server?.method).toBe('GET');
        expect(logLines().join('\n')).toMatch(/retrying/i);
        const fiveHundred = fixture.hits.filter((hit) => hit.path === '/500');
        expect(fiveHundred.map((hit) => hit.method)).toEqual(['HEAD', 'GET']);
        expect(result.charges['link-checked']).toBe(6);
    });

    it('A3-03 falls back from HEAD to GET and can skip HEAD', async () => {
        fixture.reset();
        const first = await runInput(fast({
            mode: 'list',
            urls: [fixture.url('site.test', '/head-405'), fixture.url('site.test', '/head-404')],
        }));
        for (const row of rows(first.items, 'link')) {
            expect(row.checkStatus).toBe('ok');
            expect(row.method).toBe('GET');
        }
        fixture.reset();
        await runInput(fast({
            mode: 'list',
            useHeadRequests: false,
            urls: [fixture.url('site.test', '/head-405'), fixture.url('site.test', '/head-404')],
        }));
        expect(fixture.hits.some((hit) => hit.method === 'HEAD' && (hit.path === '/head-405' || hit.path === '/head-404'))).toBe(false);
    });

    it('A3-04 reports redirect loops, too many redirects, and a cookie hop without logging the cookie', async () => {
        clearLogs();
        fixture.reset();
        const result = await runInput(fast({
            mode: 'list',
            maxRedirects: 10,
            urls: [
                fixture.url('site.test', '/loop-a'),
                fixture.url('site.test', '/many/0'),
                fixture.url('site.test', '/cookie-redirect'),
            ],
        }));
        const found = byUrl(rows(result.items, 'link'));
        const loop = found.get(fixture.url('site.test', '/loop-a'));
        expect(loop?.errorCode).toBe('REDIRECT_LOOP');
        expect(loop?.checkStatus).toBe('broken');
        expect(loop?.charged).toBe(true);
        const many = found.get(fixture.url('site.test', '/many/0'));
        expect(many?.errorCode).toBe('TOO_MANY_REDIRECTS');
        expect(many?.redirectChain).toHaveLength(11);
        expect(many?.charged).toBe(true);
        const paths = fixture.hits.filter((hit) => hit.path.startsWith('/many/')).map((hit) => hit.path);
        expect(paths).toContain('/many/10');
        expect(paths).not.toContain('/many/11');
        const cookie = found.get(fixture.url('site.test', '/cookie-redirect'));
        expect(cookie?.checkStatus).toBe('redirect');
        expect(cookie?.finalStatusCode).toBe(200);
        expect(cookie?.errorCode).toBeNull();
        const blob = `${JSON.stringify(result.items)}\n${result.csv}\n${logLines().join('\n')}\n${await storageText(result.storageDir)}`;
        expect(blob).not.toContain('session-secret-cookie');
        expect(blob.toLowerCase()).not.toContain('set-cookie');
        expect(result.charges['link-checked']).toBe(3);
    });

    it('A3-05 classifies DNS, connection refused, timeout, and a self-signed certificate', async () => {
        fixture.reset();
        const started = Date.now();
        const result = await runInput(fast({
            mode: 'list',
            requestTimeoutSecs: 5,
            respectRobotsTxt: true,
            urls: [
                'http://no-such-host-a3b-selftest.invalid/page',
                'http://127.0.0.1:1/',
                fixture.url('site.test', '/slow'),
                fixture.httpsUrl('site.test', '/ok'),
            ],
        }), { allowPrivate: true });
        const found = byUrl(rows(result.items, 'link'));
        expect(found.get('http://no-such-host-a3b-selftest.invalid/page')?.errorCode).toBe('DNS_NOT_FOUND');
        expect(found.get('http://127.0.0.1:1/')?.errorCode).toBe('CONNECTION_REFUSED');
        const slow = found.get(fixture.url('site.test', '/slow'));
        expect(slow?.errorCode).toBe('TIMEOUT');
        expect(slow?.errorDetail).toBe('headers');
        expect(slow?.checkStatus).toBe('broken');
        expect(Date.now() - started).toBeGreaterThanOrEqual(8_000);
        const tls = found.get(fixture.httpsUrl('site.test', '/ok'));
        expect(tls?.errorCode).toBe('TLS_ERROR');
        expect(tls?.checkStatus).toBe('broken');
        expect(tls?.errorDetail).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
        expect(result.charges['link-checked']).toBe(4);
        expect(result.message).toMatch(/^Done: /);
    });

    it('A3-06 waits on Retry-After, pins the host, and does not bill unverified challenges', async () => {
        fixture.reset();
        const started = Date.now();
        const urls = ['/429-once', '/429-always', '/503-once', '/cf', '/999', '/403'].map((path) => fixture.url('site.test', path));
        const result = await runInput(fast({
            mode: 'list',
            maxConcurrencyPerHost: 4,
            urls,
        }));
        const found = byUrl(rows(result.items, 'link'));
        expect(found.get(fixture.url('site.test', '/429-once'))?.checkStatus).toBe('ok');
        expect(Date.now() - started).toBeGreaterThanOrEqual(1_800);
        expect(found.get(fixture.url('site.test', '/429-always'))?.errorCode).toBe('RATE_LIMITED');
        expect(found.get(fixture.url('site.test', '/429-always'))?.checkStatus).toBe('unverified');
        expect(found.get(fixture.url('site.test', '/429-always'))?.charged).toBe(false);
        expect(found.get(fixture.url('site.test', '/503-once'))?.checkStatus).toBe('ok');
        expect(found.get(fixture.url('site.test', '/cf'))?.errorCode).toBe('BOT_PROTECTION');
        expect(found.get(fixture.url('site.test', '/999'))?.errorCode).toBe('BOT_PROTECTION');
        expect(found.get(fixture.url('site.test', '/403'))?.errorCode).toBe('HTTP_403_FORBIDDEN');
        expect(found.get(fixture.url('site.test', '/403'))?.checkStatus).toBe('restricted');
        expect(result.charges['link-checked']).toBe(3);
        const first429 = fixture.hits.find((hit) => hit.path === '/429-once');
        expect(first429).toBeTruthy();
        const later = fixture.hits.filter((hit) => hit.host === 'site.test' && hit.at >= (first429?.at ?? 0) + 1_500 && hit.path !== '/robots.txt');
        expect(later.length).toBeGreaterThan(0);
        expect(Math.max(...later.map((hit) => hit.inflight))).toBeLessThanOrEqual(1);
    });

    it('A3-07 honors robots.txt, crawl-delay, and an unreachable robots file', async () => {
        fixture.reset();
        const blocked = await runInput(fast({
            mode: 'crawl',
            startUrls: [fixture.url('site.test', '/robots-page')],
            maxDepth: 1,
            maxPages: 5,
            checkExternalLinks: true,
            minDelayPerHostMs: 0,
        }));
        const found = byUrl(rows(blocked.items, 'link'));
        const hidden = [...found.values()].find((row) => String(row.linkUrl).includes('/private/'));
        expect(hidden?.errorCode).toBe('BLOCKED_BY_ROBOTS');
        expect(hidden?.checkStatus).toBe('skipped');
        expect(hidden?.charged).toBe(false);
        expect(fixture.hits.some((hit) => hit.path.startsWith('/private/'))).toBe(false);
        const unreachable = [...found.values()].find((row) => String(row.linkUrl).includes('robots500.test'));
        expect(unreachable?.errorCode).toBe('ROBOTS_UNREACHABLE');
        expect(unreachable?.charged).toBe(false);
        expect(fixture.hits.some((hit) => hit.host === 'robots500.test' && hit.path === '/x')).toBe(false);
        const delayed = fixture.hits
            .filter((hit) => hit.host === 'delay.test' && hit.path !== '/robots.txt')
            .sort((a, b) => a.at - b.at);
        expect(delayed.length).toBeGreaterThanOrEqual(2);
        expect(delayed[1]!.at - delayed[0]!.at).toBeGreaterThanOrEqual(1_900);
        const chargedBefore = blocked.charges['link-checked'] ?? 0;
        expect(found.get(fixture.url('delay.test', '/a'))?.charged).toBe(true);
        expect(chargedBefore).toBe(2);

        fixture.reset();
        const open = await runInput(fast({
            mode: 'crawl',
            startUrls: [fixture.url('site.test', '/robots-page')],
            maxDepth: 0,
            maxPages: 2,
            respectRobotsTxt: false,
            checkExternalLinks: false,
        }));
        expect(fixture.hits.some((hit) => hit.path.startsWith('/private/'))).toBe(true);
        const opened = byUrl(rows(open.items, 'link'));
        expect([...opened.keys()].some((url) => url.includes('/private/'))).toBe(true);
    });

    it('A3-08 stays on the same host and does not parse pages past maxDepth', async () => {
        fixture.reset();
        const result = await runInput(fast({
            mode: 'crawl',
            startUrls: [fixture.url('site.test', '/site')],
            maxDepth: 2,
            maxPages: 20,
            includeSubdomains: false,
            checkExternalLinks: true,
        }));
        const site = sitesOf(result.summary).find((item) => item.site.startsWith('http://site.test'));
        expect(site?.pagesCrawled).toBe(13);
        const linkRows = rows(result.items, 'link');
        const sub = linkRows.find((row) => String(row.linkUrl).includes('sub.site.test'));
        expect(sub?.linkType).toBe('external');
        const deep = linkRows.find((row) => String(row.linkUrl).includes('/site/d3/0'));
        expect(deep?.checkStatus).toBe('ok');
        expect(rows(result.items, 'page').some((row) => String(row.pageUrl).includes('/site/d3/'))).toBe(false);
        const externalReads = fixture.hits.filter((hit) => hit.host === 'ext.test' && hit.path !== '/robots.txt');
        expect(externalReads.length).toBeGreaterThan(0);
        expect(externalReads.every((hit) => hit.bytesWritten < 64)).toBe(true);
    });

    it('A3-09 keeps one row per link and caps listed sources', async () => {
        const result = await runInput(fast({
            mode: 'crawl',
            startUrls: [fixture.url('site.test', '/site')],
            maxDepth: 3,
            maxPages: 20,
            maxLinks: 500,
            includeSubdomains: false,
            checkExternalLinks: false,
            maxSourcesPerLink: 10,
        }));
        const broken = rows(result.items, 'link').filter((row) => String(row.linkUrl).endsWith('/404'));
        expect(broken).toHaveLength(1);
        expect(broken[0]?.sourceCount).toBe(15);
        expect(broken[0]?.sources).toHaveLength(10);
        expect(String(broken[0]?.sourcePage)).toContain('/site');
        expect(broken[0]?.anchorText).toBe('Broken 0');
        const csvLines = result.csv.split('\n').filter((line) => line.includes('/404'));
        expect(csvLines).toHaveLength(10);
        expect(result.csv.split('\n')[0]).toBe('source_page,anchor_text,link_url,link_type,check_status,status_code,error_code,final_url');
        const chargesFor404 = rows(result.items, 'link').filter((row) => String(row.linkUrl).endsWith('/404') && row.charged === true);
        expect(chargesFor404).toHaveLength(1);
    });

    it('A3-10 and A3-19 keep emails, phones, cookies, and page bodies out of output and logs', async () => {
        clearLogs();
        const result = await runInput(fast({
            mode: 'crawl',
            startUrls: [fixture.url('site.test', '/pii')],
            maxDepth: 1,
            maxPages: 10,
            checkExternalLinks: false,
        }));
        const page = rows(result.items, 'page').find((row) => String(row.pageUrl).includes('/pii'));
        expect(page?.mailtoLinks).toBe(1);
        expect(page?.telLinks).toBe(1);
        expect(page?.otherSchemeLinks).toBe(1);
        const site = oneSite(result.summary);
        expect(site.schemes.mailto).toBe(1);
        expect(site.schemes.tel).toBe(1);
        expect(site.fragmentOnlyLinks).toBe(1);
        const long = rows(result.items, 'link').find((row) => String(row.linkUrl).includes('/long'));
        expect(String(long?.anchorText).length).toBeLessThanOrEqual(101);
        expect(String(long?.anchorText).endsWith('…')).toBe(true);
        const photo = rows(result.items, 'link').find((row) => String(row.linkUrl).includes('/photo'));
        expect(photo?.anchorText).toBe('[image]');
        const query = rows(result.items, 'link').find((row) => String(row.linkUrl).includes('/q'));
        expect(String(query?.linkUrl)).toContain('[redacted-email]');
        expect(String(query?.linkUrl)).not.toContain('jane.doe');
        const hidden = rows(result.items, 'link').find((row) => String(row.linkUrl).includes('/hidden'));
        expect(String(hidden?.linkUrl)).not.toContain('secret');
        expect(String(hidden?.linkUrl)).not.toContain('user:');
        for (const item of result.items) {
            for (const key of Object.keys(item)) expect(DATASET_FIELDS).toContain(key);
        }
        const blob = `${JSON.stringify(result.items)}\n${JSON.stringify(result.summary)}\n${result.csv}\n${logLines().join('\n')}\n${await storageText(result.storageDir)}`;
        for (const needle of PII) expect(blob).not.toContain(needle);
        expect(blob.toLowerCase()).not.toContain('set-cookie');
    });

    it('A3-11 charges only conclusive checks and skips robots, private hosts, and rate limits', async () => {
        fixture.reset();
        const result = await runInput(fast({
            mode: 'crawl',
            startUrls: [fixture.url('site.test', '/bill')],
            maxDepth: 1,
            maxPages: 20,
            maxLinks: 500,
            checkExternalLinks: true,
            minDelayPerHostMs: 0,
            maxConcurrencyPerHost: 5,
        }), { allowPrivate: false });
        const linkRows = rows(result.items, 'link');
        const status = oneSite(result.summary).byStatus;
        const conclusive = status.ok + status.redirect + status.broken + status.restricted;
        expect(conclusive).toBe(100);
        expect(status.skipped).toBe(10);
        expect(status.unverified).toBe(5);
        expect(result.charges['link-checked']).toBe(100);
        expect(linkRows.filter((row) => row.charged === true)).toHaveLength(100);
        const pages = rows(result.items, 'page');
        expect(pages.length).toBe(11);
        expect(result.charges['page-crawled']).toBe(11);
        expect(pages.some((row) => String(row.pageUrl).includes('/bill/missing'))).toBe(false);
        expect(pages.some((row) => String(row.pageUrl).includes('.pdf'))).toBe(false);
        expect(linkRows.some((row) => String(row.linkUrl) === fixture.url('site.test', '/bill/p/0'))).toBe(true);
        expect(linkRows.filter((row) => String(row.linkUrl).includes('/bill/p/0'))).toHaveLength(1);
    });

    it('A3-12 filters dataset rows without changing billing or the summary', async () => {
        const result = await runInput(fast({
            mode: 'crawl',
            startUrls: [fixture.url('site.test', '/bill')],
            maxDepth: 1,
            maxPages: 20,
            maxLinks: 500,
            checkExternalLinks: true,
            outputMode: 'brokenOnly',
            minDelayPerHostMs: 0,
            maxConcurrencyPerHost: 5,
        }), { allowPrivate: false });
        const linkRows = rows(result.items, 'link');
        expect(linkRows.length).toBeGreaterThan(0);
        expect(linkRows.every((row) => row.checkStatus === 'broken')).toBe(true);
        expect(rows(result.items, 'page').length).toBe(11);
        expect(result.charges['link-checked']).toBe(100);
        expect(oneSite(result.summary).byStatus.ok).toBeGreaterThan(0);
        const chargedRows = linkRows.filter((row) => row.charged === true).length;
        expect(chargedRows + (100 - chargedRows)).toBe(100);
        expect(result.summary.chargedEvents).toEqual({ 'link-checked': 100, 'page-crawled': 11 });
    });

    it('A3-14 reads an Actor 1 dataset in list mode and scans those pages at depth 0', async () => {
        process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = '1';
        process.env.A3B_TEST_ALLOW_PRIVATE_HOSTS = '1';
        const storageDir = await useStorage();
        await extractSitemap({
            startUrls: [`http://127.0.0.1:${fixture.httpPort}/sitemap.xml`],
            maxUrlsPerSite: 200,
            checkLlmsTxt: false,
            respectRobotsTxt: false,
            discoverFromRobotsTxt: false,
            probeCommonPaths: false,
            compareWithPreviousRun: false,
            checkHttpStatus: false,
        });
        const dataset = await Actor.openDataset();
        await dataset.pushData({ recordType: 'error', errorCode: 'TEST_IGNORED', url: 'ignore-me' });
        const info = await dataset.getInfo();
        const datasetId = info?.id ?? info?.name;
        expect(datasetId).toBeTruthy();

        const listed = await runInput(fast({
            mode: 'list',
            urlsDataset: String(datasetId),
            respectRobotsTxt: false,
            minDelayPerHostMs: 0,
        }), { storageDir, allowPrivate: true });
        const freshLinks = rows(listed.items, 'link');
        expect(freshLinks.length).toBe(100);
        expect(listed.summary.datasetRowsIgnored).toBeGreaterThanOrEqual(1);
        expect(listed.charges['link-checked']).toBe(100);

        const crawled = await runInput(fast({
            mode: 'crawl',
            urlsDataset: String(datasetId),
            maxDepth: 0,
            maxPages: 20,
            maxLinks: 100,
            respectRobotsTxt: false,
            checkExternalLinks: false,
        }), { storageDir, allowPrivate: true });
        expect(rows(crawled.items, 'page')).toHaveLength(20);
        expect(crawled.summary.stopReason).toBe('MAX_PAGES_REACHED');
        expect(crawled.charges['page-crawled']).toBe(20);
        expect(rows(crawled.items, 'link').some((row) => String(row.linkUrl).includes('/ok'))).toBe(true);
    });

    it('A3-15 accounts for every discovered link when caps and filters apply', async () => {
        const result = await runInput(fast({
            mode: 'crawl',
            startUrls: [fixture.url('site.test', '/limit')],
            maxDepth: 0,
            maxPages: 1,
            maxLinks: 50,
            checkExternalLinks: false,
            excludeUrlRegex: '\\.pdf$',
        }));
        const site = oneSite(result.summary);
        const by = site.byStatus;
        const checked = by.ok + by.redirect + by.broken + by.restricted + by.unverified;
        const notSum = Object.values(site.notChecked).reduce((sum, value) => sum + value, 0);
        expect(site.uniqueLinks).toBe(checked + by.skipped + notSum);
        expect(checked).toBe(50);
        expect(site.notChecked.NOT_CHECKED_LIMIT).toBe(100);
        expect(site.notChecked.EXTERNAL_NOT_CHECKED).toBe(30);
        expect(site.notChecked.EXCLUDED_BY_FILTER).toBe(20);
        expect(result.message).toMatch(/50 not checked|150 not checked|not checked/);
        expect(result.message).toMatch(/max links/);
        expect(result.summary.stopReason).toBe('NOT_CHECKED_LIMIT');
    });

    it('A3-16 truncates a huge HTML page and does not crawl a PDF', async () => {
        let peak = 0;
        const timer = setInterval(() => {
            peak = Math.max(peak, process.memoryUsage().heapUsed);
        }, 20);
        const result = await runInput(fast({
            mode: 'crawl',
            startUrls: [fixture.url('site.test', '/both')],
            maxDepth: 1,
            maxPages: 5,
            checkExternalLinks: false,
        }));
        clearInterval(timer);
        const big = rows(result.items, 'page').find((row) => String(row.pageUrl).includes('/big.html'));
        expect(big?.truncated).toBe(true);
        const urls = rows(result.items, 'link').map((row) => String(row.linkUrl));
        expect(urls.some((url) => url.includes('/early-link'))).toBe(true);
        expect(urls.some((url) => url.includes('/late-link'))).toBe(false);
        const pdf = rows(result.items, 'link').find((row) => String(row.linkUrl).includes('/file.pdf'));
        expect(pdf?.checkStatus).toBe('ok');
        expect(rows(result.items, 'page').some((row) => String(row.pageUrl).includes('.pdf'))).toBe(false);
        expect(result.charges['page-crawled']).toBe(rows(result.items, 'page').length);
        expect(peak).toBeLessThan(512 * 1024 * 1024);
    });

    it('A3-17 keeps per-host concurrency and the start gap', async () => {
        fixture.reset();
        const urls = Array.from({ length: 100 }, (_, index) => fixture.url('site.test', `/limit/ok/${index}`));
        await runInput({
            mode: 'list',
            urls,
            maxConcurrencyPerHost: 2,
            maxConcurrency: 20,
            minDelayPerHostMs: 250,
            respectRobotsTxt: false,
            requestTimeoutSecs: 5,
        });
        const hits = fixture.hits.filter((hit) => hit.host === 'site.test' && hit.path.startsWith('/limit/ok/'));
        expect(hits.length).toBeGreaterThanOrEqual(100);
        expect(Math.max(...hits.map((hit) => hit.inflight))).toBeLessThanOrEqual(2);
        const ordered = [...hits].sort((a, b) => a.at - b.at);
        for (let index = 1; index < ordered.length; index += 1) {
            expect(ordered[index]!.at - ordered[index - 1]!.at).toBeGreaterThanOrEqual(240);
        }
    });

    it('A3-18 stops near 85% of the timeout and resumes after migration without double charging', async () => {
        const urls = [
            ...Array.from({ length: 80 }, (_, index) => fixture.url('site.test', `/limit/ok/${index}`)),
            ...Array.from({ length: 4_920 }, (_, index) => fixture.url('site.test', `/slow?n=${index}`)),
        ];
        const started = new Date();
        process.env.ACTOR_STARTED_AT = started.toISOString();
        process.env.ACTOR_TIMEOUT_AT = new Date(started.getTime() + 60_000).toISOString();
        const begun = Date.now();
        let result: Awaited<ReturnType<typeof runInput>>;
        try {
            result = await runInput(fast({
                mode: 'list',
                urls,
                minDelayPerHostMs: 0,
                maxConcurrency: 20,
                maxConcurrencyPerHost: 5,
                respectRobotsTxt: false,
                requestTimeoutSecs: 3,
                maxLinks: 10_000,
            }));
        } finally {
            delete process.env.ACTOR_STARTED_AT;
            delete process.env.ACTOR_TIMEOUT_AT;
        }
        const elapsed = Date.now() - begun;
        expect(result.summary.stopReason).toBe('TIME_LIMIT_REACHED');
        expect(elapsed).toBeGreaterThan(45_000);
        expect(elapsed).toBeLessThan(90_000);
        const billedRows = rows(result.items, 'link').filter((row) => row.charged === true).length;
        expect(result.charges['link-checked']).toBe(billedRows);
        const missed = oneSite(result.summary).notChecked.TIME_LIMIT_REACHED ?? 0;
        expect(missed).toBeGreaterThan(0);

        const migrationDir = await useStorage();
        const migrationUrls = Array.from({ length: 24 }, (_, index) => fixture.url('site.test', `/drip?n=${index}`));
        const running = runInput(fast({
            mode: 'list',
            urls: migrationUrls,
            minDelayPerHostMs: 0,
            maxConcurrency: 2,
            maxConcurrencyPerHost: 2,
            respectRobotsTxt: false,
        }), { storageDir: migrationDir, allowPrivate: true });
        await new Promise((resolve) => setTimeout(resolve, 400));
        Configuration.getGlobalConfig().getEventManager().emit('migrating');
        const paused = await running;
        expect(paused.message).toMatch(/migration/i);
        const state = await Actor.getValue('STATE');
        expect(state).toBeTruthy();
        const resumed = await runInput(fast({
            mode: 'list',
            urls: migrationUrls,
            minDelayPerHostMs: 0,
            maxConcurrency: 4,
            maxConcurrencyPerHost: 4,
            respectRobotsTxt: false,
        }), { storageDir: migrationDir, allowPrivate: true });
        const resumedLinks = rows(resumed.items, 'link');
        const ids = resumedLinks.map((row) => String(row.linkUrl));
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBeGreaterThan(0);
        expect(ids.length).toBeLessThanOrEqual(24);
        const dataset = await Actor.openDataset();
        const all = (await dataset.getData({ limit: 1_000_000 })).items as Record<string, unknown>[];
        const allLinks = all.filter((item) => item.recordType === 'link').map((item) => String(item.linkUrl));
        expect(new Set(allLinks).size).toBe(allLinks.length);
        expect(allLinks).toHaveLength(24);
    }, 180_000);

    it('rejects a mode mismatch, a bad regex, and a missing dataset without failing the run', async () => {
        const mismatch = await runInput({ mode: 'list' });
        expect(rows(mismatch.items, 'error')[0]?.errorCode).toBe('MODE_INPUT_MISMATCH');
        expect(mismatch.charges['link-checked'] ?? 0).toBe(0);
        const badRegex = await runInput(fast({
            mode: 'list',
            urls: [fixture.url('site.test', '/ok')],
            includeUrlRegex: '(',
        }));
        expect(rows(badRegex.items, 'error')[0]?.errorCode).toBe('INVALID_REGEX');
        const missing = await runInput(fast({
            mode: 'list',
            urlsDataset: 'does-not-exist-a3b',
        }));
        expect(rows(missing.items, 'error')[0]?.errorCode).toBe('DATASET_NOT_ACCESSIBLE');
    });
});
