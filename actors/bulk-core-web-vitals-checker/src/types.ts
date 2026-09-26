export const USER_AGENT = 'Mozilla/5.0 (compatible; BulkCoreWebVitalsChecker/1.0)';

export const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
export type Category = (typeof CATEGORIES)[number];

export type Device = 'mobile' | 'desktop';
export type Engine = 'local' | 'psi';
export type Rating = 'good' | 'needs-improvement' | 'poor';

export interface ActorInput {
    urls?: string[];
    urlsDataset?: string;
    urlsDatasetField?: string;
    maxUrls?: number;
    strategy?: 'mobile' | 'desktop' | 'both';
    categories?: string[];
    maxOpportunities?: number;
    engine?: Engine;
    psiApiKey?: string;
    perUrlTimeoutSecs?: number;
    retries?: number;
    precheckReachability?: boolean;
}

export interface Opportunity {
    id: string;
    title: string;
    savingsMs: number | null;
    savingsBytes: number | null;
}

/** Dataset row. Keys are the spec whitelist and nothing else. */
export interface AuditRow {
    url: string;
    finalUrl: string | null;
    strategy: Device;
    engine: Engine;
    status: 'ok' | 'error';
    performanceScore: number | null;
    accessibilityScore: number | null;
    bestPracticesScore: number | null;
    seoScore: number | null;
    lcpMs: number | null;
    fcpMs: number | null;
    cls: number | null;
    tbtMs: number | null;
    speedIndexMs: number | null;
    ttfbMs: number | null;
    lcpRating: Rating | null;
    clsRating: Rating | null;
    tbtRating: Rating | null;
    fieldDataAvailable: boolean | null;
    fieldLcpP75Ms: number | null;
    fieldInpP75Ms: number | null;
    fieldClsP75: number | null;
    fieldOverallCategory: string | null;
    topOpportunities: Opportunity[] | null;
    totalByteWeight: number | null;
    requestCount: number | null;
    lighthouseVersion: string | null;
    benchmarkIndex: number | null;
    auditDurationMs: number | null;
    runWarnings: string[] | null;
    charged: boolean;
    errorCode: string | null;
    errorMessage: string | null;
    auditedAt: string;
}

export const ROW_KEYS = [
    'url',
    'finalUrl',
    'strategy',
    'engine',
    'status',
    'performanceScore',
    'accessibilityScore',
    'bestPracticesScore',
    'seoScore',
    'lcpMs',
    'fcpMs',
    'cls',
    'tbtMs',
    'speedIndexMs',
    'ttfbMs',
    'lcpRating',
    'clsRating',
    'tbtRating',
    'fieldDataAvailable',
    'fieldLcpP75Ms',
    'fieldInpP75Ms',
    'fieldClsP75',
    'fieldOverallCategory',
    'topOpportunities',
    'totalByteWeight',
    'requestCount',
    'lighthouseVersion',
    'benchmarkIndex',
    'auditDurationMs',
    'runWarnings',
    'charged',
    'errorCode',
    'errorMessage',
    'auditedAt',
] as const;

export interface LhrAudit {
    id?: string;
    title?: string;
    numericValue?: number;
    details?: {
        type?: string;
        overallSavingsMs?: number;
        overallSavingsBytes?: number;
        items?: unknown[];
    };
}

export interface LhrLike {
    lighthouseVersion?: string;
    finalUrl?: string;
    requestedUrl?: string;
    runWarnings?: unknown[];
    runtimeError?: { code?: string; message?: string } | null;
    environment?: { benchmarkIndex?: number };
    categories?: Record<string, { score?: number | null } | undefined>;
    audits?: Record<string, LhrAudit | undefined>;
}

export interface FieldData {
    fieldDataAvailable: boolean;
    fieldLcpP75Ms: number | null;
    fieldInpP75Ms: number | null;
    fieldClsP75: number | null;
    fieldOverallCategory: string | null;
    originFallback: boolean;
}

export interface RunSummary {
    audited: number;
    failed: number;
    failedByCode: Record<string, number>;
    billed: Record<string, number>;
    averageAuditDurationMs: number | null;
    chargeLimitReached: boolean;
    urlsRequested: number;
    auditsPlanned: number;
    notAudited: number;
}
