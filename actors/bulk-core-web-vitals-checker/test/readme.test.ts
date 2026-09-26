import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const FIRST = '**Bulk Core Web Vitals Checker** runs real Lighthouse audits on a list of URLs and gives you one row per page: Performance, Accessibility, Best Practices and SEO scores, plus the lab metrics behind Core Web Vitals — LCP, CLS, TBT and FCP — and the top fixes ranked by estimated savings. Lighthouse runs inside the Actor, so **no API key is needed**. If you have your own PageSpeed Insights API key, you can switch to it for a lower per-URL price and real-user (Chrome UX Report) field data. Paste URLs, or load them from a dataset such as the output of a sitemap extractor, and export the results to CSV, Excel or JSON.';

describe('README', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

    it('starts with the store-listing paragraph and uses no H1', () => {
        expect(readme.startsWith(FIRST)).toBe(true);
        expect(readme).not.toMatch(/^# /m);
    });

    it('includes the required sections, lab-data note and prices', () => {
        for (const heading of [
            '## What does Bulk Core Web Vitals Checker do?',
            '## How to check Core Web Vitals in bulk',
            '## Input',
            '## Output example',
            '## How much does a bulk Lighthouse audit cost?',
            '## FAQ',
            '## Limitations',
            '## Disclaimer',
        ]) {
            expect(readme).toContain(heading);
        }
        expect(readme).toContain('lab data from Lighthouse run in this Actor\'s cloud environment');
        expect(readme).toContain('not affiliated with or endorsed by Google');
        expect(readme).toContain('url-audited-local');
        expect(readme).toContain('url-audited');
        expect(readme).toContain('$2.00');
        expect(readme).toContain('$4.00');
        expect(readme).toContain('$0.20');
        expect(readme).toContain('4096');
    });

    it('does not contain an email address or a markdown link', () => {
        expect(readme).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        expect(readme).not.toMatch(/\[[^\]]+\]\(https?:\/\//);
    });
});
