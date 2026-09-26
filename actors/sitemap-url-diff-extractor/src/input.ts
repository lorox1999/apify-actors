import { FatalInputError } from './fatal.js';
import type { ActorInput, ResolvedInput } from './types.js';

export function resolveInput(raw: ActorInput | null | undefined): ResolvedInput {
    const input = raw ?? {};
    if (!Array.isArray(input.startUrls) || input.startUrls.length === 0) {
        throw new FatalInputError('Input is missing startUrls.');
    }
    const outputMode = input.outputMode ?? 'all';
    if (outputMode !== 'all' && outputMode !== 'changesOnly') {
        throw new FatalInputError('outputMode must be all or changesOnly.');
    }
    const stateStoreName = input.stateStoreName ?? 'sitemap-url-diff-state';
    if (!/^[a-zA-Z0-9-]{1,63}$/.test(stateStoreName)) {
        throw new FatalInputError('stateStoreName must match ^[a-zA-Z0-9-]{1,63}$.');
    }
    const compareWithPreviousRun = Boolean(input.compareWithPreviousRun) || outputMode === 'changesOnly';
    return {
        startUrls: input.startUrls.map((value) => String(value)),
        maxUrlsPerSite: clamp(input.maxUrlsPerSite, 50_000, 1, 1_000_000),
        discoverFromRobotsTxt: input.discoverFromRobotsTxt ?? true,
        probeCommonPaths: input.probeCommonPaths ?? true,
        checkLlmsTxt: input.checkLlmsTxt ?? true,
        includeLlmsTxtUrls: input.includeLlmsTxtUrls ?? false,
        maxSitemapFiles: clamp(input.maxSitemapFiles, 500, 1, 5000),
        maxSitemapDepth: clamp(input.maxSitemapDepth, 5, 1, 10),
        includeUrlRegex: emptyToUndef(input.includeUrlRegex),
        excludeUrlRegex: emptyToUndef(input.excludeUrlRegex),
        lastmodFrom: emptyToUndef(input.lastmodFrom),
        lastmodTo: emptyToUndef(input.lastmodTo),
        dropUrlsWithoutLastmod: input.dropUrlsWithoutLastmod ?? false,
        sameHostOnly: input.sameHostOnly ?? false,
        compareWithPreviousRun,
        stateStoreName,
        outputMode,
        checkHttpStatus: input.checkHttpStatus ?? false,
        statusCheckMaxUrls: clamp(input.statusCheckMaxUrls, 1000, 1, 100_000),
        statusCheckConcurrencyPerHost: clamp(input.statusCheckConcurrencyPerHost, 2, 1, 5),
        respectRobotsTxt: input.respectRobotsTxt ?? true,
        requestTimeoutSecs: clamp(input.requestTimeoutSecs, 30, 5, 120),
    };
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
    const n = value ?? fallback;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(n)));
}

function emptyToUndef(value: string | undefined): string | undefined {
    if (value == null) return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
