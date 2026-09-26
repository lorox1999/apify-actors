import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { applyDiff, parseSnapshotEntries } from '../src/compare.js';
import { keepUrl, parseDateBoundary, compileFilters } from '../src/filter.js';
import type { PageRecord } from '../src/types.js';
import { extractLlmsLinks } from '../src/llms.js';
import { inflateIfNeeded, parseSitemapBuffer } from '../src/parseSitemap.js';
import { requestGapMs } from '../src/hostLock.js';
import type { ResolvedInput } from '../src/types.js';

const baseInput = {
    startUrls: ['https://example.com'],
    maxUrlsPerSite: 100,
    discoverFromRobotsTxt: true,
    probeCommonPaths: true,
    checkLlmsTxt: true,
    includeLlmsTxtUrls: false,
    maxSitemapFiles: 500,
    maxSitemapDepth: 5,
    dropUrlsWithoutLastmod: false,
    sameHostOnly: false,
    compareWithPreviousRun: false,
    stateStoreName: 'sitemap-url-diff-state',
    outputMode: 'all' as const,
    checkHttpStatus: false,
    statusCheckMaxUrls: 10,
    statusCheckConcurrencyPerHost: 2,
    respectRobotsTxt: true,
    requestTimeoutSecs: 30,
};

describe('parser and filters', () => {
    it('parses a text sitemap', async () => {
        const parsed = await parseSitemapBuffer(Buffer.from('https://example.com/a\n# comment\nhttps://example.com/b\n'));
        expect(parsed.format).toBe('text');
        expect(parsed.urls.map((url) => url.loc)).toEqual(['https://example.com/a', 'https://example.com/b']);
        expect(parsed.urls[0]?.sitemapKind).toBe('text');
    });

    it('inflates gzip by magic bytes', async () => {
        const xml = '<urlset><url><loc>https://example.com/z</loc></url></urlset>';
        const parsed = await parseSitemapBuffer(gzipSync(Buffer.from(xml)));
        expect(parsed.urls).toHaveLength(1);
    });

    it('rejects a high compression ratio', async () => {
        await expect(inflateIfNeeded(gzipSync(Buffer.alloc(500_000, 0)))).rejects.toMatchObject({ code: 'SITEMAP_TOO_LARGE' });
    });

    it('rejects corrupt gzip', async () => {
        await expect(inflateIfNeeded(Buffer.from([0x1f, 0x8b, 0, 1, 2, 3, 4, 5]))).rejects.toMatchObject({ code: 'GZIP_ERROR' });
    });

    it('applies exclude regex and same-host filtering', () => {
        const filters = compileFilters({ ...baseInput, excludeUrlRegex: String.raw`\.pdf$`, sameHostOnly: true } satisfies ResolvedInput, 'https://example.com');
        expect(keepUrl('https://example.com/a', null, filters)).toBe('https://example.com/a');
        expect(keepUrl('https://example.com/a.pdf', null, filters)).toBeNull();
        expect(keepUrl('https://other.test/a', null, filters)).toBeNull();
    });

    it('parses relative and absolute lastmod boundaries', () => {
        const absolute = parseDateBoundary('2026-09-01', false);
        expect(absolute).toBe(Date.UTC(2026, 8, 1));
        const relative = parseDateBoundary('7 days', false);
        expect(relative).toBeLessThan(Date.now());
        expect(relative).toBeGreaterThan(Date.now() - 8 * 86_400_000);
    });

    it('counts markdown links in llms.txt', () => {
        const extracted = extractLlmsLinks('# t\n[A](https://example.com/a)\n<https://example.com/b>\n');
        expect(extracted.count).toBe(2);
    });

    it('keeps a removed URL source from the snapshot and leaves unknown sources empty', () => {
        const parsed = parseSnapshotEntries([
            ['https://example.com/old-sitemap', '2026-01-01T00:00:00.000Z', 'sitemap'],
            ['https://example.com/old-llms', '2026-01-02T00:00:00.000Z', 'llms.txt'],
            ['https://example.com/legacy', '2026-01-03T00:00:00.000Z'],
        ]);
        expect(parsed).not.toBeNull();
        const page: PageRecord = {
            url: 'https://example.com/kept',
            norm: 'https://example.com/kept',
            source: 'sitemap',
            sourceSitemap: null,
            lastmod: null,
            changefreq: null,
            priority: null,
            sitemapKind: 'standard',
            imageCount: 0,
            videoCount: 0,
            hreflangCount: 0,
            changeType: null,
            firstSeenAt: null,
            httpStatus: null,
            finalUrl: null,
        };
        const { removed } = applyDiff([page], parsed, '2026-09-26T00:00:00.000Z');
        expect(removed.map((row) => [row.url, row.source])).toEqual([
            ['https://example.com/old-sitemap', 'sitemap'],
            ['https://example.com/old-llms', 'llms.txt'],
            ['https://example.com/legacy', null],
        ]);
    });

    it('defaults the per-host gap to 200ms', () => {
        const previous = process.env.SITEMAP_REQUEST_GAP_MS;
        delete process.env.SITEMAP_REQUEST_GAP_MS;
        expect(requestGapMs()).toBe(200);
        process.env.SITEMAP_REQUEST_GAP_MS = '0';
        expect(requestGapMs()).toBe(0);
        if (previous === undefined) delete process.env.SITEMAP_REQUEST_GAP_MS;
        else process.env.SITEMAP_REQUEST_GAP_MS = previous;
    });
});
