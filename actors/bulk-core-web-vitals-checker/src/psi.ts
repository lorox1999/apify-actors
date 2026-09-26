import { redact } from '@apify-actors/common';

import { AuditFailed } from './failures.js';
import type { FieldData, LhrLike } from './types.js';

const BACKOFF_MS = [1000, 2000, 4000];

export interface PsiSuccess {
    lhr: LhrLike;
    field: FieldData;
}

interface PsiMetric {
    percentile?: number;
    distributions?: { max?: number }[];
}

function percentileMs(metric: PsiMetric | undefined): number | null {
    if (!metric || typeof metric.percentile !== 'number' || !Number.isFinite(metric.percentile)) return null;
    return Math.round(metric.percentile);
}

/** PSI has shipped CLS both as a raw decimal and as a value × 100. Distribution bounds show which. */
export function clsFromPsi(metric: PsiMetric | undefined): number | null {
    if (!metric || typeof metric.percentile !== 'number' || !Number.isFinite(metric.percentile)) return null;
    const bounds = (metric.distributions ?? []).map((item) => item.max).filter((value): value is number => typeof value === 'number');
    const scaled = bounds.some((max) => max >= 1) || metric.percentile > 1;
    const value = scaled ? metric.percentile / 100 : metric.percentile;
    return Number(value.toFixed(4));
}

function cleanCategory(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(trimmed)) return null;
    return trimmed;
}

export function parseFieldData(loadingExperience: unknown): FieldData {
    const experience = (loadingExperience ?? null) as {
        metrics?: Record<string, PsiMetric | undefined>;
        overall_category?: string;
        origin_fallback?: boolean;
    } | null;
    const metrics = experience?.metrics ?? {};
    const available = Object.keys(metrics).length > 0;
    if (!available) {
        return {
            fieldDataAvailable: false,
            fieldLcpP75Ms: null,
            fieldInpP75Ms: null,
            fieldClsP75: null,
            fieldOverallCategory: null,
            originFallback: false,
        };
    }
    return {
        fieldDataAvailable: true,
        fieldLcpP75Ms: percentileMs(metrics.LARGEST_CONTENTFUL_PAINT_MS),
        fieldInpP75Ms: percentileMs(metrics.INTERACTION_TO_NEXT_PAINT ?? metrics.EXPERIMENTAL_INTERACTION_TO_NEXT_PAINT),
        fieldClsP75: clsFromPsi(metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE),
        fieldOverallCategory: cleanCategory(experience?.overall_category),
        originFallback: Boolean(experience?.origin_fallback),
    };
}

export function parsePsiBody(body: unknown): { lhr: LhrLike | null; field: FieldData } {
    const record = (body ?? {}) as { lighthouseResult?: LhrLike; loadingExperience?: unknown };
    const lhr = record.lighthouseResult && typeof record.lighthouseResult === 'object' ? record.lighthouseResult : null;
    return { lhr, field: parseFieldData(record.loadingExperience) };
}

export function classifyPsiHttpError(status: number, bodyText: string): 'PSI_KEY_INVALID' | 'PSI_RATE_LIMITED' | 'PSI_ERROR' | null {
    if (status === 429) return 'PSI_RATE_LIMITED';
    if ((status === 400 || status === 403) && /api key not valid|invalid api key|API_KEY_INVALID|keyInvalid/i.test(bodyText)) {
        return 'PSI_KEY_INVALID';
    }
    if (status >= 400) return 'PSI_ERROR';
    return null;
}

export function buildPsiUrl(options: { pageUrl: string; strategy: 'mobile' | 'desktop'; categories: string[]; apiKey: string }): string {
    const url = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    url.searchParams.set('url', options.pageUrl);
    url.searchParams.set('strategy', options.strategy);
    for (const category of options.categories) url.searchParams.append('category', category);
    url.searchParams.set('key', options.apiKey);
    return url.href;
}

export async function runPsi(options: {
    pageUrl: string;
    strategy: 'mobile' | 'desktop';
    categories: string[];
    apiKey: string;
    timeoutMs: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    logger?: { warning: (message: string) => void; info: (message: string) => void };
}): Promise<PsiSuccess> {
    const doFetch = options.fetchImpl ?? fetch;
    const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const requestUrl = buildPsiUrl(options);
    let rateAttempts = 0;
    for (;;) {
        let response: Response;
        try {
            response = await doFetch(requestUrl, { signal: AbortSignal.timeout(options.timeoutMs) });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const name = error instanceof Error ? error.name : '';
            options.logger?.warning(`PageSpeed Insights request failed: ${redact(message)}`);
            if (name === 'TimeoutError' || name === 'AbortError') {
                throw new AuditFailed('TIMEOUT', { timeoutSecs: Math.max(1, Math.round(options.timeoutMs / 1000)) });
            }
            throw new AuditFailed('PSI_ERROR');
        }
        const text = await response.text();
        const kind = classifyPsiHttpError(response.status, text);
        if (kind === 'PSI_RATE_LIMITED' && rateAttempts < BACKOFF_MS.length) {
            const wait = BACKOFF_MS[rateAttempts] ?? 4000;
            rateAttempts += 1;
            options.logger?.info(`PageSpeed Insights returned HTTP 429, waiting ${wait} ms`);
            await sleep(wait);
            continue;
        }
        if (kind === 'PSI_KEY_INVALID') throw new AuditFailed('PSI_KEY_INVALID');
        if (kind === 'PSI_RATE_LIMITED') throw new AuditFailed('PSI_RATE_LIMITED');
        if (kind === 'PSI_ERROR') throw new AuditFailed('PSI_ERROR');
        let parsed: unknown;
        try {
            parsed = JSON.parse(text) as unknown;
        } catch {
            throw new AuditFailed('PSI_ERROR');
        }
        const result = parsePsiBody(parsed);
        if (!result.lhr) throw new AuditFailed('PSI_ERROR');
        return { lhr: result.lhr, field: result.field };
    }
}
