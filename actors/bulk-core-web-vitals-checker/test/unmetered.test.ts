process.env.ACTOR_MEMORY_MBYTES = '4096';
process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = '1';

import { readFileSync } from 'node:fs';

import { Actor } from 'apify';
import { describe, expect, it } from 'vitest';

import type { LhrLike } from '../src/types.js';
import { ensureActor, runInput } from './runActor.js';

const lhr = JSON.parse(readFileSync(new URL('fixtures/lhr-ok.json', import.meta.url), 'utf8')) as LhrLike;

describe('unmetered runs', () => {
    it('writes the audit with charged false and counts it as would-be-billed', async () => {
        await ensureActor();
        const manager = Actor.getChargingManager() as { pricingModel?: string };
        const previous = manager.pricingModel;
        manager.pricingModel = undefined;
        try {
            const result = await runInput(
                { urls: ['https://example.com/'], strategy: 'mobile' },
                {
                    precheck: async (url) => ({ ok: true, status: 200, finalUrl: url }),
                    robotsAllow: async () => true,
                    auditor: {
                        async audit() {
                            return lhr;
                        },
                        async restart() {
                            return undefined;
                        },
                    },
                },
            );
            expect(result.items).toHaveLength(1);
            expect(result.items[0]).toMatchObject({ status: 'ok', charged: false });
            expect(result.summary.audited).toBe(1);
            expect(result.summary.chargeLimitReached).toBe(false);
            expect(result.summary.billed).toEqual({});
            expect(result.summary.wouldBeBilled).toEqual({ 'url-audited-local': 1 });
            expect(result.charges).toEqual({});
            expect(result.message).toContain('0 billed, 1 would be billed');
        } finally {
            manager.pricingModel = previous;
        }
    });
});
