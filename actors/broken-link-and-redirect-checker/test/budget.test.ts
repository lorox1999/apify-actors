process.env.ACTOR_MAX_TOTAL_CHARGE_USD = '3';
process.env.ACTOR_TEST_PAY_PER_EVENT = 'true';
process.env.A3B_TEST_RETRY_DELAY_MS = '0';

import { afterAll, describe, expect, it } from 'vitest';

import { startFixture, type Fixture } from './fixtures/a3b-server.js';
import { runInput } from './runActor.js';

describe('A3-13 charge limit', () => {
    let fixture: Fixture;

    afterAll(async () => {
        await fixture?.close();
        delete process.env.ACTOR_MAX_TOTAL_CHARGE_USD;
    });

    it('stops before the local $3 event budget and reports the remaining links', async () => {
        fixture = await startFixture();
        const result = await runInput({
            mode: 'crawl',
            startUrls: [fixture.url('site.test', '/bill')],
            maxPages: 5,
            maxDepth: 1,
            maxLinks: 200,
            checkExternalLinks: true,
            minDelayPerHostMs: 0,
            maxConcurrency: 8,
            maxConcurrencyPerHost: 2,
            respectRobotsTxt: true,
        }, { allowPrivate: false });
        const linkCharges = result.charges['link-checked'] ?? 0;
        const pageCharges = result.charges['page-crawled'] ?? 0;
        expect(linkCharges + pageCharges).toBeLessThanOrEqual(3);
        expect(linkCharges + pageCharges).toBeGreaterThan(0);
        expect(result.summary.stopReason).toBe('CHARGE_LIMIT_REACHED');
        const notChecked = ((result.summary.sites as Array<{ notChecked: Record<string, number> }>) ?? [])
            .reduce((sum, site) => sum + (site.notChecked.CHARGE_LIMIT_REACHED ?? 0), 0);
        expect(notChecked).toBeGreaterThan(0);
        const billedRows = result.items.filter((item) => item.recordType === 'link' && item.charged === true).length;
        expect(linkCharges).toBeGreaterThanOrEqual(billedRows);
        expect(result.message).toMatch(/charge limit/);
    });
});
