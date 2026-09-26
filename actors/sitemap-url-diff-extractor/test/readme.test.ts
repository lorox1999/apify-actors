import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('README', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const first = '**Sitemap URL Extractor** gets every URL a website lists in its XML sitemaps, in one clean table. Enter a domain and this sitemap extractor finds the sitemaps through robots.txt and common paths, follows sitemap indexes and `.gz` files, and returns each URL with `lastmod`, `changefreq` and `priority`. Turn on change tracking to see which URLs were **added** or **removed** since your last run, check whether the site publishes `llms.txt`, and optionally record the HTTP status of every URL. Use it for SEO audits, site migrations, content monitoring and seeding your own crawlers.';

    it('starts with the store-listing paragraph and uses no H1', () => {
        expect(readme.startsWith(first)).toBe(true);
        expect(readme).not.toMatch(/^# /m);
    });

    it('includes the required sections and the site-compared event', () => {
        for (const heading of [
            '## What does Sitemap URL Extractor do?',
            '## How to use the sitemap extractor',
            '## Input',
            '## Output example',
            '## How much does it cost to extract sitemap URLs?',
            '## FAQ',
            '## Limitations',
            '## Responsible use',
        ]) {
            expect(readme).toContain(heading);
        }
        expect(readme).toContain('site-compared');
        expect(readme).toContain('$4.00');
        expect(readme).toContain('$7.00');
    });

    it('does not contain an email address or a markdown link', () => {
        expect(readme).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        expect(readme).not.toMatch(/\[[^\]]+\]\(https?:\/\//);
    });
});
