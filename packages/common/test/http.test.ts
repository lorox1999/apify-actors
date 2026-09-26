import { createServer, type Server } from 'node:http';
import { once } from 'node:events';

import { afterEach, describe, expect, it } from 'vitest';

import { HttpClientError, fetchWithRetry, parseRetryAfterSeconds, readBody } from '../src/http.js';

async function listen(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<{ server: Server; url: string }> {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    return { server, url: `http://127.0.0.1:${address.port}` };
}

describe('http', () => {
    const servers: Server[] = [];

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    });

    it('returns status, headers and body', async () => {
        const started = await listen((_req, res) => {
            res.setHeader('x-test', 'yes');
            res.end('hello');
        });
        servers.push(started.server);
        const result = await fetchWithRetry(`${started.url}/file`, {
            timeoutMs: 2000,
            retries: 0,
            userAgent: 'test-agent',
        });
        expect(result.status).toBe(200);
        expect(result.headers['x-test']).toBe('yes');
        expect((await readBody(result.body, 1000)).toString()).toBe('hello');
    });

    it('retries a 503 and then succeeds', async () => {
        let hits = 0;
        const started = await listen((_req, res) => {
            hits += 1;
            if (hits < 3) {
                res.writeHead(503);
                res.end('no');
                return;
            }
            res.end('ok');
        });
        servers.push(started.server);
        const result = await fetchWithRetry(started.url, { timeoutMs: 2000, retries: 2, userAgent: 'ua' });
        expect(result.status).toBe(200);
        expect(hits).toBe(3);
    });

    it('does not retry HTTP 403', async () => {
        let hits = 0;
        const started = await listen((_req, res) => {
            hits += 1;
            res.writeHead(403);
            res.end('denied');
        });
        servers.push(started.server);
        const result = await fetchWithRetry(started.url, { timeoutMs: 2000, retries: 2, userAgent: 'ua' });
        expect(result.status).toBe(403);
        expect(hits).toBe(1);
    });

    it('waits for Retry-After on 429 and logs the wait', async () => {
        let hits = 0;
        const logs: string[] = [];
        const started = await listen((_req, res) => {
            hits += 1;
            if (hits === 1) {
                res.writeHead(429, { 'retry-after': '1' });
                res.end('slow');
                return;
            }
            res.end('done');
        });
        servers.push(started.server);
        const startedAt = Date.now();
        const result = await fetchWithRetry(started.url, {
            timeoutMs: 2000,
            retries: 2,
            userAgent: 'ua',
            respectRetryAfterMaxSeconds: 30,
            logger: { info: (message) => logs.push(message) },
        });
        expect(result.status).toBe(200);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
        expect(logs.join(' ')).toContain('waiting 1s');
    });

    it('throws RATE_LIMITED when 429 persists', async () => {
        const started = await listen((_req, res) => {
            res.writeHead(429, { 'retry-after': '0' });
            res.end('no');
        });
        servers.push(started.server);
        await expect(fetchWithRetry(started.url, {
            timeoutMs: 2000,
            retries: 0,
            userAgent: 'ua',
            logger: { info: () => undefined },
        })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('reports a redirect loop with a redacted URL', async () => {
        const started = await listen((req, res) => {
            const next = req.url?.includes('b') ? '/a?token=SECRET' : '/b?token=SECRET';
            res.writeHead(302, { location: next });
            res.end();
        });
        servers.push(started.server);
        const error = await fetchWithRetry(`${started.url}/a?token=SECRET`, {
            timeoutMs: 2000,
            retries: 0,
            userAgent: 'ua',
        }).catch((err: unknown) => err);
        expect(error).toBeInstanceOf(HttpClientError);
        expect((error as HttpClientError).code).toBe('REDIRECT_LOOP');
        expect((error as HttpClientError).message).not.toContain('SECRET');
        expect((error as HttpClientError).url).not.toContain('SECRET');
    });

    it('treats a redirect without a location as a loop', async () => {
        const started = await listen((_req, res) => {
            res.writeHead(302);
            res.end();
        });
        servers.push(started.server);
        await expect(fetchWithRetry(started.url, { timeoutMs: 2000, retries: 0, userAgent: 'ua' }))
            .rejects.toMatchObject({ code: 'REDIRECT_LOOP' });
    });

    it('switches to GET after a 303 redirect', async () => {
        const methods: string[] = [];
        const started = await listen((req, res) => {
            methods.push(req.method ?? '');
            if (req.url === '/') {
                res.writeHead(303, { location: '/next' });
                res.end();
                return;
            }
            res.writeHead(204);
            res.end();
        });
        servers.push(started.server);
        const result = await fetchWithRetry(started.url, { timeoutMs: 2000, retries: 0, userAgent: 'ua', method: 'POST' });
        expect(result.status).toBe(204);
        expect(methods).toEqual(['POST', 'GET']);
    });

    it('follows a short redirect chain', async () => {
        const started = await listen((req, res) => {
            if (req.url === '/a') {
                res.writeHead(302, { location: '/b' });
                res.end();
                return;
            }
            res.end('landed');
        });
        servers.push(started.server);
        const result = await fetchWithRetry(`${started.url}/a`, { timeoutMs: 2000, retries: 0, userAgent: 'ua' });
        expect(result.status).toBe(200);
        expect(result.finalUrl).toBe(`${started.url}/b`);
    });

    it('times out and retries', async () => {
        let hits = 0;
        const started = await listen((_req, res) => {
            hits += 1;
            if (hits < 2) return;
            res.end('late');
        });
        servers.push(started.server);
        const result = await fetchWithRetry(started.url, { timeoutMs: 200, retries: 2, userAgent: 'ua' });
        expect(result.status).toBe(200);
        expect(hits).toBeGreaterThanOrEqual(2);
    });

    it('maps a refused connection to CONNECTION_ERROR', async () => {
        await expect(fetchWithRetry('http://127.0.0.1:1/', { timeoutMs: 500, retries: 0, userAgent: 'ua' }))
            .rejects.toMatchObject({ code: 'CONNECTION_ERROR' });
    });

    it('caps Retry-After and parses the header', () => {
        expect(parseRetryAfterSeconds('2', 30)).toBe(2);
        expect(parseRetryAfterSeconds('90', 30)).toBe(30);
        expect(parseRetryAfterSeconds(null, 30)).toBe(1);
        expect(parseRetryAfterSeconds('not-a-date', 30)).toBe(1);
        const soon = new Date(Date.now() + 5000).toUTCString();
        expect(parseRetryAfterSeconds(soon, 30)).toBeGreaterThanOrEqual(4);
        expect(parseRetryAfterSeconds(soon, 30)).toBeLessThanOrEqual(6);
    });

    it('stops reading when the body exceeds maxBytes', async () => {
        const started = await listen((_req, res) => {
            res.end('abcdefghij');
        });
        servers.push(started.server);
        const result = await fetchWithRetry(started.url, { timeoutMs: 2000, retries: 0, userAgent: 'ua' });
        await expect(readBody(result.body, 4)).rejects.toThrow('SITEMAP_TOO_LARGE');
    });
});
