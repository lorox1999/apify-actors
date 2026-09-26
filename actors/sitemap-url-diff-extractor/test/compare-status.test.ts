import { afterEach, describe, expect, it } from 'vitest';

import { runInput } from './runActor.js';
import { startServer, urlset } from './server.js';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
});

describe('change tracking and status checks', () => {
    it('A1-11 marks added, removed, and unchanged URLs and stores a snapshot', async () => {
        let mode: 'first' | 'second' = 'first';
        const started = await startServer((req, res, origin) => {
            if (req.url !== '/sitemap.xml') {
                res.writeHead(404);
                res.end();
                return;
            }
            const urls = mode === 'first'
                ? Array.from({ length: 10 }, (_, index) => ({ loc: `${origin}/p/${index}` }))
                : [
                    ...Array.from({ length: 7 }, (_, index) => ({ loc: `${origin}/p/${index}` })),
                    ...Array.from({ length: 5 }, (_, index) => ({ loc: `${origin}/new/${index}` })),
                ];
            res.end(urlset(urls));
        });
        closers.push(started.close);
        const input = {
            startUrls: [`${started.base}/sitemap.xml`],
            compareWithPreviousRun: true,
            stateStoreName: 'sitemap-url-diff-state',
            checkLlmsTxt: false,
            respectRobotsTxt: false,
            discoverFromRobotsTxt: false,
            probeCommonPaths: false,
            maxUrlsPerSite: 100,
        };
        const first = await runInput(input);
        expect(first.items.filter((item) => item.recordType === 'url')).toHaveLength(10);
        expect(first.items.filter((item) => item.changeType === 'added')).toHaveLength(0);
        expect(first.summary[0]?.addedCount).toBeNull();
        expect(first.charges['site-compared'] ?? 0).toBe(0);

        mode = 'second';
        const second = await runInput(input, first.storageDir);
        const added = second.items.filter((item) => item.changeType === 'added');
        const removed = second.items.filter((item) => item.changeType === 'removed');
        const unchanged = second.items.filter((item) => item.changeType === 'unchanged');
        expect(added).toHaveLength(5);
        expect(removed).toHaveLength(3);
        expect(removed.every((item) => item.source === 'sitemap')).toBe(true);
        expect(unchanged).toHaveLength(7);
        expect(second.charges['site-compared']).toBe(1);
        expect(second.charges['url-extracted']).toBe(15);
        const { readdir } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const storeDir = join(second.storageDir, 'key_value_stores', 'sitemap-url-diff-state');
        const files = await readdir(storeDir);
        expect(files.some((name) => name.startsWith('snap-'))).toBe(true);
    });

    it('changesOnly outputs added and removed rows and charges site-compared', async () => {
        let mode: 'first' | 'second' = 'first';
        const started = await startServer((req, res, origin) => {
            const urls = mode === 'first'
                ? [{ loc: `${origin}/a` }, { loc: `${origin}/b` }]
                : [{ loc: `${origin}/b` }, { loc: `${origin}/c` }];
            res.end(urlset(urls));
        });
        closers.push(started.close);
        const input = {
            startUrls: [`${started.base}/sitemap.xml`],
            compareWithPreviousRun: true,
            outputMode: 'changesOnly' as const,
            stateStoreName: 'changes-only-state',
            checkLlmsTxt: false,
            respectRobotsTxt: false,
            discoverFromRobotsTxt: false,
            probeCommonPaths: false,
        };
        const first = await runInput(input);
        expect(first.items.filter((item) => item.recordType === 'url')).toHaveLength(2);
        expect(first.charges['site-compared'] ?? 0).toBe(0);
        expect(first.items.filter((item) => item.recordType === 'url').every((item) => item.changeType == null)).toBe(true);
        mode = 'second';
        const second = await runInput(input, first.storageDir);
        const rows = second.items.filter((item) => item.recordType === 'url');
        expect(rows.map((item) => item.changeType).sort()).toEqual(['added', 'removed']);
        expect(second.charges['site-compared']).toBe(1);
        expect(second.charges['url-extracted']).toBe(2);
    });

    it('charges status-checked, falls back from HEAD to GET, and follows redirects', async () => {
        const methods: string[] = [];
        const started = await startServer((req, res, origin) => {
            methods.push(`${req.method} ${req.url}`);
            if (req.url === '/head-ok') {
                res.writeHead(req.method === 'HEAD' ? 200 : 500);
                res.end('body-should-not-matter');
                return;
            }
            if (req.url === '/needs-get') {
                if (req.method === 'HEAD') {
                    res.writeHead(405);
                    res.end();
                    return;
                }
                res.writeHead(204);
                res.end();
                return;
            }
            if (req.url === '/go') {
                res.writeHead(302, { location: '/mid' });
                res.end();
                return;
            }
            if (req.url === '/mid') {
                res.writeHead(302, { location: '/land' });
                res.end();
                return;
            }
            if (req.url === '/land') {
                res.writeHead(201);
                res.end();
                return;
            }
            if (req.url === '/sitemap.xml') {
                res.end(urlset([
                    { loc: `${origin}/head-ok` },
                    { loc: `${origin}/needs-get` },
                    { loc: `${origin}/go` },
                ]));
                return;
            }
            res.writeHead(404);
            res.end();
        });
        closers.push(started.close);
        const result = await runInput({
            startUrls: [`${started.base}/sitemap.xml`],
            checkHttpStatus: true,
            statusCheckMaxUrls: 10,
            statusCheckConcurrencyPerHost: 1,
            checkLlmsTxt: false,
            respectRobotsTxt: false,
            discoverFromRobotsTxt: false,
            probeCommonPaths: false,
        });
        const byUrl = new Map(result.items.filter((item) => item.recordType === 'url').map((item) => [item.url, item]));
        expect(byUrl.get(`${started.base}/head-ok`)).toMatchObject({ httpStatus: 200, finalUrl: `${started.base}/head-ok` });
        expect(byUrl.get(`${started.base}/needs-get`)).toMatchObject({ httpStatus: 204 });
        expect(byUrl.get(`${started.base}/go`)).toMatchObject({ httpStatus: 201, finalUrl: `${started.base}/land` });
        expect(result.charges['status-checked']).toBe(3);
        expect(methods.filter((line) => line.startsWith('GET /needs-get'))).toHaveLength(1);
        expect(methods.filter((line) => line.startsWith('HEAD /head-ok'))).toHaveLength(1);
    });

    it('reports a redirect loop and does not charge status-checked for it', async () => {
        const started = await startServer((req, res, origin) => {
            if (req.url === '/sitemap.xml') {
                res.end(urlset([{ loc: `${origin}/loop` }]));
                return;
            }
            const next = req.url === '/loop' ? '/loop2' : '/loop';
            res.writeHead(302, { location: next });
            res.end();
        });
        closers.push(started.close);
        const result = await runInput({
            startUrls: [`${started.base}/sitemap.xml`],
            checkHttpStatus: true,
            checkLlmsTxt: false,
            respectRobotsTxt: false,
            discoverFromRobotsTxt: false,
            probeCommonPaths: false,
        });
        expect(result.items.some((item) => item.errorCode === 'REDIRECT_LOOP')).toBe(true);
        expect(result.charges['status-checked'] ?? 0).toBe(0);
        expect(result.charges['url-extracted']).toBe(1);
    });
});
