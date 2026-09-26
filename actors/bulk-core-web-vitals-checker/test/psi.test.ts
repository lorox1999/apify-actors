import { readFileSync } from 'node:fs';

import { clearSecrets, registerSecret } from '@apify-actors/common';
import { describe, expect, it } from 'vitest';

import { AuditFailed } from '../src/failures.js';
import { normalizeLighthouseResult } from '../src/normalize.js';
import { buildPsiUrl, classifyPsiHttpError, clsFromPsi, parsePsiBody, runPsi } from '../src/psi.js';
import type { LhrLike } from '../src/types.js';

const SECRET = 'TEST_SECRET_123';

describe('PageSpeed Insights parsing', () => {
    it('reads CrUX field data and converts scaled CLS', () => {
        const body = JSON.parse(readFileSync(new URL('fixtures/psi-field.json', import.meta.url), 'utf8')) as unknown;
        const parsed = parsePsiBody(body);
        expect(parsed.field.fieldDataAvailable).toBe(true);
        expect(parsed.field.fieldLcpP75Ms).toBe(2100);
        expect(parsed.field.fieldInpP75Ms).toBe(180);
        expect(parsed.field.fieldClsP75).toBe(0.05);
        expect(parsed.field.fieldOverallCategory).toBe('FAST');
        expect(parsed.field.originFallback).toBe(true);
        expect(clsFromPsi({ percentile: 0.05, distributions: [{ max: 0.25 }] })).toBe(0.05);
    });

    it('builds a runPagespeed URL and classifies key and rate-limit errors without echoing the body', () => {
        const url = buildPsiUrl({ pageUrl: 'https://example.com', strategy: 'mobile', categories: ['performance', 'seo'], apiKey: SECRET });
        expect(url).toContain('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
        expect(url).toContain('strategy=mobile');
        expect(url).toContain(SECRET);
        expect(classifyPsiHttpError(400, 'API key not valid. Please pass a valid API key.')).toBe('PSI_KEY_INVALID');
        expect(classifyPsiHttpError(429, 'Rate Limit Exceeded')).toBe('PSI_RATE_LIMITED');
        expect(classifyPsiHttpError(500, `boom ${SECRET}`)).toBe('PSI_ERROR');
    });

    it('backs off three times on HTTP 429 and then records PSI_RATE_LIMITED', async () => {
        const waits: number[] = [];
        let calls = 0;
        await expect(runPsi({
            pageUrl: 'https://example.com',
            strategy: 'desktop',
            categories: ['performance'],
            apiKey: SECRET,
            timeoutMs: 1000,
            sleep: async (ms) => {
                waits.push(ms);
            },
            fetchImpl: async () => new Response('Rate Limit Exceeded', { status: 429 }),
        })).rejects.toMatchObject({ errorCode: 'PSI_RATE_LIMITED' });
        expect(waits).toEqual([1000, 2000, 4000]);
        calls = waits.length;
        expect(calls).toBe(3);
    });

    it('stops with PSI_KEY_INVALID and redacts the key from logs', async () => {
        registerSecret(SECRET);
        const lines: string[] = [];
        try {
            await expect(runPsi({
                pageUrl: 'https://example.com',
                strategy: 'mobile',
                categories: ['performance'],
                apiKey: SECRET,
                timeoutMs: 1000,
                sleep: async () => undefined,
                logger: { info: (message) => lines.push(message), warning: (message) => lines.push(message) },
                fetchImpl: async (input) => {
                    throw new Error(`request failed ${SECRET} ${String(input)}`);
                },
            })).rejects.toMatchObject({ errorCode: 'PSI_ERROR' });
            expect(lines.join('\n')).not.toContain(SECRET);
        } finally {
            clearSecrets();
        }
    });

    it('rejects an invalid key without retrying', async () => {
        let calls = 0;
        await expect(runPsi({
            pageUrl: 'https://example.com',
            strategy: 'mobile',
            categories: ['performance'],
            apiKey: SECRET,
            timeoutMs: 1000,
            sleep: async () => undefined,
            fetchImpl: async () => {
                calls += 1;
                return new Response(JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }), { status: 400 });
            },
        })).rejects.toMatchObject({ errorCode: 'PSI_KEY_INVALID' });
        expect(calls).toBe(1);
    });

    it('normalizes a PSI payload into field columns', () => {
        const body = JSON.parse(readFileSync(new URL('fixtures/psi-field.json', import.meta.url), 'utf8')) as { lighthouseResult: LhrLike };
        const parsed = parsePsiBody(body);
        const row = normalizeLighthouseResult({
            lhr: parsed.lhr ?? {},
            url: 'https://example.com/',
            strategy: 'mobile',
            engine: 'psi',
            categories: ['performance', 'accessibility', 'best-practices', 'seo'],
            maxOpportunities: 5,
            auditDurationMs: 1000,
            auditedAt: '2026-09-26T00:00:00.000Z',
            field: parsed.field,
        });
        expect(row.engine).toBe('psi');
        expect(row.fieldDataAvailable).toBe(true);
        expect(row.fieldClsP75).toBe(0.05);
        expect(row.runWarnings).toContain('Field data is origin-level, not specific to this URL.');
    });
});

describe('PSI fetch attempt count', () => {
    it('calls Google four times when every attempt is rate limited', async () => {
        let calls = 0;
        await expect(runPsi({
            pageUrl: 'https://example.com',
            strategy: 'mobile',
            categories: ['seo'],
            apiKey: 'not-logged',
            timeoutMs: 50,
            sleep: async () => undefined,
            fetchImpl: async () => {
                calls += 1;
                return new Response('{}', { status: 429 });
            },
        })).rejects.toBeInstanceOf(AuditFailed);
        expect(calls).toBe(4);
    });
});
