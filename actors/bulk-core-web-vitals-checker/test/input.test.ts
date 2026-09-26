import { errorMessage } from '@apify-actors/common';
import { describe, expect, it } from 'vitest';

import { FatalInputError } from '../src/fatal.js';
import { checkUrl, resolveInput } from '../src/input.js';
import { describeFailure, AuditFailed } from '../src/failures.js';
import { errorRow } from '../src/rows.js';
import { ROW_KEYS } from '../src/types.js';

describe('input validation', () => {
    it('fails the run when no URLs and no dataset are provided', () => {
        expect(() => resolveInput(null)).toThrow(FatalInputError);
        expect(() => resolveInput({ urls: ['  '] })).toThrow(errorMessage('NO_URLS'));
    });

    it('fails when PageSpeed Insights mode has no key', () => {
        expect(() => resolveInput({ urls: ['https://example.com'], engine: 'psi' })).toThrow(errorMessage('PSI_KEY_MISSING'));
    });

    it('rejects credentials, non-http URLs and private hosts', () => {
        const previous = process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS;
        delete process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS;
        try {
            const secret = checkUrl('https://user:s3cret@example.com/a');
            expect(secret.ok).toBe(false);
            if (!secret.ok) {
                expect(secret.url).not.toContain('s3cret');
                expect(secret.message).toContain('password');
            }
            expect(checkUrl('ftp://example.com').ok).toBe(false);
            const local = checkUrl('http://127.0.0.1/page');
            expect(local.ok).toBe(false);
            if (!local.ok) expect(local.message).toContain('Private');
            expect(checkUrl('https://example.com/a#frag')).toEqual({ ok: true, url: 'https://example.com/a' });
        } finally {
            if (previous === undefined) delete process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS;
            else process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = previous;
        }
    });

    it('caps list size, devices and timeouts', () => {
        const input = resolveInput({
            urls: ['https://example.com', 'https://example.org'],
            strategy: 'both',
            maxUrls: 1,
            perUrlTimeoutSecs: 5,
            retries: 9,
            maxOpportunities: 100,
            categories: ['seo', 'nope'],
        });
        expect(input.maxUrls).toBe(1);
        expect(input.devices).toEqual(['mobile', 'desktop']);
        expect(input.perUrlTimeoutSecs).toBe(20);
        expect(input.retries).toBe(2);
        expect(input.maxOpportunities).toBe(20);
        expect(input.categories).toEqual(['seo']);
        expect(input.engine).toBe('local');
        expect(input.precheckReachability).toBe(true);
    });
});

describe('error rows', () => {
    it('marks failed audits free and keeps the whitelist', () => {
        const row = errorRow({
            url: 'https://user:s3cret@example.com/',
            strategy: 'desktop',
            engine: 'local',
            errorCode: 'TIMEOUT',
            errorMessage: describeFailure(new AuditFailed('TIMEOUT', { timeoutSecs: 60 })),
            auditedAt: '2026-09-26T03:50:00.000Z',
        });
        expect(row.status).toBe('error');
        expect(row.charged).toBe(false);
        expect(row.errorCode).toBe('TIMEOUT');
        expect(row.errorMessage).toBe('Audit exceeded 60 s.');
        expect(row.performanceScore).toBeNull();
        expect(JSON.stringify(row)).not.toContain('s3cret');
        expect(Object.keys(row).sort()).toEqual([...ROW_KEYS].sort());
    });

    it('names HTTP, Chrome and robots failures specifically', () => {
        expect(describeFailure(new AuditFailed('HTTP_4XX_PRECHECK', { httpStatus: 403 }))).toContain('403');
        expect(describeFailure(new AuditFailed('HTTP_4XX_PRECHECK', { httpStatus: 403 })).toLowerCase()).toContain('not bypassed');
        expect(describeFailure(new AuditFailed('HTTP_5XX_PRECHECK', { httpStatus: 503 }))).toContain('503');
        expect(describeFailure(new AuditFailed('CHROME_CRASH'))).toContain('Chrome');
        expect(describeFailure(new AuditFailed('BLOCKED_BY_ROBOTS')).toLowerCase()).toContain('robots.txt');
        expect(describeFailure(new AuditFailed('DNS_ERROR'))).toContain('DNS');
        expect(describeFailure(new AuditFailed('LIGHTHOUSE_ERROR', { lighthouseCode: 'NO_FCP' }))).toContain('NO_FCP');
    });
});
