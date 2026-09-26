import { describe, expect, it } from 'vitest';

import {
    classifyHttpStatus,
    classifyNetworkFailure,
    classifyRedirectProblem,
    classifySkip,
    classifyThrown,
} from '../src/link-classify.js';

describe('classifyHttpStatus', () => {
    it('marks 2xx without redirects as ok and with redirects as redirect', () => {
        expect(classifyHttpStatus(200, {}, 0)).toMatchObject({ checkStatus: 'ok', errorCode: null, billable: true });
        expect(classifyHttpStatus(204, {}, 0).checkStatus).toBe('ok');
        expect(classifyHttpStatus(200, {}, 2)).toMatchObject({ checkStatus: 'redirect', billable: true });
    });

    it('covers the HTTP failure table', () => {
        expect(classifyHttpStatus(404, {}, 0)).toMatchObject({ checkStatus: 'broken', errorCode: 'HTTP_404_NOT_FOUND', billable: true });
        expect(classifyHttpStatus(410, {}, 0)).toMatchObject({ checkStatus: 'broken', errorCode: 'HTTP_410_GONE', billable: true });
        expect(classifyHttpStatus(400, {}, 0)).toMatchObject({ checkStatus: 'broken', errorCode: 'HTTP_4XX', billable: true });
        expect(classifyHttpStatus(405, {}, 0)).toMatchObject({ errorCode: 'HTTP_4XX', billable: true });
        expect(classifyHttpStatus(422, {}, 0).errorCode).toBe('HTTP_4XX');
        expect(classifyHttpStatus(500, {}, 0)).toMatchObject({ checkStatus: 'broken', errorCode: 'HTTP_5XX', billable: true });
        expect(classifyHttpStatus(503, {}, 0).errorCode).toBe('HTTP_5XX');
        expect(classifyHttpStatus(401, {}, 0)).toMatchObject({ checkStatus: 'restricted', errorCode: 'HTTP_401_UNAUTHORIZED', billable: true });
        expect(classifyHttpStatus(403, {}, 0)).toMatchObject({ checkStatus: 'restricted', errorCode: 'HTTP_403_FORBIDDEN', billable: true });
        expect(classifyHttpStatus(407, {}, 0).errorCode).toBe('HTTP_407_PROXY_AUTH');
        expect(classifyHttpStatus(451, {}, 0).errorCode).toBe('HTTP_451_LEGAL');
        expect(classifyHttpStatus(429, {}, 0)).toMatchObject({ checkStatus: 'unverified', errorCode: 'RATE_LIMITED', billable: false });
        expect(classifyHttpStatus(999, {}, 0)).toMatchObject({ checkStatus: 'unverified', errorCode: 'BOT_PROTECTION', billable: false });
        expect(classifyHttpStatus(403, { 'cf-mitigated': 'challenge' }, 0)).toMatchObject({ errorCode: 'BOT_PROTECTION', billable: false });
        expect(classifyHttpStatus(503, { 'cf-mitigated': 'challenge' }, 0).errorCode).toBe('BOT_PROTECTION');
        expect(classifyHttpStatus(100, {}, 0)).toMatchObject({ checkStatus: 'unverified', errorCode: 'UNEXPECTED_STATUS', billable: false });
        expect(classifyHttpStatus(600, {}, 0).errorCode).toBe('UNEXPECTED_STATUS');
    });
});

describe('classifyThrown', () => {
    it('splits DNS, refusal, reset, timeout and TLS', () => {
        expect(classifyThrown(Object.assign(new Error('nope'), { code: 'ENOTFOUND' })).code).toBe('DNS_NOT_FOUND');
        expect(classifyThrown(Object.assign(new Error('tmp'), { code: 'EAI_AGAIN' }))).toMatchObject({
            code: 'DNS_TEMPORARY_FAILURE',
            retryable: true,
            headFallback: true,
        });
        expect(classifyThrown(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))).toMatchObject({
            code: 'CONNECTION_REFUSED',
            retryable: false,
            headFallback: false,
        });
        expect(classifyThrown(Object.assign(new Error('reset'), { code: 'ECONNRESET' })).code).toBe('CONNECTION_RESET');
        expect(classifyThrown(new Error('socket hang up')).code).toBe('CONNECTION_RESET');
        expect(classifyThrown(Object.assign(new Error('t'), { code: 'UND_ERR_CONNECT_TIMEOUT' }))).toMatchObject({
            code: 'TIMEOUT',
            detail: 'connect',
        });
        expect(classifyThrown(Object.assign(new Error('t'), { code: 'UND_ERR_HEADERS_TIMEOUT' })).detail).toBe('headers');
        const tls = classifyThrown(Object.assign(new Error('self signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT', cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } }));
        expect(tls.code).toBe('TLS_ERROR');
        expect(tls.detail).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
        expect(classifyNetworkFailure(tls)).toMatchObject({ checkStatus: 'broken', errorCode: 'TLS_ERROR', billable: true });
    });

    it('does not offer HEAD fallback for DNS-not-found or connection refused', () => {
        expect(classifyThrown(Object.assign(new Error('x'), { code: 'ENOTFOUND' })).headFallback).toBe(false);
        expect(classifyThrown(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })).headFallback).toBe(false);
    });
});

describe('redirect and skip classification', () => {
    it('bills redirect failures except a non-http scheme', () => {
        expect(classifyRedirectProblem('REDIRECT_LOOP')).toMatchObject({ checkStatus: 'broken', billable: true });
        expect(classifyRedirectProblem('TOO_MANY_REDIRECTS').billable).toBe(true);
        expect(classifyRedirectProblem('INVALID_REDIRECT').billable).toBe(true);
        expect(classifyRedirectProblem('UNSUPPORTED_REDIRECT_SCHEME')).toMatchObject({ checkStatus: 'unverified', billable: false });
    });

    it('does not bill skips, and treats a robots 5xx as unverified', () => {
        expect(classifySkip('BLOCKED_BY_ROBOTS')).toMatchObject({ checkStatus: 'skipped', billable: false });
        expect(classifySkip('PRIVATE_HOST').checkStatus).toBe('skipped');
        expect(classifySkip('INVALID_URL').checkStatus).toBe('skipped');
        expect(classifySkip('ROBOTS_UNREACHABLE')).toMatchObject({ checkStatus: 'unverified', billable: false });
    });
});
