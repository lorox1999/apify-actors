import { Actor } from 'apify';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureActor, runInput } from './runActor.js';
import { startServer, urlset, type Handler } from './server.js';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
});

async function serve(handler: Handler): Promise<string> {
    const started = await startServer(handler);
    closers.push(started.close);
    return started.base;
}

describe('unmetered runs', () => {
    it('writes URL rows without billing them and records would-be charges', async () => {
        await ensureActor();
        const manager = Actor.getChargingManager() as { pricingModel?: string };
        const previous = manager.pricingModel;
        manager.pricingModel = undefined;
        try {
            const base = await serve((req, res, origin) => {
                if (req.url === '/sitemap.xml') {
                    res.end(urlset([{ loc: `${origin}/only` }]));
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
            const rows = result.items.filter((item) => item.recordType === 'url');
            expect(rows).toHaveLength(1);
            expect(rows[0]).not.toHaveProperty('charged');
            expect(result.summary[0]?.urlsOutput).toBe(1);
            expect(result.summary[0]?.chargedEvents).toEqual({
                'url-extracted': 0,
                'status-checked': 0,
                'site-compared': 0,
            });
            expect(result.summary[0]?.wouldBeChargedEvents).toEqual({
                'url-extracted': 1,
                'status-checked': 0,
                'site-compared': 0,
            });
            expect(result.charges).toEqual({});
        } finally {
            manager.pricingModel = previous;
        }
    });
});
