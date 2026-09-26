export interface ActorInput {
    startUrls?: string[];
    maxUrlsPerSite?: number;
    discoverFromRobotsTxt?: boolean;
    probeCommonPaths?: boolean;
    checkLlmsTxt?: boolean;
    includeLlmsTxtUrls?: boolean;
    maxSitemapFiles?: number;
    maxSitemapDepth?: number;
    includeUrlRegex?: string;
    excludeUrlRegex?: string;
    lastmodFrom?: string;
    lastmodTo?: string;
    dropUrlsWithoutLastmod?: boolean;
    sameHostOnly?: boolean;
    compareWithPreviousRun?: boolean;
    stateStoreName?: string;
    outputMode?: 'all' | 'changesOnly';
    checkHttpStatus?: boolean;
    statusCheckMaxUrls?: number;
    statusCheckConcurrencyPerHost?: number;
    respectRobotsTxt?: boolean;
    requestTimeoutSecs?: number;
}

export interface ResolvedInput {
    startUrls: string[];
    maxUrlsPerSite: number;
    discoverFromRobotsTxt: boolean;
    probeCommonPaths: boolean;
    checkLlmsTxt: boolean;
    includeLlmsTxtUrls: boolean;
    maxSitemapFiles: number;
    maxSitemapDepth: number;
    includeUrlRegex?: string;
    excludeUrlRegex?: string;
    lastmodFrom?: string;
    lastmodTo?: string;
    dropUrlsWithoutLastmod: boolean;
    sameHostOnly: boolean;
    compareWithPreviousRun: boolean;
    stateStoreName: string;
    outputMode: 'all' | 'changesOnly';
    checkHttpStatus: boolean;
    statusCheckMaxUrls: number;
    statusCheckConcurrencyPerHost: number;
    respectRobotsTxt: boolean;
    requestTimeoutSecs: number;
}

export type SitemapKind = 'standard' | 'news' | 'image' | 'video' | 'text';
export type ChangeType = 'added' | 'unchanged' | 'removed';

export interface PageRecord {
    url: string;
    norm: string;
    source: 'sitemap' | 'llms.txt' | null;
    sourceSitemap: string | null;
    lastmod: string | null;
    changefreq: string | null;
    priority: number | null;
    sitemapKind: SitemapKind | null;
    imageCount: number | null;
    videoCount: number | null;
    hreflangCount: number | null;
    changeType: ChangeType | null;
    firstSeenAt: string | null;
    httpStatus: number | null;
    finalUrl: string | null;
}

export interface SiteSummary {
    site: string;
    robotsTxtFound: boolean;
    sitemapsFound: number;
    sitemapFilesParsed: number;
    urlsTotal: number;
    urlsOutput: number;
    addedCount: number | null;
    removedCount: number | null;
    llmsTxtFound: boolean;
    llmsTxtBytes: number;
    llmsTxtLinkCount: number;
    llmsFullTxtFound: boolean;
    truncated: boolean;
    partial: boolean;
    failedSitemapFiles: number;
    chargedEvents: Record<string, number>;
    warnings: string[];
    statusChecksSkipped: number;
}

export const DATASET_FIELDS = [
    'recordType',
    'site',
    'url',
    'source',
    'sourceSitemap',
    'lastmod',
    'changefreq',
    'priority',
    'sitemapKind',
    'imageCount',
    'videoCount',
    'hreflangCount',
    'changeType',
    'firstSeenAt',
    'httpStatus',
    'finalUrl',
    'errorCode',
    'errorMessage',
    'extractedAt',
] as const;

export const USER_AGENT = 'Mozilla/5.0 (compatible; SitemapUrlDiffExtractor/1.0)';
export const DIFF_MAX_URLS = 500_000;
export const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
export const COMMON_SITEMAP_PATHS = [
    '/sitemap.xml',
    '/sitemap_index.xml',
    '/sitemap-index.xml',
    '/sitemap.xml.gz',
    '/wp-sitemap.xml',
] as const;
