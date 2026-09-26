import { performance } from 'node:perf_hooks';

import {
    classifyHttpStatus,
    classifyNetworkFailure,
    classifyRedirectProblem,
    classifySkip,
    classifyThrown,
    redactHttpUrl,
    type LinkClassification,
    type NetworkFailure,
} from '@apify-actors/common';

import { HostScheduler, sleep } from './limiter.js';
import { errorMessage } from './messages.js';
import { hostIsPrivate, retryDelayMs } from './net.js';
import { RobotsCache, type RobotsDecision } from './robots.js';
import { HTML_BYTE_CAP, type Hop } from './types.js';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface CheckedLink {
    url: string;
    classification: LinkClassification;
    statusCode: number | null;
    finalStatusCode: number | null;
    finalUrl: string | null;
    redirectCount: number;
    redirectChain: Hop[] | null;
    responseTimeMs: number | null;
    method: 'HEAD' | 'GET' | null;
    errorDetail: string | null;
    errorMessage: string | null;
    body: Buffer | null;
    truncated: boolean;
    contentType: string | null;
    nofollow: boolean;
    discarded: boolean;
}

export interface Checker {
    check(url: string, options: { readBody: boolean }): Promise<CheckedLink>;
    shutdown(): void;
}

interface Deps {
    scheduler: HostScheduler;
    robots: RobotsCache;
    timeoutMs: number;
    maxRedirects: number;
    useHead: boolean;
    userAgent: string;
    fetchImpl: typeof fetch;
    dispatcher: unknown;
    shutdown: AbortController;
    log: { info: (message: string) => void };
    respectRobots: boolean;
}

function hostnameOf(url: string): string {
    return new URL(url).hostname.toLowerCase();
}

function originOf(url: string): string {
    const parsed = new URL(url);
    return parsed.origin;
}

function cookieHeader(jar: Map<string, string>): string {
    return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function absorbCookies(response: Response, jar: Map<string, string>): void {
    const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    const single = list.length > 0 ? list : [response.headers.get('set-cookie') ?? ''];
    for (const line of single) {
        if (!line) continue;
        const pair = line.split(';')[0] ?? '';
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (name) jar.set(name, value);
    }
}

function headerRecord(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
        out[key.toLowerCase()] = value;
    });
    return out;
}

function nofollowHeader(headers: Record<string, string>): boolean {
    const tag = headers['x-robots-tag'] ?? '';
    return tag.toLowerCase().split(/[,;]/).some((part) => part.trim() === 'nofollow' || part.trim().endsWith('nofollow'));
}

async function readCapped(response: Response, maxBytes: number): Promise<{ body: Buffer; truncated: boolean }> {
    const reader = response.body?.getReader();
    if (!reader) return { body: Buffer.alloc(0), truncated: false };
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
            truncated = true;
            chunks.push(value.subarray(0, Math.max(0, value.byteLength - (total - maxBytes))));
            await reader.cancel().catch(() => undefined);
            break;
        }
        chunks.push(value);
    }
    return { body: Buffer.concat(chunks), truncated };
}

function isHtml(contentType: string | null, body: Buffer | null): boolean {
    if (contentType && /text\/html|application\/xhtml\+xml/i.test(contentType)) return true;
    if (contentType && !/text\/plain/i.test(contentType)) return false;
    if (!body || body.length === 0) return false;
    const start = body.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
    return start.startsWith('<!doctype html') || start.startsWith('<html') || start.startsWith('<head') || start.startsWith('<body');
}

function baseResult(url: string, classification: LinkClassification, extra: Partial<CheckedLink>): CheckedLink {
    return {
        url,
        classification,
        statusCode: null,
        finalStatusCode: null,
        finalUrl: redactHttpUrl(url),
        redirectCount: 0,
        redirectChain: null,
        responseTimeMs: null,
        method: null,
        errorDetail: null,
        errorMessage: errorMessage(classification.errorCode),
        body: null,
        truncated: false,
        contentType: null,
        nofollow: false,
        discarded: false,
        ...extra,
    };
}

