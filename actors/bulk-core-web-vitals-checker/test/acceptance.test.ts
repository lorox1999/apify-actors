import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';

import { Actor } from 'apify';
import { afterEach, describe, expect, it } from 'vitest';

import { AuditFailed } from '../src/failures.js';
import { createLocalAuditor, type LocalAuditor } from '../src/lighthouseRunner.js';
import type { LhrLike } from '../src/types.js';
import { runInput, storageContains } from './runActor.js';

const lhr = JSON.parse(readFileSync(new URL('fixtures/lhr-ok.json', import.meta.url), 'utf8')) as LhrLike;
const SECRET = 'TEST_SECRET_123';

function auditorOf(impl: LocalAuditor['audit']): { auditor: LocalAuditor; calls: string[]; restarts: number } {
    const calls: string[] = [];
    const state = { restarts: 0 };
    return {
        calls,
        get restarts() {
            return state.restarts;
        },
        auditor: {
            async audit(request) {
                calls.push(`${request.strategy} ${request.url}`);
                return impl(request);
            },
            async restart() {
                state.restarts += 1;
            },
        },
    };
}

function allowAll() {
    return {
        precheck: async (url: string) => ({ ok: true as const, status: 200, finalUrl: url }),
        robotsAllow: async () => true,
    };
}

