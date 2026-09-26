import { redact } from '@apify-actors/common';

import type { AuditRow, Device, Engine, Rating } from './types.js';
import { ROW_KEYS } from './types.js';

export function rateMetric(value: number | null, goodMax: number, needsImprovementMax: number): Rating | null {
    if (value === null || !Number.isFinite(value)) return null;
    if (value <= goodMax) return 'good';
    if (value <= needsImprovementMax) return 'needs-improvement';
    return 'poor';
}

export function blankMetrics(): Pick<
    AuditRow,
    | 'performanceScore'
    | 'accessibilityScore'
    | 'bestPracticesScore'
    | 'seoScore'
    | 'lcpMs'
    | 'fcpMs'
    | 'cls'
    | 'tbtMs'
    | 'speedIndexMs'
    | 'ttfbMs'
    | 'lcpRating'
    | 'clsRating'
    | 'tbtRating'
    | 'fieldDataAvailable'
    | 'fieldLcpP75Ms'
    | 'fieldInpP75Ms'
    | 'fieldClsP75'
    | 'fieldOverallCategory'
    | 'topOpportunities'
    | 'totalByteWeight'
    | 'requestCount'
    | 'lighthouseVersion'
    | 'benchmarkIndex'
    | 'auditDurationMs'
    | 'runWarnings'
> {
    return {
        performanceScore: null,
        accessibilityScore: null,
        bestPracticesScore: null,
        seoScore: null,
        lcpMs: null,
        fcpMs: null,
        cls: null,
        tbtMs: null,
        speedIndexMs: null,
        ttfbMs: null,
        lcpRating: null,
        clsRating: null,
        tbtRating: null,
        fieldDataAvailable: null,
        fieldLcpP75Ms: null,
        fieldInpP75Ms: null,
        fieldClsP75: null,
        fieldOverallCategory: null,
        topOpportunities: null,
        totalByteWeight: null,
        requestCount: null,
        lighthouseVersion: null,
        benchmarkIndex: null,
        auditDurationMs: null,
        runWarnings: null,
    };
}

function displayUrl(raw: string): string {
    try {
        const url = new URL(raw.trim());
        url.username = '';
        url.password = '';
        url.hash = '';
        return redact(url.href).slice(0, 2048);
    } catch {
        return redact(raw).slice(0, 2048);
    }
}

export function errorRow(args: {
    url: string;
    strategy: Device;
    engine: Engine;
    errorCode: string;
    errorMessage: string;
    auditedAt: string;
    auditDurationMs?: number | null;
}): AuditRow {
    return {
        url: displayUrl(args.url),
        finalUrl: null,
        strategy: args.strategy,
        engine: args.engine,
        status: 'error',
        ...blankMetrics(),
        fieldDataAvailable: args.engine === 'psi' ? false : null,
        auditDurationMs: args.auditDurationMs ?? null,
        charged: false,
        errorCode: args.errorCode,
        errorMessage: redact(args.errorMessage),
        auditedAt: args.auditedAt,
    };
}

export function assertWhitelist(row: AuditRow): void {
    const keys = Object.keys(row);
    if (keys.length !== ROW_KEYS.length || ROW_KEYS.some((key) => !keys.includes(key))) {
        throw new Error(`Row keys do not match the whitelist: ${keys.join(',')}`);
    }
}
