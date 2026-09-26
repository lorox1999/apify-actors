process.env.ACTOR_USE_CHARGING_LOG_DATASET = 'true';
process.env.ACTOR_TEST_PAY_PER_EVENT = 'true';
process.env.SITEMAP_REQUEST_GAP_MS = '0';
process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = '1';

import { afterAll, describe, expect, it } from 'vitest';

import { countEventInStorage, runInput } from './runActor.js';
import { startServer, urlset } from './server.js';

describe('A1-09 charging log', () => {
    let close: (() => Promise<void>) | undefined;

    afterAll(async () => {
        await close?.();
        delete process.env.ACTOR_USE_CHARGING_LOG_DATASET;
    });

    it('writes url-extracted to the local charging log and not status-checked', async () => {
        const started = await startServer((req, res) => {
            if (req.url === '/sitemap.xml') {
                const urls = [
                    ...Array.from({ length: 1000 }, (_, index) => ({ loc: `https://fixture.test/keep/${index}` })),
                    ...Array.from({ length: 200 }, (_, index) => ({ loc: `https://fixture.test/drop/${index}` })),
                    ...Array.from({ length: 34 }, (_, index) => ({ loc: `https://fixture.test/keep/${index}` })),
                ];
                res.end(urlset(urls));
                return;
            }
            res.writeHead(404);
            res.end();
        });
        close = started.close;
        const result = await runInput({
            startUrls: [`${started.base}/sitemap.xml`],
            excludeUrlRegex: '/drop/',
            maxUrlsPerSite: 5000,
            checkLlmsTxt: false,
            respectRobotsTxt: false,
            discoverFromRobotsTxt: false,
            probeCommonPaths: false,
        });
        expect(result.charges['url-extracted']).toBe(1000);
        const logged = await countEventInStorage(result.storageDir, 'url-extracted');
        expect(logged).toBe(1000);
        const statusLogged = await countEventInStorage(result.storageDir, 'status-checked');
        expect(statusLogged).toBe(0);
    });
});