describe('audit run', () => {
    afterEach(() => {
        delete process.env.ACTOR_MEMORY_MBYTES;
        delete process.env.CWV_CRASH_CHROME;
    });

    it('charges url-audited-local once per URL and device', async () => {
        const fake = auditorOf(async () => lhr);
        const result = await runInput(
            { urls: ['https://example.com/a', 'https://example.com/b'], strategy: 'both', precheckReachability: true },
            { auditor: fake.auditor, ...allowAll() },
        );
        expect(result.items).toHaveLength(4);
        expect(result.items.every((item) => item.status === 'ok' && item.charged === true)).toBe(true);
        expect(result.charges['url-audited-local']).toBe(4);
        expect(result.charges['url-audited']).toBeUndefined();
        expect(fake.calls).toHaveLength(4);
        expect(result.summary.audited).toBe(4);
    });

    it('writes a free DNS_ERROR row and does not start Lighthouse', async () => {
        const fake = auditorOf(async () => lhr);
        const result = await runInput(
            { urls: ['https://nonexistent-domain-abc123.invalid/'], precheckReachability: true },
            {
                auditor: fake.auditor,
                robotsAllow: async () => true,
                precheck: async () => {
                    throw new AuditFailed('DNS_ERROR');
                },
            },
        );
        expect(fake.calls).toHaveLength(0);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({ status: 'error', errorCode: 'DNS_ERROR', charged: false });
        expect(result.charges['url-audited-local']).toBeUndefined();
    });

    it('skips 403 and 404 before Lighthouse, and still audits when the precheck is off', async () => {
        const server = createServer((req, res: ServerResponse) => {
            if (req.url === '/robots.txt') {
                res.end('User-agent: *\nDisallow:\n');
                return;
            }
            if (req.url === '/forbidden') {
                res.writeHead(403);
                res.end('no');
                return;
            }
            res.writeHead(404);
            res.end('missing');
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = '1';
        const fake = auditorOf(async () => lhr);
        try {
            const blocked = await runInput(
                { urls: [`http://127.0.0.1:${port}/forbidden`, `http://127.0.0.1:${port}/missing`], precheckReachability: true },
                { auditor: fake.auditor },
            );
            expect(fake.calls).toHaveLength(0);
            expect(blocked.items.map((item) => item.errorCode)).toEqual(['HTTP_4XX_PRECHECK', 'HTTP_4XX_PRECHECK']);
            expect(String(blocked.items[0]?.errorMessage)).toContain('403');
            expect(String(blocked.items[0]?.errorMessage).toLowerCase()).toContain('not bypassed');
            expect(blocked.items.every((item) => item.charged === false)).toBe(true);

            const page = structuredClone(lhr);
            const first = page.audits?.['network-requests']?.details?.items?.[0];
            if (first && typeof first === 'object') (first as { statusCode?: number }).statusCode = 404;
            const open = auditorOf(async () => page);
            const audited = await runInput(
                { urls: [`http://127.0.0.1:${port}/missing`], precheckReachability: false },
                { auditor: open.auditor },
            );
            expect(open.calls).toHaveLength(1);
            expect(audited.items[0]).toMatchObject({ status: 'ok', charged: true });
            expect(audited.items[0]?.runWarnings).toContain('Main document returned HTTP 404.');
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });

    it('retries a timeout once, leaves it free, and continues with the next URL', async () => {
        let calls = 0;
        const fake = auditorOf(async () => {
            calls += 1;
            if (calls <= 2) return new Promise(() => undefined);
            return lhr;
        });
        const started = Date.now();
        const result = await runInput(
            { urls: ['https://example.com/slow', 'https://example.com/next'], retries: 1, perUrlTimeoutSecs: 20 },
            { auditor: fake.auditor, ...allowAll(), timeoutMs: 40 },
        );
        expect(Date.now() - started).toBeLessThan(2_000);
        expect(calls).toBe(3);
        expect(result.items[0]).toMatchObject({ errorCode: 'TIMEOUT', charged: false, url: 'https://example.com/slow' });
        expect(String(result.items[0]?.errorMessage)).toContain('20');
        expect(result.items[1]).toMatchObject({ status: 'ok', charged: true });
        expect(fake.restarts).toBeGreaterThanOrEqual(1);
    });

    it('restarts after a Chrome crash and still finishes the URL', async () => {
        let calls = 0;
        const fake = auditorOf(async () => {
            calls += 1;
            if (calls === 1) throw new AuditFailed('CHROME_CRASH');
            return lhr;
        });
        const result = await runInput(
            { urls: ['https://example.com/'], retries: 1 },
            { auditor: fake.auditor, ...allowAll() },
        );
        expect(calls).toBe(2);
        expect(fake.restarts).toBeGreaterThanOrEqual(1);
        expect(result.items[0]).toMatchObject({ status: 'ok', charged: true });
        expect(result.message.startsWith('Done:')).toBe(true);
    });

    it('arms the Chrome crash hook once', async () => {
        process.env.CWV_CRASH_CHROME = '1';
        const auditor = createLocalAuditor();
        await expect(auditor.audit({
            url: 'https://example.com/',
            strategy: 'mobile',
            categories: ['performance'],
            timeoutMs: 1000,
        })).rejects.toMatchObject({ errorCode: 'CHROME_CRASH' });
    });

    it('writes LOW_MEMORY_FOR_LIGHTHOUSE for every URL and does not launch Chrome', async () => {
        process.env.ACTOR_MEMORY_MBYTES = '1024';
        const fake = auditorOf(async () => lhr);
        const result = await runInput(
            { urls: ['https://example.com/', 'https://example.org/'], strategy: 'both' },
            { auditor: fake.auditor, ...allowAll() },
        );
        expect(fake.calls).toHaveLength(0);
        expect(result.items).toHaveLength(4);
        expect(result.items.every((item) => item.errorCode === 'LOW_MEMORY_FOR_LIGHTHOUSE' && item.charged === false)).toBe(true);
        expect(result.message).toContain('4096');
        expect(result.charges['url-audited-local']).toBeUndefined();
    });

    it('bills url-audited when the user PageSpeed key returns field data', async () => {
        const psi = JSON.parse(readFileSync(new URL('fixtures/psi-field.json', import.meta.url), 'utf8')) as {
            lighthouseResult: LhrLike;
            loadingExperience: unknown;
        };
        const { parseFieldData } = await import('../src/psi.js');
        let calls = 0;
        const result = await runInput(
            { urls: ['https://example.com/'], engine: 'psi', psiApiKey: 'user-owned-key', strategy: 'mobile' },
            {
                ...allowAll(),
                runPsi: async () => {
                    calls += 1;
                    return { lhr: psi.lighthouseResult, field: parseFieldData(psi.loadingExperience) };
                },
            },
        );
        expect(calls).toBe(1);
        expect(result.items[0]).toMatchObject({
            status: 'ok',
            engine: 'psi',
            charged: true,
            fieldDataAvailable: true,
            fieldLcpP75Ms: 2100,
            fieldClsP75: 0.05,
        });
        expect(result.charges['url-audited']).toBe(1);
        expect(result.charges['url-audited-local']).toBeUndefined();
    });

    it('stops further PageSpeed calls after an invalid key', async () => {
        let calls = 0;
        const urls = Array.from({ length: 6 }, (_, index) => `https://example.com/${index}`);
        const result = await runInput(
            { urls, engine: 'psi', psiApiKey: 'bad-key' },
            {
                ...allowAll(),
                runPsi: async () => {
                    calls += 1;
                    throw new AuditFailed('PSI_KEY_INVALID');
                },
            },
        );
        expect(calls).toBeLessThan(urls.length);
        expect(calls).toBeGreaterThan(0);
        expect(result.items).toHaveLength(6);
        expect(result.items.every((item) => item.errorCode === 'PSI_KEY_INVALID' && item.charged === false)).toBe(true);
        expect(result.charges['url-audited']).toBeUndefined();
    });

    it('never writes the PageSpeed key into the dataset, summary, status or logs', async () => {
        const lines: string[] = [];
        const result = await runInput(
            { urls: ['https://example.com/'], engine: 'psi', psiApiKey: SECRET },
            {
                ...allowAll(),
                logger: {
                    info: (message) => lines.push(message),
                    warning: (message) => lines.push(message),
                    error: (message) => lines.push(message),
                },
                fetchImpl: async (input) => {
                    throw new Error(`upstream failed ${SECRET} ${String(input)}`);
                },
            },
        );
        const blob = JSON.stringify({ items: result.items, summary: result.summary, message: result.message, lines });
        expect(blob).not.toContain(SECRET);
        expect(storageContains(result.storageDir, SECRET)).toBe(false);
        expect(result.items[0]).toMatchObject({ status: 'error', charged: false });
    });

    it('reads url fields from a dataset and ignores error rows', async () => {
        const fake = auditorOf(async () => lhr);
        const result = await runInput(
            { urlsDataset: 'cwv-source', urlsDatasetField: 'url' },
            { auditor: fake.auditor, ...allowAll() },
            async () => {
                const dataset = await Actor.openDataset('cwv-source');
                await dataset.pushData([
                    { recordType: 'error', url: 'https://example.com/skip-me' },
                    { url: 'https://example.com/kept' },
                    { title: 'not a url row' },
                ]);
            },
        );
        expect(result.items.map((item) => item.url)).toEqual(['https://example.com/kept']);
        expect(result.items[0]).toMatchObject({ status: 'ok', charged: true });
    });

    it('rejects a URL that contains a password before any audit', async () => {
        const fake = auditorOf(async () => lhr);
        const result = await runInput(
            { urls: ['https://user:s3cret@example.com/private'] },
            { auditor: fake.auditor, ...allowAll() },
        );
        expect(fake.calls).toHaveLength(0);
        expect(result.items[0]).toMatchObject({ status: 'error', errorCode: 'INVALID_URL', charged: false });
        expect(JSON.stringify(result.items)).not.toContain('s3cret');
    });

    it('honors robots.txt and does not change IP to get around it', async () => {
        const server = createServer((req, res) => {
            if (req.url === '/robots.txt') {
                res.end('User-agent: *\nDisallow: /blocked\n');
                return;
            }
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('<html><body>ok</body></html>');
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = '1';
        const fake = auditorOf(async () => lhr);
        try {
            const result = await runInput(
                { urls: [`http://127.0.0.1:${port}/blocked`], precheckReachability: true },
                { auditor: fake.auditor },
            );
            expect(fake.calls).toHaveLength(0);
            expect(result.items[0]).toMatchObject({ errorCode: 'BLOCKED_BY_ROBOTS', charged: false });
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });
});
