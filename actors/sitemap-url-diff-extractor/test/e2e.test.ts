import { describe, expect, it } from 'vitest';

import { runInput } from './runActor.js';

const enabled = process.env.E2E === '1';

describe.skipIf(!enabled)('optional live e2e', () => {
    it('A1-01 reads docs.apify.com within 60 seconds', async () => {
        const previous = process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS;
        delete process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS;
        const started = Date.now();
        try {
            const result = await runInput({
                startUrls: ['https://docs.apify.com'],
                maxUrlsPerSite: 100,
            });
            expect(Date.now() - started).toBeLessThan(60_000);
            expect(result.items.filter((item) => item.recordType === 'url')).toHaveLength(100);
            expect(result.summary[0]?.robotsTxtFound).toBe(true);
            expect(result.summary[0]?.sitemapFilesParsed).toBeGreaterThanOrEqual(1);
            expect(result.summary[0]?.llmsTxtFound).toBe(true);
        } finally {
            if (previous === undefined) delete process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS;
            else process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = previous;
        }
    }, 70_000);
});