async function preflight(
    url: string,
    deps: Deps,
): Promise<{ classification: LinkClassification; failure: NetworkFailure | null; detail: string | null } | null> {
    const host = hostnameOf(url);
    if (await hostIsPrivate(host)) {
        return { classification: classifySkip('PRIVATE_HOST'), failure: null, detail: null };
    }
    const decision: RobotsDecision = await deps.robots.decision(originOf(url), host);
    if (decision.kind === 'unreachable') {
        return { classification: classifySkip('ROBOTS_UNREACHABLE'), failure: null, detail: null };
    }
    if (decision.kind === 'network') {
        return { classification: classifyNetworkFailure(decision.failure), failure: decision.failure, detail: decision.failure.detail };
    }
    if (deps.respectRobots && !decision.isAllowed(url)) {
        return { classification: classifySkip('BLOCKED_BY_ROBOTS'), failure: null, detail: null };
    }
    return null;
}

export function createChecker(deps: Deps): Checker {
    return {
        shutdown() {
            deps.shutdown.abort();
        },
        async check(url, options) {
            const canonical = redactHttpUrl(url) ?? url;
            const blocked = await preflight(canonical, deps);
            if (blocked) {
                return baseResult(canonical, blocked.classification, {
                    errorDetail: blocked.detail,
                    errorMessage: errorMessage(blocked.classification.errorCode),
                });
            }
            // Shifted forward by per-host queue waits so responseTimeMs excludes queueing (spec §5.1).
            let started = performance.now();
            let method: 'HEAD' | 'GET' = options.readBody || !deps.useHead ? 'GET' : 'HEAD';
            let allowHeadFallback = method === 'HEAD';
            let networkRetryLeft = true;
            let rateRetryLeft = true;

            for (let pass = 0; pass < 4; pass += 1) {
                const jar = new Map<string, string>();
                const seen = new Set<string>();
                const chain: Hop[] = [];
                let current = canonical;
                let currentMethod = method;
                let restartFallback = false;
                let fallbackConsumesRetry = false;

                for (let hop = 0; hop < 40; hop += 1) {
                    const signature = `${current}\n${cookieHeader(jar)}`;
                    if (seen.has(signature)) {
                        return finishRedirect(canonical, 'REDIRECT_LOOP', chain, current, started, currentMethod);
                    }
                    seen.add(signature);

                    const hopBlock = await preflight(current, deps);
                    if (hopBlock) {
                        return baseResult(canonical, hopBlock.classification, {
                            redirectChain: chain.length > 0 ? chain : null,
                            redirectCount: chain.filter((item) => item.statusCode >= 300 && item.statusCode < 400).length,
                            method: currentMethod,
                            responseTimeMs: elapsed(started),
                            errorDetail: hopBlock.detail,
                            finalUrl: hopBlock.classification.errorCode === 'UNSUPPORTED_REDIRECT_SCHEME' ? null : redactHttpUrl(current),
                        });
                    }

                    const host = hostnameOf(current);
                    let response: Response;
                    try {
                        const waitStart = performance.now();
                        await deps.scheduler.acquire(host);
                        started += performance.now() - waitStart;
                        try {
                            if (deps.shutdown.signal.aborted) {
                                return baseResult(canonical, classifySkip('BLOCKED_BY_ROBOTS'), { discarded: true, classification: { checkStatus: 'skipped', errorCode: null, billable: false }, errorMessage: null });
                            }
                            const headers: Record<string, string> = {
                                'user-agent': deps.userAgent,
                                accept: options.readBody ? 'text/html,application/xhtml+xml,*/*;q=0.8' : '*/*',
                            };
                            const cookie = cookieHeader(jar);
                            if (cookie) headers.cookie = cookie;
                            response = await deps.fetchImpl(current, {
                                method: currentMethod,
                                redirect: 'manual',
                                headers,
                                dispatcher: deps.dispatcher,
                                headersTimeout: deps.timeoutMs,
                                bodyTimeout: deps.timeoutMs,
                                signal: AbortSignal.any([deps.shutdown.signal, AbortSignal.timeout(deps.timeoutMs + 1000)]),
                            } as RequestInit);
                        } finally {
                            deps.scheduler.release(host);
                        }
                    } catch (error) {
                        if (deps.shutdown.signal.aborted) {
                            return baseResult(canonical, { checkStatus: 'skipped', errorCode: null, billable: false }, {
                                discarded: true,
                                errorMessage: null,
                                method: currentMethod,
                            });
                        }
                        const failure = classifyThrown(error);
                        if (allowHeadFallback && failure.headFallback) {
                            allowHeadFallback = false;
                            method = 'GET';
                            restartFallback = true;
                            fallbackConsumesRetry = failure.retryable;
                            deps.log.info(`HEAD failed (${failure.code}), retrying once with GET`);
                            break;
                        }
                        if (failure.retryable && networkRetryLeft) {
                            networkRetryLeft = false;
                            seen.delete(signature);
                            deps.log.info(`Retrying ${failure.code} once`);
                            await sleep(retryDelayMs());
                            continue;
                        }
                        const classification = classifyNetworkFailure(failure);
                        return baseResult(canonical, classification, {
                            method: currentMethod,
                            responseTimeMs: elapsed(started),
                            errorDetail: failure.detail,
                            redirectChain: chain.length > 0 ? chain : null,
                            redirectCount: chain.filter((item) => item.statusCode >= 300 && item.statusCode < 400).length,
                            errorMessage: errorMessage(classification.errorCode),
                        });
                    }

                    const publicUrl = redactHttpUrl(current) ?? current;
                    chain.push({ url: publicUrl, statusCode: response.status });
                    const headers = headerRecord(response.headers);

                    const bot = response.status === 999 || ((response.status === 403 || response.status === 503) && (headers['cf-mitigated'] ?? '').toLowerCase().includes('challenge'));
                    const retryAfter = !bot && (response.status === 429 || (response.status === 503 && response.headers.has('retry-after')));
                    if (retryAfter) deps.scheduler.pinHostToOne(host);
                    if (retryAfter && rateRetryLeft) {
                        rateRetryLeft = false;
                        seen.delete(signature);
                        chain.pop();
                        const waitSec = parseRetryAfter(response.headers.get('retry-after'));
                        deps.log.info(`HTTP ${response.status}, waiting ${waitSec}s before one retry`);
                        await response.body?.cancel().catch(() => undefined);
                        if (currentMethod === 'HEAD') {
                            currentMethod = 'GET';
                            method = 'GET';
                            allowHeadFallback = false;
                        }
                        await sleep(waitSec * 1000);
                        continue;
                    }

                    if (bot) {
                        await response.body?.cancel().catch(() => undefined);
                        const redirectCount = chain.filter((item) => item.statusCode >= 300 && item.statusCode < 400).length;
                        const classification = classifyHttpStatus(response.status, headers, redirectCount);
                        return baseResult(canonical, classification, {
                            statusCode: chain[0]?.statusCode ?? response.status,
                            finalStatusCode: response.status,
                            finalUrl: publicUrl,
                            redirectCount,
                            redirectChain: redirectCount > 0 ? chain : null,
                            responseTimeMs: elapsed(started),
                            method: currentMethod,
                            errorDetail: String(response.status),
                            errorMessage: errorMessage(classification.errorCode),
                        });
                    }

                    if (REDIRECTS.has(response.status)) {
                        absorbCookies(response, jar);
                        await response.body?.cancel().catch(() => undefined);
                        const redirectCount = chain.filter((item) => item.statusCode >= 300 && item.statusCode < 400).length;
                        if (redirectCount > deps.maxRedirects) {
                            return finishRedirect(canonical, 'TOO_MANY_REDIRECTS', chain, current, started, currentMethod);
                        }
                        const location = response.headers.get('location');
                        if (!location) return finishRedirect(canonical, 'INVALID_REDIRECT', chain, current, started, currentMethod);
                        let next: URL;
                        try {
                            next = new URL(location, current);
                        } catch {
                            return finishRedirect(canonical, 'INVALID_REDIRECT', chain, current, started, currentMethod);
                        }
                        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
                            const classification = classifyRedirectProblem('UNSUPPORTED_REDIRECT_SCHEME');
                            return baseResult(canonical, classification, {
                                statusCode: chain[0]?.statusCode ?? response.status,
                                finalStatusCode: response.status,
                                finalUrl: next.protocol,
                                redirectCount,
                                redirectChain: chain,
                                responseTimeMs: elapsed(started),
                                method: currentMethod,
                                errorMessage: errorMessage(classification.errorCode),
                            });
                        }
                        if (response.status === 303 || response.status === 302) currentMethod = currentMethod === 'HEAD' ? 'HEAD' : 'GET';
                        if (response.status === 303) currentMethod = 'GET';
                        current = next.href;
                        continue;
                    }

                    if (response.status >= 400 && allowHeadFallback) {
                        await response.body?.cancel().catch(() => undefined);
                        allowHeadFallback = false;
                        method = 'GET';
                        restartFallback = true;
                        fallbackConsumesRetry = response.status >= 500 && response.status <= 599;
                        if (fallbackConsumesRetry) {
                            deps.log.info(`HEAD returned ${response.status}, retrying once with GET`);
                            await sleep(retryDelayMs());
                        } else {
                            deps.log.info(`HEAD returned ${response.status}, retrying once with GET`);
                        }
                        break;
                    }

                    if (response.status >= 500 && response.status <= 599 && networkRetryLeft && !retryAfter) {
                        networkRetryLeft = false;
                        seen.delete(signature);
                        chain.pop();
                        deps.log.info(`Retrying HTTP ${response.status} once`);
                        await response.body?.cancel().catch(() => undefined);
                        await sleep(retryDelayMs());
                        continue;
                    }

                    const contentType = response.headers.get('content-type');
                    let body: Buffer | null = null;
                    let truncated = false;
                    if (options.readBody && response.status >= 200 && response.status < 300) {
                        const read = await readCapped(response, HTML_BYTE_CAP);
                        body = read.body;
                        truncated = read.truncated;
                    } else {
                        await response.body?.cancel().catch(() => undefined);
                    }
                    const redirectCount = chain.filter((item) => item.statusCode >= 300 && item.statusCode < 400).length;
                    const classification = classifyHttpStatus(response.status, headers, redirectCount);
                    const pageNofollow = nofollowHeader(headers) || (body ? /<meta[^>]+name=["']robots["'][^>]+nofollow/i.test(body.toString('utf8')) : false);
                    return baseResult(canonical, classification, {
                        statusCode: chain[0]?.statusCode ?? response.status,
                        finalStatusCode: response.status,
                        finalUrl: publicUrl,
                        redirectCount,
                        redirectChain: redirectCount > 0 ? chain : chain.length > 1 ? chain : null,
                        responseTimeMs: elapsed(started),
                        method: currentMethod,
                        errorDetail: classification.errorCode ? String(response.status) : null,
                        errorMessage: errorMessage(classification.errorCode),
                        body: body && isHtml(contentType, body) ? body : body && options.readBody && isHtml(contentType, body) ? body : isHtml(contentType, body) ? body : null,
                        truncated,
                        contentType,
                        nofollow: pageNofollow,
                    });
                }

                if (!restartFallback) break;
                if (fallbackConsumesRetry) networkRetryLeft = false;
                if (pass > 0 && method === 'GET') break;
            }

            return baseResult(canonical, classifyNetworkFailure({ code: 'CONNECTION_ERROR', detail: null, retryable: false, headFallback: false }), {
                responseTimeMs: elapsed(started),
                method,
                errorMessage: errorMessage('CONNECTION_ERROR'),
            });
        },
    };
}

function elapsed(started: number): number {
    return Math.max(1, Math.round(performance.now() - started));
}

function parseRetryAfter(value: string | null): number {
    if (!value) return 1;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return Math.min(30, Math.max(0, asNumber));
    const date = Date.parse(value);
    if (Number.isNaN(date)) return 1;
    return Math.min(30, Math.max(0, Math.ceil((date - Date.now()) / 1000)));
}

function finishRedirect(
    original: string,
    code: 'REDIRECT_LOOP' | 'TOO_MANY_REDIRECTS' | 'INVALID_REDIRECT',
    chain: Hop[],
    current: string,
    started: number,
    method: 'HEAD' | 'GET',
): CheckedLink {
    const classification = classifyRedirectProblem(code);
    const redirectCount = chain.filter((item) => item.statusCode >= 300 && item.statusCode < 400).length;
    return baseResult(original, classification, {
        statusCode: chain[0]?.statusCode ?? null,
        finalStatusCode: chain[chain.length - 1]?.statusCode ?? null,
        finalUrl: redactHttpUrl(current),
        redirectCount,
        redirectChain: chain,
        responseTimeMs: elapsed(started),
        method,
        errorDetail: code,
        errorMessage: errorMessage(classification.errorCode),
    });
}

export function looksLikeHtml(contentType: string | null, body: Buffer | null): boolean {
    return isHtml(contentType, body);
}
