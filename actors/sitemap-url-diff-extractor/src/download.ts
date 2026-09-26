import { Readable } from 'node:stream';

import { HttpClientError, fetchWithRetry, readBody, type ErrorCode } from '@apify-actors/common';

import { requestGapMs, withHostGap } from './hostLock.js';
import { MAX_DOWNLOAD_BYTES, USER_AGENT } from './types.js';

export interface Downloaded {
    status: number;
    finalUrl: string;
    body: Buffer;
    headers: Record<string, string>;
}

export type DownloadFailure = { ok: false; code: ErrorCode; status?: number };
export type DownloadSuccess = { ok: true; result: Downloaded };
export type DownloadOutcome = DownloadSuccess | DownloadFailure;

function mapStatus(status: number): ErrorCode | null {
    if (status === 403) return 'SITEMAP_HTTP_403';
    if (status === 404) return 'SITEMAP_HTTP_404';
    if (status === 410) return 'SITEMAP_HTTP_410';
    if (status === 429) return 'RATE_LIMITED';
    if (status >= 500 && status <= 599) return 'SITEMAP_HTTP_5XX';
    if (status >= 400) return 'SITEMAP_HTTP_ERROR';
    return null;
}

export async function download(url: string, timeoutMs: number, logger: { info: (message: string) => void }): Promise<DownloadOutcome> {
    const host = new URL(url).host;
    try {
        return await withHostGap(host, requestGapMs(), async () => {
            const response = await fetchWithRetry(url, {
                timeoutMs,
                retries: 2,
                retryOn: [429, 500],
                respectRetryAfterMaxSeconds: 30,
                userAgent: USER_AGENT,
                maxRedirects: 5,
                logger,
            });
            const mapped = mapStatus(response.status);
            if (mapped) {
                response.body.destroy();
                return { ok: false, code: mapped, status: response.status };
            }
            try {
                const body = await readBody(response.body, MAX_DOWNLOAD_BYTES);
                return { ok: true, result: { status: response.status, finalUrl: response.finalUrl, body, headers: response.headers } };
            } catch (error) {
                const code = (error as { code?: string }).code === 'SITEMAP_TOO_LARGE' ? 'SITEMAP_TOO_LARGE' : 'CONNECTION_ERROR';
                return { ok: false, code };
            }
        });
    } catch (error) {
        if (error instanceof HttpClientError) {
            const code: ErrorCode = error.code === 'RATE_LIMITED'
                ? 'RATE_LIMITED'
                : error.code === 'REDIRECT_LOOP'
                    ? 'REDIRECT_LOOP'
                    : error.code === 'TIMEOUT'
                        ? 'TIMEOUT'
                        : error.code === 'DNS_ERROR'
                            ? 'DNS_ERROR'
                            : 'CONNECTION_ERROR';
            return { ok: false, code, status: error.status };
        }
        return { ok: false, code: 'CONNECTION_ERROR' };
    }
}

export function destroyQuietly(stream: Readable): void {
    stream.destroy();
}
