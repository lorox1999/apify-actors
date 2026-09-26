process.env.ACTOR_MAX_TOTAL_CHARGE_USD = '3';
process.env.ACTOR_TEST_PAY_PER_EVENT = 'true';
process.env.ACTOR_MEMORY_MBYTES = '4096';
process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = '1';

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { LhrLike } from '../src/types.js';
import { runInput } from './runActor.js';

const lhr = JSON.parse(readFileSync(new URL('fixtures/lhr-ok.json', import.meta.url), 'utf8')) as LhrLike;

describe('A2-11 charge limit', () => {
    it('stops before an audit that would exceed the local test budget', async () => {
        let calls = 0;
        const result = await runInput(
            { urls: Array.from({ length: 10 }, (_, index) => `https://example.com/${index}`), strategy: 'mobile' },
            {
                precheck: async (url) => ({ ok: true, status: 200, finalUrl: url }),
                robotsAllow: async () => true,
                auditor: {
                    async audit() {
                        calls += 1;
                        return lhr;
                    },
                    async restart() {
                        return undefined;
                    },
                },
            },
        );
        const charged = result.items.filter((item) => item.charged === true);
        expect(charged).toHaveLength(3);
        expect(calls).toBe(3);
        expect(result.charges['url-audited-local']).toBe(3);
        expect(result.summary.chargeLimitReached).toBe(true);
        expect(result.message).toContain('Charge limit reached');
        expect(charged.every((item) => item.status === 'ok')).toBe(true);
    });
});
