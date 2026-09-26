import { HttpClientError, fetchWithRetry, type ErrorCode } from '@apify-actors/common';

import { USER_AGENT } from './types.js';

export type StatusOutcome =
    | { ok: true; httpStatus: number; finalUrl: string }
    | { ok: false; code: ErrorCode };

async function request(url: string, method: 'HEAD' | 'GET', timeoutMs: number): Promise<{ status: number; finalUrl: string }> {
    const response = await fetchWithRetry(url, {
        timeoutMs,
        retries: 0,
        retryOn: [],
        userAgent: USER_AGENT,
        method,
        maxRedirects: 5,
    });
    response.body.destroy();
    return { status: response.status, finalUrl: response.finalUrl };
}

export async function checkHttpStatus(url: string, timeoutMs: number): Promise<StatusOutcome> {
    try {
        const head = await request(url, 'HEAD', timeoutMs);
        if (head.status === 405 || head.status === 501) {
            const get = await request(url, 'GET', timeoutMs);
            return { ok: true, httpStatus: get.status, finalUrl: get.finalUrl };
        }
        return { ok: true, httpStatus: head.status, finalUrl: head.finalUrl };
    } catch (error) {
        if (error instanceof HttpClientError) return { ok: false, code: error.code };
        return { ok: false, code: 'CONNECTION_ERROR' };
    }
}
