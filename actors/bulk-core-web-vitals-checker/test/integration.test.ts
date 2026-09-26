import { existsSync } from 'node:fs';
import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { createLocalAuditor } from '../src/lighthouseRunner.js';
import { runInput } from './runActor.js';

const EMAIL = 'secret.person@example.com';
const NAME = 'Pat Exampleperson';

function findChrome(): string | undefined {
    const candidates = [
        process.env.CHROME_PATH,
        process.env.APIFY_CHROME_EXECUTABLE_PATH,
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ].filter((value): value is string => Boolean(value));
    return candidates.find((path) => existsSync(path));
}

function nodeSupportsLighthouse(): boolean {
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    return major > 22 || (major === 22 && minor >= 19);
}

const chrome = findChrome();
const supported = nodeSupportsLighthouse();
const run = chrome && supported ? describe : describe.skip;

if (!chrome || !supported) {
    console.info(`Skipping Lighthouse integration (chrome=${chrome ?? 'missing'}, node=${process.versions.node}).`);
}

run('real Lighthouse against a local fixture page', () => {
    it('returns lab scores and does not copy personal text from the page', async () => {
        process.env.CHROME_PATH = chrome;
        process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = '1';
        process.env.ACTOR_MEMORY_MBYTES = '4096';
        const server = createServer((req, res) => {
            if (req.url === '/robots.txt') {
                res.end('User-agent: *\nDisallow:\n');
                return;
            }
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html><html><head><meta charset="utf-8"><title>CWV fixture</title></head><body><h1>Fixture page</h1><p>${EMAIL} ${NAME}</p></body></html>`);
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        try {
            const result = await runInput(
                {
                    urls: [`http://127.0.0.1:${port}/`],
                    strategy: 'mobile',
                    categories: ['performance'],
                    precheckReachability: true,
                    maxOpportunities: 5,
                },
                { auditor: createLocalAuditor() },
            );
            expect(result.items).toHaveLength(1);
            expect(result.items[0]).toMatchObject({ status: 'ok', charged: true, strategy: 'mobile', engine: 'local' });
            expect(typeof result.items[0]?.performanceScore).toBe('number');
            expect(typeof result.items[0]?.lcpMs).toBe('number');
            const blob = JSON.stringify(result.items);
            expect(blob).not.toContain(EMAIL);
            expect(blob).not.toContain(NAME);
            expect(blob).not.toContain('snippet');
            expect(blob).not.toContain('nodeLabel');
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    }, 180_000);
});
