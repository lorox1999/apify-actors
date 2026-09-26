import { isPrivateHost } from '@apify-actors/common';

import { AuditFailed } from './failures.js';
import { privateHostsAllowed } from './input.js';
import { USER_AGENT } from './types.js';

const PRECHECK_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

export interface PrecheckOk {
    ok: true;
    status: number;
    finalUrl: string;
}

function networkFailure(error: unknown): AuditFailed {
    const err = error as { name?: string; code?: string; cause?: { code?: string; name?: string } };
    const code = err.cause?.code ?? err.code ?? '';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') {
        return new AuditFailed('DNS_ERROR');
    }
    return new AuditFailed('UNREACHABLE');
}

function assertPublic(url: string): void {
    let hostname = '';
    try {
        hostname = new URL(url).hostname;
    } catch {
        throw new AuditFailed('INVALID_URL', { messageOverride: 'Only http and https URLs can be audited.' });
    }
    if (!privateHostsAllowed() && isPrivateHost(hostname)) {
        throw new AuditFailed('INVALID_URL', { messageOverride: 'Private or local network hosts are not allowed.' });
    }
}

async function requestOnce(url: string, method: string, fetchImpl: typeof fetch): Promise<{ status: number; headers: Headers; body: ReadableStream<Uint8Array> | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PRECHECK_TIMEOUT_MS);
    try {
        const response = await fetchImpl(url, {
            method,
            redirect: 'manual',
            signal: controller.signal,
            headers: { 'user-agent': USER_AGENT, accept: '*/*' },
        });
        return { status: response.status, headers: response.headers, body: response.body };
    } catch (error) {
        const name = (error as { name?: string }).name;
        if (name === 'AbortError' || name === 'TimeoutError') throw new AuditFailed('UNREACHABLE');
        throw networkFailure(error);
    } finally {
        clearTimeout(timer);
    }
}

async function follow(url: string, method: string, fetchImpl: typeof fetch): Promise<{ status: number; finalUrl: string }> {
    const seen = new Set<string>();
    let current = url;
    let currentMethod = method;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        assertPublic(current);
        if (seen.has(current)) throw new AuditFailed('UNREACHABLE');
        seen.add(current);
        const response = await requestOnce(current, currentMethod, fetchImpl);
        await response.body?.cancel().catch(() => undefined);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location || hop === MAX_REDIRECTS) throw new AuditFailed('UNREACHABLE');
            current = new URL(location, current).href;
            if (response.status === 303) currentMethod = 'GET';
            continue;
        }
        return { status: response.status, finalUrl: current };
    }
    throw new AuditFailed('UNREACHABLE');
}

export async function precheckUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<PrecheckOk> {
    try {
        let result = await follow(url, 'HEAD', fetchImpl);
        if (result.status === 405 || result.status === 501) {
            result = await follow(url, 'GET', fetchImpl);
        }
        if (result.status >= 400 && result.status <= 499) {
            throw new AuditFailed('HTTP_4XX_PRECHECK', { httpStatus: result.status });
        }
        if (result.status >= 500 && result.status <= 599) {
            throw new AuditFailed('HTTP_5XX_PRECHECK', { httpStatus: result.status });
        }
        return { ok: true, status: result.status, finalUrl: result.finalUrl };
    } catch (error) {
        if (error instanceof AuditFailed) throw error;
        throw networkFailure(error);
    }
}
