export type Mode = 'crawl' | 'list';
export type OutputMode = 'all' | 'problemsOnly' | 'brokenOnly';
export type CheckStatus = 'ok' | 'redirect' | 'broken' | 'restricted' | 'unverified' | 'skipped';
export type LinkType = 'internal' | 'external';
export type ElementName = 'a' | 'img' | 'script' | 'link' | 'iframe' | 'input';

export interface ActorInput {
    mode?: Mode;
    startUrls?: string[];
    urls?: string[];
    urlsDataset?: string;
    urlsDatasetField?: string;
    maxDatasetItems?: number;
    maxPages?: number;
    maxDepth?: number;
    includeSubdomains?: boolean;
    checkExternalLinks?: boolean;
    checkAssetLinks?: boolean;
    includeUrlRegex?: string;
    excludeUrlRegex?: string;
    maxLinks?: number;
    outputMode?: OutputMode;
    maxSourcesPerLink?: number;
    maxConcurrencyPerHost?: number;
    maxConcurrency?: number;
    minDelayPerHostMs?: number;
    respectRobotsTxt?: boolean;
    useHeadRequests?: boolean;
    requestTimeoutSecs?: number;
    maxRedirects?: number;
}

export interface ResolvedInput {
    mode: Mode;
    startUrls: string[];
    urls: string[];
    urlsDataset?: string;
    urlsDatasetField: string;
    maxDatasetItems: number;
    maxPages: number;
    maxDepth: number;
    includeSubdomains: boolean;
    checkExternalLinks: boolean;
    checkAssetLinks: boolean;
    includeUrlRegex?: RegExp;
    excludeUrlRegex?: RegExp;
    maxLinks: number;
    outputMode: OutputMode;
    maxSourcesPerLink: number;
    maxConcurrencyPerHost: number;
    maxConcurrency: number;
    minDelayPerHostMs: number;
    respectRobotsTxt: boolean;
    useHeadRequests: boolean;
    requestTimeoutSecs: number;
    maxRedirects: number;
}

export interface Hop {
    url: string;
    statusCode: number;
}

export interface SourceRef {
    pageUrl: string;
    anchorText: string | null;
    element: ElementName;
    pageSeq: number;
}

export const DATASET_FIELDS = [
    'recordType',
    'site',
    'linkUrl',
    'linkType',
    'element',
    'checkStatus',
    'statusCode',
    'finalStatusCode',
    'finalUrl',
    'redirectCount',
    'redirectChain',
    'responseTimeMs',
    'method',
    'errorCode',
    'errorDetail',
    'errorMessage',
    'sourcePage',
    'anchorText',
    'sourceCount',
    'sources',
    'pageUrl',
    'depth',
    'linksFound',
    'brokenLinks',
    'restrictedLinks',
    'redirectLinks',
    'unverifiedLinks',
    'mailtoLinks',
    'telLinks',
    'otherSchemeLinks',
    'truncated',
    'charged',
    'checkedAt',
] as const;

export const USER_AGENT_TOKEN = 'BrokenLinkAndRedirectChecker';
export const HTML_BYTE_CAP = 2 * 1024 * 1024;
export const UNBILLED_ROW_CAP = 10_000;
export const CSV_ROW_CAP = 200_000;
export const CSV_BYTE_CAP = 50 * 1024 * 1024;
export const ROBOTS_BYTE_CAP = 512 * 1024;
export const CRAWL_DELAY_CAP_MS = 10_000;
export const LINK_BYTES_ESTIMATE = 2400;

export const NOT_CHECKED_KEYS = [
    'NOT_CHECKED_LIMIT',
    'EXTERNAL_NOT_CHECKED',
    'EXCLUDED_BY_FILTER',
    'CHARGE_LIMIT_REACHED',
    'TIME_LIMIT_REACHED',
] as const;

export type NotCheckedKey = (typeof NOT_CHECKED_KEYS)[number];

export function userAgent(): string {
    const user = process.env.APIFY_USERNAME || process.env.APIFY_USER_ID || 'actor';
    return `Mozilla/5.0 (compatible; BrokenLinkAndRedirectChecker/1.0; +https://apify.com/${user}/broken-link-and-redirect-checker)`;
}

export function checkedAtNow(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
