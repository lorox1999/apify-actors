import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { AuditFailed } from '../src/failures.js';
import { normalizeLighthouseResult } from '../src/normalize.js';
import { ROW_KEYS, type LhrLike } from '../src/types.js';

const EMAIL = 'secret.person@example.com';
const NAME = 'Pat Exampleperson';

function load(name: string): LhrLike {
    return JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as LhrLike;
}

const base = {
    url: 'https://example.com/page',
    strategy: 'mobile' as const,
    engine: 'local' as const,
    categories: ['performance', 'accessibility', 'best-practices', 'seo'] as const,
    maxOpportunities: 5,
    auditDurationMs: 14200,
    auditedAt: '2026-09-26T03:50:00.000Z',
};

function walk(value: unknown, seen: string[]): void {
    if (typeof value === 'string') seen.push(value);
    else if (Array.isArray(value)) value.forEach((item) => walk(item, seen));
    else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            seen.push(key);
            walk(child, seen);
        }
    }
}

describe('normalize Lighthouse results', () => {
    it('maps scores, lab metrics, ratings and opportunities from a saved fixture', () => {
        const row = normalizeLighthouseResult({ ...base, categories: [...base.categories], lhr: load('lhr-ok.json') });
        expect(row.status).toBe('ok');
        expect(row.charged).toBe(true);
        expect(row.performanceScore).toBe(92);
        expect(row.accessibilityScore).toBe(96);
        expect(row.bestPracticesScore).toBe(100);
        expect(row.seoScore).toBe(90);
        expect(row.lcpMs).toBe(812);
        expect(row.fcpMs).toBe(400);
        expect(row.cls).toBe(0.0422);
        expect(row.tbtMs).toBe(80);
        expect(row.speedIndexMs).toBe(901);
        expect(row.ttfbMs).toBe(35);
        expect(row.lcpRating).toBe('good');
        expect(row.clsRating).toBe('good');
        expect(row.tbtRating).toBe('good');
        expect(row.finalUrl).toBe('https://example.com/page');
        expect(row.lighthouseVersion).toBe('13.5.0');
        expect(row.benchmarkIndex).toBe(1650);
        expect(row.totalByteWeight).toBe(1257);
        expect(row.requestCount).toBe(2);
        expect(row.topOpportunities?.map((item) => item.id)).toEqual(['render-blocking-resources', 'unused-javascript']);
        expect(row.topOpportunities?.[0]).toEqual({
            id: 'render-blocking-resources',
            title: 'Eliminate render-blocking resources',
            savingsMs: 300,
            savingsBytes: 12000,
        });
        expect(row.fieldDataAvailable).toBeNull();
        expect(row.runWarnings).toHaveLength(5);
        expect(row.runWarnings?.[0]?.length).toBeLessThanOrEqual(300);
    });

    it('rates the Core Web Vitals boundaries', () => {
        const lhr = load('lhr-ok.json');
        lhr.audits = {
            ...lhr.audits,
            'largest-contentful-paint': { numericValue: 4001 },
            'cumulative-layout-shift': { numericValue: 0.25 },
            'total-blocking-time': { numericValue: 201 },
        };
        const row = normalizeLighthouseResult({ ...base, categories: [...base.categories], lhr });
        expect(row.lcpRating).toBe('poor');
        expect(row.clsRating).toBe('needs-improvement');
        expect(row.tbtRating).toBe('needs-improvement');
    });

    it('leaves scores null for categories that were not requested', () => {
        const row = normalizeLighthouseResult({
            ...base,
            categories: ['performance'],
            lhr: load('lhr-ok.json'),
        });
        expect(row.performanceScore).toBe(92);
        expect(row.accessibilityScore).toBeNull();
        expect(row.seoScore).toBeNull();
    });

    it('drops DOM snippets, screenshots and personal data from the fixture', () => {
        const row = normalizeLighthouseResult({ ...base, categories: [...base.categories], lhr: load('lhr-ok.json') });
        const seen: string[] = [];
        walk(row, seen);
        const blob = seen.join('\n');
        expect(blob).not.toContain(EMAIL);
        expect(blob).not.toContain(NAME);
        expect(seen).not.toContain('snippet');
        expect(seen).not.toContain('nodeLabel');
        expect(seen).not.toContain('selector');
        expect(Object.keys(row).sort()).toEqual([...ROW_KEYS].sort());
    });

    it('turns a runtime error into an unbilled failure and does not echo the page message', () => {
        expect(() => normalizeLighthouseResult({ ...base, categories: [...base.categories], lhr: load('lhr-runtime-error.json') })).toThrow(AuditFailed);
        try {
            normalizeLighthouseResult({ ...base, categories: [...base.categories], lhr: load('lhr-runtime-error.json') });
        } catch (error) {
            expect(error).toBeInstanceOf(AuditFailed);
            const failed = error as AuditFailed;
            expect(failed.errorCode).toBe('LIGHTHOUSE_ERROR');
            expect(failed.lighthouseCode).toBe('NO_FCP');
            expect(failed.message).not.toContain(EMAIL);
            expect(String(failed.lighthouseCode)).not.toContain(NAME);
        }
    });

    it('records the main-document HTTP status when the audit still completes', () => {
        const lhr = load('lhr-ok.json');
        const requests = lhr.audits?.['network-requests'];
        if (requests?.details?.items?.[0] && typeof requests.details.items[0] === 'object') {
            (requests.details.items[0] as { statusCode?: number }).statusCode = 404;
        }
        const row = normalizeLighthouseResult({ ...base, categories: [...base.categories], lhr });
        expect(row.status).toBe('ok');
        expect(row.runWarnings).toContain('Main document returned HTTP 404.');
    });
});
