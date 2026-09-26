process.env.ACTOR_MAX_TOTAL_CHARGE_USD = '3';
process.env.ACTOR_TEST_PAY_PER_EVENT = 'true';
process.env.SITEMAP_REQUEST_GAP_MS = '0';
process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = '1';

import { afterAll, describe, expect, it } from 'vitest';

import { runInput } from './runActor.js';
import { startServer, urlset } from './server.js';

describe('A1-10 charge limit', () => {
    let close: (() => Promise<void>) | undefined;

    afterAll(async () => {
        await close?.();
        delete process.env.ACTOR_MAX_TOTAL_CHARGE_USD;
    });

    it('writes only as many rows as the local budget allows and succeeds', async () => {
        const started = await startServer((req, res, origin) => {
            if (req.url === '/sitemap.xml') {
                res.end(urlset(Array.from({ length: 20 }, (_, index) => ({ loc: `${origin}/p/${index}` }))));
                return;
            }
            res.writeHead(404);
            res.end();
        });
        close = started.close;
        const result = await runInput({
            startUrls: [`${started.base}/sitemap.xml`],
            maxUrlsPerSite: 100,
            checkLlmsTxt: false,
            respectRobotsTxt: false,
            discoverFromRobotsTxt: false,
            probeCommonPaths: false,
            compareWithPreviousRun: false,
        });
        const urls = result.items.filter((item) => item.recordType === 'url');
        expect(urls).toHaveLength(3);
        expect(result.charges['url-extracted']).toBe(3);
        expect(result.summary[0]?.warnings).toContain('CHARGE_LIMIT_REACHED');
        expect(result.message.startsWith('Done:')).toBe(true);
    });
});
