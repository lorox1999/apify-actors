process.env.ACTOR_TEST_PAY_PER_EVENT = 'false';
delete process.env.ACTOR_MAX_TOTAL_CHARGE_USD;

import { afterAll, describe, expect, it } from 'vitest';

import { isUnmetered } from '@apify-actors/common';

import { startFixture, type Fixture } from './fixtures/a3b-server.js';
import { ensureActor, runInput } from './runActor.js';

describe('unmetered runs', () => {
    let fixture: Fixture;

    afterAll(async () => {
        await fixture?.close();
    });

    it('writes rows with charged false and splits billed from wouldBeBilled', async () => {
        await ensureActor();
        expect(isUnmetered()).toBe(true);
        fixture = await startFixture();
        const result = await runInput({
            mode: 'list',
            urls: [fixture.url('site.test', '/ok'), fixture.url('site.test', '/404')],
            minDelayPerHostMs: 0,
            respectRobotsTxt: false,
        });
        const links = result.items.filter((item) => item.recordType === 'link');
        expect(links).toHaveLength(2);
        expect(links.every((item) => item.charged === false)).toBe(true);
        expect(result.summary.billed).toEqual({ 'link-checked': 0, 'page-crawled': 0 });
        expect((result.summary.wouldBeBilled as { 'link-checked': number })['link-checked']).toBe(2);
        expect(result.summary.chargedEvents).toEqual({ 'link-checked': 0, 'page-crawled': 0 });
    });
});
