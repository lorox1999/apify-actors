import { redact, scrubText } from '@apify-actors/common';

import { AuditFailed } from './failures.js';
import { rateMetric } from './rows.js';
import type { AuditRow, Category, Device, Engine, FieldData, LhrLike, Opportunity } from './types.js';

const SCREENSHOT_IDS = new Set(['screenshot-thumbnails', 'final-screenshot', 'full-page-screenshot']);

function roundMs(value: number | null): number | null {
    if (value === null || !Number.isFinite(value)) return null;
    return Math.round(value);
}

function roundCls(value: number | null): number | null {
    if (value === null || !Number.isFinite(value)) return null;
    return Number(value.toFixed(4));
}

function numeric(lhr: LhrLike, id: string): number | null {
    const value = lhr.audits?.[id]?.numericValue;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return value;
}

function categoryScore(lhr: LhrLike, name: string, requested: boolean): number | null {
    if (!requested) return null;
    const score = lhr.categories?.[name]?.score;
    if (typeof score !== 'number' || !Number.isFinite(score)) return null;
    const scaled = score <= 1 ? score * 100 : score;
    return Math.min(100, Math.max(0, Math.round(scaled)));
}

function safeCode(code: string | undefined): string | null {
    if (!code || !/^[A-Z0-9_]{1,64}$/.test(code)) return null;
    return code;
}

export function runtimeErrorCode(lhr: LhrLike): string | null {
    const runtime = lhr.runtimeError;
    if (!runtime || typeof runtime !== 'object') return null;
    if (!runtime.code && !runtime.message) return null;
    return safeCode(runtime.code) ?? 'UNKNOWN';
}

function cleanFinalUrl(value: string | undefined): string | null {
    if (!value || typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        url.username = '';
        url.password = '';
        url.hash = '';
        return url.href.slice(0, 2048);
    } catch {
        return null;
    }
}

function mainDocumentStatus(lhr: LhrLike): number | null {
    const items = lhr.audits?.['network-requests']?.details?.items;
    if (!Array.isArray(items)) return null;
    for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const record = item as { statusCode?: unknown; resourceType?: unknown };
        if (record.resourceType === 'Document' && typeof record.statusCode === 'number') return record.statusCode;
    }
    const first = items[0];
    if (first && typeof first === 'object') {
        const statusCode = (first as { statusCode?: unknown }).statusCode;
        if (typeof statusCode === 'number') return statusCode;
    }
    return null;
}

function requestCount(lhr: LhrLike): number | null {
    const items = lhr.audits?.['network-requests']?.details?.items;
    if (Array.isArray(items)) return items.length;
    return roundMs(numeric(lhr, 'network-requests'));
}

function cleanText(value: string, maxLen: number): string {
    return redact(scrubText(value, maxLen)).trim();
}

function warnings(lhr: LhrLike, httpStatus: number | null, originFallback: boolean): string[] | null {
    const notes: string[] = [];
    if (httpStatus !== null && httpStatus >= 400 && httpStatus <= 599) notes.push(`Main document returned HTTP ${httpStatus}.`);
    if (originFallback) notes.push('Field data is origin-level, not specific to this URL.');
    const out: string[] = [];
    for (const warning of lhr.runWarnings ?? []) {
        if (typeof warning !== 'string') continue;
        const cleaned = cleanText(warning, 300);
        if (cleaned) out.push(cleaned);
        if (out.length >= 5 - notes.length) break;
    }
    for (const note of notes) {
        if (!out.includes(note) && out.length < 5) out.push(note);
    }
    return out.length > 0 ? out.slice(0, 5) : null;
}

