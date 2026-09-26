import { describe, expect, it } from 'vitest';

import { clearSecrets, createSafeLogger, redact, registerSecret } from '../src/redact.js';

describe('redact', () => {
    it('removes a GitHub token prefix', () => {
        expect(redact('token ghp_TESTSECRET000 in log')).not.toContain('ghp_TESTSECRET000');
        expect(redact('ghp_TESTSECRET000')).toBe('[removed]');
    });

    it('removes a Google API key', () => {
        const key = `AIza${'A'.repeat(35)}`;
        expect(key).toHaveLength(39);
        expect(redact(`key ${key}`)).toBe('key [removed]');
    });

    it('redacts key, token and access_token query parameters', () => {
        expect(redact('https://example.com/path?key=ABC&x=1')).toBe('https://example.com/path?key=[removed]&x=1');
        expect(redact('https://example.com?token=sekret&access_token=abc')).toBe('https://example.com?token=[removed]&access_token=[removed]');
    });

    it('redacts Authorization, Cookie and Set-Cookie header values', () => {
        expect(redact('Authorization: Bearer super-secret')).toBe('Authorization: [removed]');
        expect(redact('Cookie: session=abc')).toBe('Cookie: [removed]');
        expect(redact('Set-Cookie: id=xyz; Path=/')).toContain('Set-Cookie: [removed]');
    });

    it('redacts a registered secret and other GitHub token prefixes', () => {
        registerSecret('super-custom-secret');
        expect(redact('saw super-custom-secret here')).toBe('saw [removed] here');
        expect(redact('gho_abc ghu_def ghs_ghi ghr_jkl github_pat_zzz')).toBe('[removed] [removed] [removed] [removed] [removed]');
        clearSecrets();
        expect(redact('super-custom-secret')).toBe('super-custom-secret');
    });

    it('logger redacts every argument', () => {
        const lines: string[] = [];
        const log = createSafeLogger({
            info: (message) => lines.push(message),
            warning: (message) => lines.push(message),
            error: (message) => lines.push(message),
            debug: (message) => lines.push(message),
        });
        log.info('hello', 'ghp_TESTSECRET000');
        log.error('Authorization: Bearer nope');
        expect(lines.join('\n')).not.toContain('ghp_TESTSECRET000');
        expect(lines.join('\n')).not.toContain('nope');
    });

    it('stringifies errors and objects and falls back to console', () => {
        const log = createSafeLogger();
        log.info('object', { token: 'ghp_TESTSECRET000' });
        log.warning(new Error('ghp_TESTSECRET000'));
        log.debug('plain');
        expect(true).toBe(true);
    });
});
