import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { AuditFailed } from '../src/failures.js';
import { precheckUrl } from '../src/precheck.js';
import { robotsAllows } from '../src/robots.js';

describe('reachability precheck', () => {
    it('classifies DNS failures and does not treat them as a completed audit', async () => {
        const error = new Error('getaddrinfo ENOTFOUND');
        (error as { cause?: { code?: string } }).cause = { code: 'ENOTFOUND' };
        await expect(precheckUrl('https://nonexistent-domain-abc123.invalid/', async () => {
            throw error;
        })).rejects.toMatchObject({ errorCode: 'DNS_ERROR' });
    });

    it('records HTTP 403 and 404 without fetching a body fallback', async () => {
        const forbidden = precheckUrl('https://example.com/private', async () => new Response('secret page', { status: 403 }));
        await expect(forbidden).rejects.toMatchObject({ errorCode: 'HTTP_4XX_PRECHECK', httpStatus: 403 });
        await expect(precheckUrl('https://example.com/missing', async () => new Response('', { status: 404 }))).rejects.toMatchObject({
            errorCode: 'HTTP_4XX_PRECHECK',
            httpStatus: 404,
        });
        await expect(precheckUrl('https://example.com/down', async () => new Response('', { status: 503 }))).rejects.toMatchObject({
            errorCode: 'HTTP_5XX_PRECHECK',
            httpStatus: 503,
        });
    });

    it('falls back from HEAD 405 to GET', async () => {
        const result = await precheckUrl('https://example.com/', async (_url, init) => {
            if (init?.method === 'HEAD') return new Response('', { status: 405 });
            return new Response('ok', { status: 200 });
        });
        expect(result).toEqual({ ok: true, status: 200, finalUrl: 'https://example.com/' });
    });

    it('does not follow a redirect onto a private address', async () => {
        const previous = process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS;
        delete process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS;
        try {
            await expect(precheckUrl('https://example.com/go', async () => new Response('', {
                status: 302,
                headers: { location: 'http://127.0.0.1/admin' },
            }))).rejects.toBeInstanceOf(AuditFailed);
        } finally {
            if (previous === undefined) delete process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS;
            else process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = previous;
        }
    });
});

describe('robots.txt', () => {
    it('blocks a disallowed path and allows everything else', async () => {
        const body = 'User-agent: *\nDisallow: /private\n';
        const fetchImpl = async () => new Response(body, { status: 200 });
        await expect(robotsAllows('https://example.com/private/page', fetchImpl)).resolves.toBe(false);
        await expect(robotsAllows('https://example.com/public', fetchImpl)).resolves.toBe(true);
    });

    it('allows the audit when robots.txt is missing', async () => {
        await expect(robotsAllows('https://example.com/', async () => new Response('', { status: 404 }))).resolves.toBe(true);
    });
});

describe('local fixture server', () => {
    it('serves a 404 that precheck reports', async () => {
        const server = createServer((_req, res) => {
            res.writeHead(404);
            res.end('missing');
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = '1';
        try {
            await expect(precheckUrl(`http://127.0.0.1:${port}/missing`)).rejects.toMatchObject({
                errorCode: 'HTTP_4XX_PRECHECK',
                httpStatus: 404,
            });
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });
});