function opportunities(lhr: LhrLike, maxOpportunities: number): Opportunity[] {
    if (maxOpportunities <= 0) return [];
    const found: Opportunity[] = [];
    for (const audit of Object.values(lhr.audits ?? {})) {
        if (!audit?.details || audit.details.type !== 'opportunity') continue;
        const id = audit.id ?? '';
        if (!/^[a-z0-9-]{1,80}$/i.test(id) || SCREENSHOT_IDS.has(id)) continue;
        const title = cleanText(audit.title ?? '', 300);
        if (!title) continue;
        const savingsMs = roundMs(typeof audit.details.overallSavingsMs === 'number' ? audit.details.overallSavingsMs : null);
        const savingsBytes = roundMs(typeof audit.details.overallSavingsBytes === 'number' ? audit.details.overallSavingsBytes : null);
        // Skip passed audits and entries with no measurable saving (e.g. "Initial server response time was short").
        if (audit.score === 1 || (!(savingsMs && savingsMs > 0) && !(savingsBytes && savingsBytes > 0))) continue;
        found.push({ id, title, savingsMs, savingsBytes });
    }
    found.sort((a, b) => (b.savingsMs ?? -1) - (a.savingsMs ?? -1) || a.id.localeCompare(b.id));
    return found.slice(0, maxOpportunities);
}

export function normalizeLighthouseResult(args: {
    lhr: LhrLike;
    url: string;
    strategy: Device;
    engine: Engine;
    categories: Category[];
    maxOpportunities: number;
    auditDurationMs: number;
    auditedAt: string;
    field?: FieldData | null;
}): AuditRow {
    const code = runtimeErrorCode(args.lhr);
    if (code) {
        throw new AuditFailed(args.engine === 'psi' ? 'PSI_ERROR' : 'LIGHTHOUSE_ERROR', { lighthouseCode: code });
    }
    const requested = new Set(args.categories);
    const lcpMs = roundMs(numeric(args.lhr, 'largest-contentful-paint'));
    const cls = roundCls(numeric(args.lhr, 'cumulative-layout-shift'));
    const tbtMs = roundMs(numeric(args.lhr, 'total-blocking-time'));
    const httpStatus = mainDocumentStatus(args.lhr);
    const field = args.field;
    const version = typeof args.lhr.lighthouseVersion === 'string' ? args.lhr.lighthouseVersion.slice(0, 40) : null;
    const finalUrl = cleanFinalUrl(args.lhr.finalUrl) ?? cleanFinalUrl(args.url);
    const benchmark = args.lhr.environment?.benchmarkIndex;
    return {
        url: redact(args.url),
        finalUrl: finalUrl ? redact(finalUrl) : null,
        strategy: args.strategy,
        engine: args.engine,
        status: 'ok',
        performanceScore: categoryScore(args.lhr, 'performance', requested.has('performance')),
        accessibilityScore: categoryScore(args.lhr, 'accessibility', requested.has('accessibility')),
        bestPracticesScore: categoryScore(args.lhr, 'best-practices', requested.has('best-practices')),
        seoScore: categoryScore(args.lhr, 'seo', requested.has('seo')),
        lcpMs,
        fcpMs: roundMs(numeric(args.lhr, 'first-contentful-paint')),
        cls,
        tbtMs,
        speedIndexMs: roundMs(numeric(args.lhr, 'speed-index')),
        ttfbMs: roundMs(numeric(args.lhr, 'server-response-time')),
        lcpRating: rateMetric(lcpMs, 2500, 4000),
        clsRating: rateMetric(cls, 0.1, 0.25),
        tbtRating: rateMetric(tbtMs, 200, 600),
        fieldDataAvailable: field ? field.fieldDataAvailable : null,
        fieldLcpP75Ms: field?.fieldLcpP75Ms ?? null,
        fieldInpP75Ms: field?.fieldInpP75Ms ?? null,
        fieldClsP75: field?.fieldClsP75 ?? null,
        fieldOverallCategory: field?.fieldOverallCategory ?? null,
        topOpportunities: opportunities(args.lhr, args.maxOpportunities),
        totalByteWeight: roundMs(numeric(args.lhr, 'total-byte-weight')),
        requestCount: requestCount(args.lhr),
        lighthouseVersion: version,
        benchmarkIndex: typeof benchmark === 'number' && Number.isFinite(benchmark) ? Math.round(benchmark) : null,
        auditDurationMs: Math.max(0, Math.round(args.auditDurationMs)),
        runWarnings: warnings(args.lhr, httpStatus, Boolean(field?.originFallback)),
        // pushCharged overwrites this: true only when Actor.charge billed the row.
        charged: true,
        errorCode: null,
        errorMessage: null,
        auditedAt: args.auditedAt,
    };
}
