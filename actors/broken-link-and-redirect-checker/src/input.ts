import type { ActorInput, Mode, OutputMode, ResolvedInput } from './types.js';

export class InputFailure extends Error {
    readonly code: string;
    readonly detail: string | null;

    constructor(code: string, message: string, detail: string | null = null) {
        super(message);
        this.name = 'InputFailure';
        this.code = code;
        this.detail = detail;
    }
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
    const n = value ?? fallback;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(n)));
}

function compileRegex(source: string | undefined, field: string): RegExp | undefined {
    if (!source || source.trim() === '') return undefined;
    const trimmed = source.trim();
    const wrapped = /^\/([\s\S]+)\/([dgimsuvy]*)$/.exec(trimmed);
    try {
        if (wrapped?.[1] !== undefined) return new RegExp(wrapped[1], wrapped[2] ?? '');
        return new RegExp(trimmed);
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'invalid pattern';
        throw new InputFailure('INVALID_REGEX', `The ${field} regular expression is invalid (${reason}).`, field);
    }
}

export function resolveInput(input: ActorInput | null): ResolvedInput {
    const source = input ?? {};
    if (source.mode !== undefined && source.mode !== 'crawl' && source.mode !== 'list') {
        throw new InputFailure('MODE_INPUT_MISMATCH', 'Mode must be crawl or list.', String(source.mode));
    }
    const mode: Mode = source.mode === 'list' ? 'list' : 'crawl';
    const outputMode: OutputMode =
        source.outputMode === 'problemsOnly' || source.outputMode === 'brokenOnly' ? source.outputMode : 'all';
    const includeUrlRegex = compileRegex(source.includeUrlRegex, 'includeUrlRegex');
    const excludeUrlRegex = compileRegex(source.excludeUrlRegex, 'excludeUrlRegex');
    return {
        mode,
        startUrls: [...(source.startUrls ?? [])],
        urls: [...(source.urls ?? [])],
        ...(source.urlsDataset ? { urlsDataset: source.urlsDataset } : {}),
        urlsDatasetField: source.urlsDatasetField || 'url',
        maxDatasetItems: clamp(source.maxDatasetItems, 100_000, 1, 1_000_000),
        maxPages: clamp(source.maxPages, 100, 1, 100_000),
        maxDepth: clamp(source.maxDepth, 3, 0, 20),
        includeSubdomains: source.includeSubdomains ?? false,
        checkExternalLinks: source.checkExternalLinks ?? true,
        checkAssetLinks: source.checkAssetLinks ?? false,
        ...(includeUrlRegex ? { includeUrlRegex } : {}),
        ...(excludeUrlRegex ? { excludeUrlRegex } : {}),
        maxLinks: clamp(source.maxLinks, 10_000, 1, 1_000_000),
        outputMode,
        maxSourcesPerLink: clamp(source.maxSourcesPerLink, 10, 1, 100),
        maxConcurrencyPerHost: clamp(source.maxConcurrencyPerHost, 2, 1, 5),
        maxConcurrency: clamp(source.maxConcurrency, 20, 1, 50),
        minDelayPerHostMs: clamp(source.minDelayPerHostMs, 250, 0, 10_000),
        respectRobotsTxt: source.respectRobotsTxt ?? true,
        useHeadRequests: source.useHeadRequests ?? true,
        requestTimeoutSecs: clamp(source.requestTimeoutSecs, 15, 3, 60),
        maxRedirects: clamp(source.maxRedirects, 10, 0, 20),
    };
}

export function matchesFilter(url: string, input: ResolvedInput): boolean {
    if (input.includeUrlRegex) input.includeUrlRegex.lastIndex = 0;
    if (input.excludeUrlRegex) input.excludeUrlRegex.lastIndex = 0;
    if (input.includeUrlRegex && !input.includeUrlRegex.test(url)) return false;
    if (input.excludeUrlRegex && input.excludeUrlRegex.test(url)) return false;
    return true;
}

export function sameSite(linkHost: string, siteHost: string, includeSubdomains: boolean): boolean {
    const norm = (host: string) => host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    const link = norm(linkHost);
    const site = norm(siteHost);
    if (link === site) return true;
    if (!includeSubdomains) return false;
    return link.endsWith(`.${site}`) || site.endsWith(`.${link}`);
}
