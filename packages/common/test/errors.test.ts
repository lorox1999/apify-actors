import { describe, expect, it } from 'vitest';

import { ERROR_CODES, errorMessage, makeErrorRow } from '../src/errors.js';

describe('errors', () => {
    it('lists the sitemap failure codes', () => {
        for (const code of ['NO_SITEMAP_FOUND', 'SITEMAP_HTTP_403', 'SITEMAP_PARSE_ERROR', 'GZIP_ERROR', 'REDIRECT_LOOP', 'CHARGE_LIMIT_REACHED'] as const) {
            expect(ERROR_CODES).toContain(code);
        }
    });

    it('uses a fixed template and never echoes a response body', () => {
        const row = makeErrorRow({ site: 'https://example.com', url: 'https://example.com/sitemap.xml' }, 'SITEMAP_PARSE_ERROR');
        expect(row.errorMessage).toBe(errorMessage('SITEMAP_PARSE_ERROR'));
        expect(row.errorMessage).not.toContain('<html');
        expect(row.errorMessage).not.toContain('Set-Cookie');
    });

    it('marks the row as a free error record', () => {
        const row = makeErrorRow({ site: 'https://example.com' }, 'TIMEOUT');
        expect(row.recordType).toBe('error');
        expect(row.errorCode).toBe('TIMEOUT');
        expect(row.url).toBeNull();
        expect(row.extractedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('keeps a caller-supplied timestamp and url', () => {
        const row = makeErrorRow({ site: 'https://example.com', url: 'https://example.com/a', extractedAt: '2026-09-26T00:00:00.000Z' }, 'DNS_ERROR');
        expect(row.url).toBe('https://example.com/a');
        expect(row.extractedAt).toBe('2026-09-26T00:00:00.000Z');
    });

    it('has a template for every code', () => {
        for (const code of ERROR_CODES) {
            expect(errorMessage(code).length).toBeGreaterThan(5);
        }
    });

    it('explains 403 without suggesting a bypass', () => {
        expect(errorMessage('SITEMAP_HTTP_403').toLowerCase()).toContain('403');
        expect(errorMessage('BLOCKED_BY_ROBOTS').toLowerCase()).toContain('robots.txt');
    });
});
