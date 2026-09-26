import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import { DATASET_FIELDS } from '../src/types.js';
import { runInput } from './runActor.js';
import { robots, startServer, urlset, type Handler } from './server.js';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
});

async function serve(handler: Handler): Promise<string> {
    const started = await startServer(handler);
    closers.push(started.close);
    return started.base;
}

describe('sitemap extractor acceptance', () => {
    it('A1-02 reports NO_SITEMAP_FOUND and does not charge', async () => {
        const base = await serve((_req, res) => {
            res.writeHead(404);
            res.end('missing');
        });
        const result = await runInput({ startUrls: [base], checkLlmsTxt: true, maxUrlsPerSite: 100 });
        const errors = result.items.filter((item) => item.recordType === 'error');
        expect(errors.map((item) => item.errorCode)).toContain('NO_SITEMAP_FOUND');
        expect(result.items.filter((item) => item.recordType === 'url')).toHaveLength(0);
        expect(result.summary[0]?.llmsTxtFound).toBe(false);
        expect(result.charges['url-extracted'] ?? 0).toBe(0);
        expect(result.message).toContain('NO_SITEMAP_FOUND');
    });

    it('A1-03 reads a gzip sitemap and keeps lastmod fields', async () => {
        const urls = Array.from({ length: 1000 }, (_, index) => ({
            loc: `https://fixture.test/p/${index}`,
            lastmod: '2026-09-20',
            changefreq: 'weekly',
            priority: '0.8',
        }));
        const gz = gzipSync(Buffer.from(urlset(urls)));
        const base = await serve((req, res) => {
            if (req.url === '/sitemap.xml.gz') {
                res.setHeader('content-type', 'application/gzip');
                res.end(gz);
                return;
            }
            res.writeHead(404);
            res.end();
        });
        const result = await runInput({
            startUrls: [`${base}/sitemap.xml.gz`],
            maxUrlsPerSite: 5000,
            checkLlmsTxt: false,
            discoverFromRobotsTxt: false,
            probeCommonPaths: false,
            respectRobotsTxt: false,
        });
        const rows = result.items.filter((item) => item.recordType === 'url');
        expect(rows).toHaveLength(1000);
        expect(rows[0]).toMatchObject({ lastmod: '2026-09-20', changefreq: 'weekly', priority: 0.8, sitemapKind: 'standard' });
        expect(result.charges['url-extracted']).toBe(1000);
    });

    it('A1-04 stops after maxSitemapFiles and stays under 1 GB', async () => {
        const base = await serve((req, res, origin) => {
            if (req.url === '/sitemap.xml') {
                const children = Array.from({ length: 600 }, (_, index) => `<sitemap><loc>${origin}/s/${index}.xml</loc></sitemap>`).join('');
                res.end(`<?xml version="1.0"?><sitemapindex>${children}</sitemapindex>`);
                return;
            }
            const match = /^\/s\/(\d+)\.xml$/.exec(req.url ?? '');
            if (!match) {
                res.writeHead(404);
                res.end();
                return;
            }
            const id = match[1];
            const body = ['<?xml version="1.0"?><urlset>'];
            for (let i = 0; i < 1000; i += 1) body.push(`<url><loc>${origin}/p/${id}/${i}</loc></url>`);
            body.push('</urlset>');
            res.end(body.join(''));
        });
        const before = process.memoryUsage().heapUsed;
        const result = await runInput({
            startUrls: [`${base}/sitemap.xml`],
            maxSitemapFiles: 500,
            maxUrlsPerSite: 1_000_000,
            checkLlmsTxt: false,
            respectRobotsTxt: false,
            discoverFromRobotsTxt: false,
            probeCommonPaths: false,
        }, undefined, false, false);
        expect(result.summary[0]?.sitemapFilesParsed).toBe(500);
        expect(result.summary[0]?.truncated).toBe(true);
        expect(result.summary[0]?.urlsTotal).toBe(499_000);
        expect(process.memoryUsage().heapUsed - before).toBeLessThan(1024 * 1024 * 1024);
        expect(result.charges['url-extracted']).toBe(499_000);
    }, 180_000);

    it('A1-05 times out one child sitemap and keeps the others', async () => {
        let slowHits = 0;
        const base = await serve(async (req, res, origin) => {
            if (req.url === '/robots.txt') {
                res.end(robots(`${origin}/sitemap.xml`));
                return;
            }
            if (req.url === '/sitemap.xml') {
                res.end(`<?xml version="1.0"?><sitemapindex><sitemap><loc>${origin}/slow.xml</loc></sitemap><sitemap><loc>${origin}/ok.xml</loc></sitemap></sitemapindex>`);
                return;
            }
            if (req.url === '/slow.xml') {
                slowHits += 1;
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, 60_000);
                    req.on('close', () => {
                        clearTimeout(timer);
                        resolve();
                    });
                });
                if (!res.writableEnded) res.end(urlset([{ loc: `${origin}/slow` }]));
                return;
            }
            if (req.url === '/ok.xml') {
                res.end(urlset([{ loc: `${origin}/ok` }]));
                return;
            }
            res.writeHead(404);
            res.end();
        });
        const result = await runInput({
            startUrls: [base],
            requestTimeoutSecs: 5,
            checkLlmsTxt: false,
            probeCommonPaths: false,
            maxUrlsPerSite: 100,
        });
        expect(result.summary[0]?.failedSitemapFiles).toBe(1);
        expect(result.items.some((item) => item.errorCode === 'TIMEOUT')).toBe(true);
        expect(result.items.some((item) => item.url === `${base}/ok`)).toBe(true);
        expect(slowHits).toBe(3);
        expect(result.message).not.toContain('failed (TIMEOUT)');
    }, 40_000);

    it('A1-06 records 403 and 404 without extra retries', async () => {
        const hits = { forbidden: 0, missing: 0 };
        const forbidden = await serve((req, res, origin) => {
            if (req.url === '/robots.txt') {
                res.end(robots(`${origin}/sitemap.xml`));
                return;
            }
            if (req.url === '/sitemap.xml') {
                hits.forbidden += 1;
                res.writeHead(403);
                res.end('no');
                return;
            }
            res.writeHead(404);
            res.end();
        });
        const missing = await serve((req, res, origin) => {
            if (req.url === '/robots.txt') {
                res.end(robots(`${origin}/sitemap.xml`));
                return;
            }
            if (req.url === '/sitemap.xml') {
                hits.missing += 1;
                res.writeHead(404);
                res.end('no');
                return;
            }
            res.writeHead(404);
            res.end();
        });
        const result = await runInput({
            startUrls: [forbidden, missing],
            checkLlmsTxt: false,
            probeCommonPaths: false,
        });
        const codes = result.items.map((item) => item.errorCode);
        expect(codes).toContain('SITEMAP_HTTP_403');
        expect(codes).toContain('SITEMAP_HTTP_404');
        expect(result.items.filter((item) => item.recordType === 'url')).toHaveLength(0);
        expect(result.charges['url-extracted'] ?? 0).toBe(0);
        expect(hits.forbidden).toBe(1);
        expect(hits.missing).toBe(1);
    });

    it('A1-07 waits for Retry-After and then succeeds', async () => {
        let hits = 0;
        const logs: string[] = [];
        const original = console.info;
        console.info = (...args: unknown[]) => {
            logs.push(args.map(String).join(' '));
            original(...args);
        };
        try {
            const base = await serve((req, res, origin) => {
                if (req.url === '/sitemap.xml') {
                    hits += 1;
                    if (hits === 1) {
                        res.writeHead(429, { 'retry-after': '2' });
                        res.end('later');
                        return;
                    }
                    res.end(urlset([{ loc: `${origin}/only` }]));
                    return;
                }
                res.writeHead(404);
                res.end();
            });
            const started = Date.now();
            const result = await runInput({
                startUrls: [`${base}/sitemap.xml`],
                checkLlmsTxt: false,
                respectRobotsTxt: false,
                discoverFromRobotsTxt: false,
                probeCommonPaths: false,
            });
            expect(Date.now() - started).toBeGreaterThanOrEqual(1800);
            expect(result.items.some((item) => item.url === `${base}/only`)).toBe(true);
            expect(logs.join('\n')).toMatch(/waiting 2s/);
            expect(hits).toBe(2);
        } finally {
            console.info = original;
        }
    }, 20_000);

    it('A1-08 rejects a gzip bomb and keeps rows parsed before bad XML', async () => {
        const bomb = gzipSync(Buffer.alloc(2_000_000, 0));
        const bombBase = await serve((req, res) => {
            if (req.url === '/sitemap.xml.gz') {
                res.end(bomb);
                return;
            }
            res.writeHead(404);
            res.end();
        });
        const heapBefore = process.memoryUsage().heapUsed;
        const bombRun = await runInput({
            startUrls: [`${bombBase}/sitemap.xml.gz`],
            checkLlmsTxt: false,
            respectRobotsTxt: false,
            discoverFromRobotsTxt: false,
            probeCommonPaths: false,
        });
        expect(bombRun.items.some((item) => item.errorCode === 'SITEMAP_TOO_LARGE')).toBe(true);
        expect(bombRun.items.filter((item) => item.recordType === 'url')).toHaveLength(0);
        expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(1024 * 1024 * 1024);

        const broken = `<?xml version="1.0"?><urlset><url><loc>https://fixture.test/a</loc></url><url><loc>https://fixture.test/b</loc></url><url><loc>https://fixture.test/c`;
        const brokenBase = await serve((req, res) => {
            if (req.url === '/sitemap.xml') {
                res.end(broken);
                return;
            }
            res.writeHead(404);
            res.end();
        });
        const brokenRun = await runInput({
            startUrls: [`${brokenBase}/sitemap.xml`],
            checkLlmsTxt: false,
            respectRobotsTxt: false,
            discoverFromRobotsTxt: false,
            probeCommonPaths: false,
        });
        const urls = brokenRun.items.filter((item) => item.recordType === 'url').map((item) => item.url);
        expect(urls).toEqual(['https://fixture.test/a', 'https://fixture.test/b']);
        expect(brokenRun.items.some((item) => item.errorCode === 'SITEMAP_PARSE_ERROR')).toBe(true);
        expect(brokenRun.summary[0]?.partial).toBe(true);
        expect(brokenRun.charges['url-extracted']).toBe(2);
    });

    it('A1-09 charges only deduped URLs that pass the exclude filter', async () => {
        const urls = [
            ...Array.from({ length: 1000 }, (_, index) => ({ loc: `https://fixture.test/keep/${index}` })),
            ...Array.from({ length: 200 }, (_, index) => ({ loc: `https://fixture.test/drop/${index}` })),
            ...Array.from({ length: 34 }, (_, index) => ({ loc: `https://fixture.test/keep/${index}` })),
        ];
        const base = await serve((req, res) => {
            if (req.url === '/sitemap.xml') {
                res.end(urlset(urls));
                return;
            }
            res.writeHead(404);
            res.end();
        });
        const result = await runInput({
            startUrls: [`${base}/sitemap.xml`],
            excludeUrlRegex: '/drop/',
            maxUrlsPerSite: 5000,
            checkLlmsTxt: false,
            respectRobotsTxt: false,
            discoverFromRobotsTxt: false,
            probeCommonPaths: false,
        });
        expect(result.items.filter((item) => item.recordType === 'url')).toHaveLength(1000);
        expect(result.charges['url-extracted']).toBe(1000);
        expect(result.charges['status-checked'] ?? 0).toBe(0);
    });

    it('A1-12 drops personal-data extension fields', async () => {
        const extra = [
            '<image:image><image:loc>https://fixture.test/a.jpg</image:loc><image:caption>Jane Doe jane@example.com</image:caption><image:title>Jane Doe</image:title></image:image>',
            '<video:video><video:thumbnail_loc>https://fixture.test/t.jpg</video:thumbnail_loc><video:title>Secret Title</video:title><video:description>call +1 415 555 0199</video:description><video:uploader>video-uploader-name</video:uploader></video:video>',
            '<news:news><news:title>Jane Doe story</news:title><news:keywords>jane@example.com</news:keywords></news:news>',
            '<xhtml:link rel="alternate" hreflang="de" href="https://fixture.test/de"/>',
            '<xhtml:link rel="alternate" hreflang="fr" href="https://fixture.test/fr"/>',
        ].join('');
        const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>https://fixture.test/a</loc>${extra}</url></urlset>`;
        const base = await serve((req, res) => {
            res.setHeader('set-cookie', 'session=SUPERSECRETCOOKIE');
            if (req.url === '/sitemap.xml') {
                res.end(xml);
                return;
            }
            res.writeHead(404);
            res.end();
        });
        const result = await runInput({
            startUrls: [`${base}/sitemap.xml`],
            checkLlmsTxt: false,
            respectRobotsTxt: false,
            discoverFromRobotsTxt: false,
            probeCommonPaths: false,
        });
        const blob = JSON.stringify({ items: result.items, summary: result.summary });
        for (const secret of ['Jane Doe', 'jane@example.com', 'video-uploader-name', 'Secret Title', '415 555 0199', 'SUPERSECRETCOOKIE']) {
            expect(blob).not.toContain(secret);
        }
        const row = result.items.find((item) => item.recordType === 'url');
        expect(row).toMatchObject({ sitemapKind: 'news', imageCount: 1, videoCount: 1, hreflangCount: 2 });
        expect(Object.keys(row ?? {}).sort()).toEqual([...DATASET_FIELDS].sort());
    });

    it('A1-13 does not log response bodies or cookies', async () => {
        const logs: string[] = [];
        const wrap = (original: (...args: unknown[]) => void) => (...args: unknown[]) => {
            logs.push(args.map(String).join(' '));
            original(...args);
        };
        const originals = {
            log: console.log,
            info: console.info,
            warn: console.warn,
            error: console.error,
            debug: console.debug,
        };
        console.log = wrap(originals.log);
        console.info = wrap(originals.info);
        console.warn = wrap(originals.warn);
        console.error = wrap(originals.error);
        console.debug = wrap(originals.debug);
        try {
            const base = await serve((req, res) => {
                res.setHeader('set-cookie', 'session=SUPERSECRETCOOKIE');
                if (req.url === '/sitemap.xml') {
                    res.end(`${urlset([{ loc: 'https://fixture.test/a' }])}<!-- FIXTURE_SECRET_BODY_MARKER -->`);
                    return;
                }
                res.writeHead(404);
                res.end('FIXTURE_SECRET_BODY_MARKER');
            });
            await runInput({
                startUrls: [`${base}/sitemap.xml`],
                checkLlmsTxt: false,
                respectRobotsTxt: false,
                discoverFromRobotsTxt: false,
                probeCommonPaths: false,
            });
            const text = logs.join('\n');
            expect(text).not.toContain('SUPERSECRETCOOKIE');
            expect(text).not.toContain('Set-Cookie');
            expect(text).not.toContain('FIXTURE_SECRET_BODY_MARKER');
        } finally {
            console.log = originals.log;
            console.info = originals.info;
            console.warn = originals.warn;
            console.error = originals.error;
            console.debug = originals.debug;
        }
    });

    it('follows robots.txt discovery and counts llms.txt without billing the check', async () => {
        const base = await serve((req, res, origin) => {
            if (req.url === '/robots.txt') {
                res.end(robots(`${origin}/sitemap.xml`));
                return;
            }
            if (req.url === '/sitemap.xml') {
                res.end(`<?xml version="1.0"?><sitemapindex><sitemap><loc>${origin}/child.xml</loc></sitemap></sitemapindex>`);
                return;
            }
            if (req.url === '/child.xml') {
                res.end(urlset([{ loc: `${origin}/docs/a` }]));
                return;
            }
            if (req.url === '/llms.txt') {
                res.end(`# guide\n[Docs](${origin}/docs/a)\n`);
                return;
            }
            res.writeHead(404);
            res.end();
        });
        const result = await runInput({ startUrls: [base], maxUrlsPerSite: 50, includeLlmsTxtUrls: false });
        expect(result.summary[0]?.robotsTxtFound).toBe(true);
        expect(result.summary[0]?.sitemapFilesParsed).toBeGreaterThanOrEqual(1);
        expect(result.summary[0]?.llmsTxtFound).toBe(true);
        expect(result.summary[0]?.llmsTxtLinkCount).toBe(1);
        expect(result.items.filter((item) => item.recordType === 'url')).toHaveLength(1);
    });

    it('blocks a sitemap disallowed by robots.txt', async () => {
        const base = await serve((req, res, origin) => {
            if (req.url === '/robots.txt') {
                res.end(`User-agent: *\nDisallow: /sitemap.xml\nSitemap: ${origin}/sitemap.xml\n`);
                return;
            }
            res.writeHead(500);
            res.end('should not fetch');
        });
        const result = await runInput({ startUrls: [base], checkLlmsTxt: false, probeCommonPaths: false });
        expect(result.items.some((item) => item.errorCode === 'BLOCKED_BY_ROBOTS')).toBe(true);
        expect(result.charges['url-extracted'] ?? 0).toBe(0);
    });

    it('fails the run on an invalid exclude regex', async () => {
        await expect(runInput({
            startUrls: ['https://example.com'],
            excludeUrlRegex: '(',
            checkLlmsTxt: false,
        })).rejects.toThrow(/regular expression/i);
    });

    it('rejects a private host unless the test override is set', async () => {
        const previous = process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS;
        process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = '0';
        try {
            const result = await runInput({ startUrls: ['http://127.0.0.1/sitemap.xml'], checkLlmsTxt: false });
            expect(result.items.some((item) => item.errorCode === 'PRIVATE_HOST')).toBe(true);
        } finally {
            process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = previous;
        }
    });
});
