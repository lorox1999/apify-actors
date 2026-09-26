import { Readable } from 'node:stream';

import { redact } from './redact.js';

export interface FetchWithRetryOptions {
    timeoutMs: number;
    /** Retries after the first attempt for network errors and 5xx. */
    retries: number;
    retryOn?: number[];
    respectRetryAfterMaxSeconds?: number;
    userAgent: string;
    method?: string;
    /** Extra headers. Values are never logged. */
    headers?: Record<string, string>;
    maxRedirects?: number;
    logger?: { info: (message: string) => void };
}

export interface FetchResult {
    status: number;
    headers: Record<string, string>;
    body: Readable;
    finalUrl: string;
}

export class HttpClientError extends Error {
    readonly code: 'DNS_ERROR' | 'CONNECTION_ERROR' | 'TIMEOUT' | 'REDIRECT_LOOP' | 'RATE_LIMITED';
    readonly url: string;
    readonly status?: number;

    constructor(code: HttpClientError['code'], url: string, status?: number) {
        super(`${code} for ${url}`);
        this.name = 'HttpClientError';
        this.code = code;
        this.url = url;
        this.status = status;
    }
}

function headerMap(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
        out[key.toLowerCase()] = value;
    });
    return out;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseRetryAfterSeconds(value: string | null, maxSeconds: number): number {
    if (!value) return 1;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return Math.min(maxSeconds, Math.max(0, asNumber));
    const date = Date.parse(value);
    if (Number.isNaN(date)) return 1;
    return Math.min(maxSeconds, Math.max(0, Math.ceil((date - Date.now()) / 1000)));
}

function classifyNetworkError(error: unknown): HttpClientError['code'] {
    const err = error as { name?: string; code?: string; cause?: { code?: string; name?: string } };
    const code = err.cause?.code ?? err.code ?? '';
    const name = err.name ?? err.cause?.name ?? '';
    if (name === 'AbortError' || name === 'TimeoutError' || code === 'ABORT_ERR' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') {
        return 'TIMEOUT';
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') return 'DNS_ERROR';
    return 'CONNECTION_ERROR';
}

async function fetchOnce(url: string, options: FetchWithRetryOptions, method: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
        return await fetch(url, {
            method,
            redirect: 'manual',
            signal: controller.signal,
            headers: {
                'user-agent': options.userAgent,
                accept: '*/*',
                ...options.headers,
            },
        });
    } finally {
        clearTimeout(timer);
    }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function fetchFollowingRedirects(url: string, options: FetchWithRetryOptions, method: string): Promise<{ response: Response; finalUrl: string }> {
    const maxRedirects = options.maxRedirects ?? 5;
    const seen = new Set<string>();
    let current = url;
    let currentMethod = method;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
        if (seen.has(current)) {
            throw new HttpClientError('REDIRECT_LOOP', redact(current));
        }
        seen.add(current);
        const response = await fetchOnce(current, options, currentMethod);
        if (REDIRECT_STATUSES.has(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel().catch(() => undefined);
            if (!location || hop === maxRedirects) {
                throw new HttpClientError('REDIRECT_LOOP', redact(current), response.status);
            }
            current = new URL(location, current).href;
            if (response.status === 303) currentMethod = 'GET';
            continue;
        }
        return { response, finalUrl: current };
    }
    throw new HttpClientError('REDIRECT_LOOP', redact(current));
}

function shouldRetryStatus(status: number, retryOn: number[]): boolean {
    if (retryOn.includes(status)) return true;
    if (retryOn.includes(500) && status >= 500 && status <= 599) return true;
    return false;
}

export async function fetchWithRetry(url: string, options: FetchWithRetryOptions): Promise<FetchResult> {
    const retryOn = options.retryOn ?? [429, 500];
    const maxRetryAfter = options.respectRetryAfterMaxSeconds ?? 30;
    const method = options.method ?? 'GET';
    let attempt = 0;
    let rateLimitRetries = 0;
    const safeUrl = redact(url);

    for (;;) {
        try {
            const { response, finalUrl } = await fetchFollowingRedirects(url, options, method);
            if (response.status === 429 && rateLimitRetries < 1 && (retryOn.includes(429) || retryOn.includes(500))) {
                const waitSec = parseRetryAfterSeconds(response.headers.get('retry-after'), maxRetryAfter);
                options.logger?.info(`HTTP 429, waiting ${waitSec}s before one retry`);
                await response.body?.cancel().catch(() => undefined);
                rateLimitRetries += 1;
                await sleep(waitSec * 1000);
                continue;
            }
            if (response.status === 429 && rateLimitRetries >= 1) {
                await response.body?.cancel().catch(() => undefined);
                throw new HttpClientError('RATE_LIMITED', redact(finalUrl), 429);
            }
            if (shouldRetryStatus(response.status, retryOn.filter((code) => code !== 429)) && attempt < options.retries) {
                await response.body?.cancel().catch(() => undefined);
                attempt += 1;
                await sleep(100 * 2 ** (attempt - 1));
                continue;
            }
            const body = response.body
                ? Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
                : Readable.from([]);
            return {
                status: response.status,
                headers: headerMap(response.headers),
                body,
                finalUrl,
            };
        } catch (error) {
            if (error instanceof HttpClientError && (error.code === 'REDIRECT_LOOP' || error.code === 'RATE_LIMITED')) {
                throw error;
            }
            const code = error instanceof HttpClientError ? error.code : classifyNetworkError(error);
            if (attempt < options.retries && (code === 'TIMEOUT' || code === 'DNS_ERROR' || code === 'CONNECTION_ERROR')) {
                attempt += 1;
                await sleep(100 * 2 ** (attempt - 1));
                continue;
            }
            if (error instanceof HttpClientError) throw error;
            throw new HttpClientError(code, safeUrl);
        }
    }
}

export async function readBody(stream: Readable, maxBytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > maxBytes) {
            stream.destroy();
            const error = new Error('SITEMAP_TOO_LARGE');
            (error as { code?: string }).code = 'SITEMAP_TOO_LARGE';
            throw error;
        }
        chunks.push(buf);
    }
    return Buffer.concat(chunks);
}
