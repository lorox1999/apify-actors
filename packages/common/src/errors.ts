/**
 * Error codes merged from the three Actor specs (section 8) plus codes the
 * sitemap Actor uses for failures the spec calls out by name (gzip, redirects,
 * private hosts). Messages are fixed templates: never paste a response body.
 */

export const ERROR_CODES = [
    'INVALID_INPUT_URL',
    'PRIVATE_HOST',
    'DNS_ERROR',
    'CONNECTION_ERROR',
    'TIMEOUT',
    'NO_SITEMAP_FOUND',
    'SITEMAP_HTTP_403',
    'SITEMAP_HTTP_404',
    'SITEMAP_HTTP_410',
    'SITEMAP_HTTP_5XX',
    'SITEMAP_HTTP_ERROR',
    'RATE_LIMITED',
    'BLOCKED_BY_ROBOTS',
    'SITEMAP_PARSE_ERROR',
    'SITEMAP_TOO_LARGE',
    'GZIP_ERROR',
    'REDIRECT_LOOP',
    'MAX_SITEMAP_FILES_REACHED',
    'MAX_URLS_REACHED',
    'STATE_STORE_ERROR',
    'STATE_TOO_LARGE',
    'CHARGE_LIMIT_REACHED',
    'NOT_IMPLEMENTED',
    'INVALID_REGEX',
    'INVALID_DATE',
    'NO_URLS',
    'INVALID_URL',
    'LOW_MEMORY_FOR_LIGHTHOUSE',
    'PSI_KEY_MISSING',
    'PSI_RATE_LIMITED',
    'PSI_KEY_INVALID',
    'UNREACHABLE',
    'HTTP_4XX_PRECHECK',
    'HTTP_5XX_PRECHECK',
    'CHROME_CRASH',
    'LIGHTHOUSE_ERROR',
    'PSI_ERROR',
    'USER_QUALIFIER_NOT_ALLOWED',
    'ENRICH_REQUIRES_TOKEN',
    'TOKEN_INVALID',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const TEMPLATES: Record<ErrorCode, string> = {
    INVALID_INPUT_URL: 'The start URL could not be parsed as an http(s) URL or domain.',
    PRIVATE_HOST: 'Private or local network hosts are not allowed.',
    DNS_ERROR: 'DNS lookup failed after retries.',
    CONNECTION_ERROR: 'The connection failed after retries.',
    TIMEOUT: 'The request exceeded the timeout and failed after retries.',
    NO_SITEMAP_FOUND: 'robots.txt lists no Sitemap and none of the common paths returned a sitemap.',
    SITEMAP_HTTP_403: 'The sitemap request was rejected with HTTP 403. Access controls are not bypassed.',
    SITEMAP_HTTP_404: 'The sitemap request returned HTTP 404.',
    SITEMAP_HTTP_410: 'The sitemap request returned HTTP 410.',
    SITEMAP_HTTP_5XX: 'The sitemap request returned a server error after retries.',
    SITEMAP_HTTP_ERROR: 'The sitemap request failed with an HTTP error status.',
    RATE_LIMITED: 'The server returned HTTP 429 after waiting and retrying once.',
    BLOCKED_BY_ROBOTS: 'robots.txt disallows this path.',
    SITEMAP_PARSE_ERROR: 'The sitemap XML is invalid. URLs parsed before the error were kept.',
    SITEMAP_TOO_LARGE: 'The sitemap exceeds the size limit or its compression ratio is too high.',
    GZIP_ERROR: 'The gzip sitemap could not be decompressed.',
    REDIRECT_LOOP: 'The request hit a redirect loop or more than 5 redirects.',
    MAX_SITEMAP_FILES_REACHED: 'The sitemap file cap was reached.',
    MAX_URLS_REACHED: 'The per-site URL cap was reached.',
    STATE_STORE_ERROR: 'The snapshot store could not be read or written. Change tracking was skipped.',
    STATE_TOO_LARGE: 'The URL list exceeds 500000 URLs, so change tracking was skipped.',
    CHARGE_LIMIT_REACHED: 'The run reached the maximum charge limit and stopped.',
    NOT_IMPLEMENTED: 'This Actor is not implemented yet.',
    INVALID_REGEX: 'A URL filter regular expression is invalid.',
    INVALID_DATE: 'A lastmod filter date is invalid.',
    NO_URLS: 'No URLs were provided.',
    INVALID_URL: 'A URL failed validation.',
    LOW_MEMORY_FOR_LIGHTHOUSE: 'Not enough memory is allocated for a local Lighthouse audit.',
    PSI_KEY_MISSING: 'PageSpeed Insights mode requires an API key.',
    PSI_RATE_LIMITED: 'PageSpeed Insights returned HTTP 429 after retries.',
    PSI_KEY_INVALID: 'The PageSpeed Insights API key was rejected.',
    UNREACHABLE: 'The URL could not be reached.',
    HTTP_4XX_PRECHECK: 'The URL returned an HTTP 4xx status during the reachability check. Access controls are not bypassed.',
    HTTP_5XX_PRECHECK: 'The URL returned an HTTP 5xx status during the reachability check.',
    CHROME_CRASH: 'Chrome exited unexpectedly and the audit failed after a restart.',
    LIGHTHOUSE_ERROR: 'Lighthouse reported a runtime error and did not produce a usable result.',
    PSI_ERROR: 'PageSpeed Insights returned an error for this URL.',
    USER_QUALIFIER_NOT_ALLOWED: 'Search queries must not contain a user: qualifier.',
    ENRICH_REQUIRES_TOKEN: 'Enriched fields require your own GitHub token.',
    TOKEN_INVALID: 'The GitHub token was rejected with HTTP 401.',
};

export function errorMessage(code: ErrorCode): string {
    return TEMPLATES[code];
}

export interface ErrorRowBase {
    site: string;
    url?: string | null;
    extractedAt?: string;
}

export interface ErrorRow {
    recordType: 'error';
    site: string;
    url: string | null;
    source: null;
    sourceSitemap: null;
    lastmod: null;
    changefreq: null;
    priority: null;
    sitemapKind: null;
    imageCount: null;
    videoCount: null;
    hreflangCount: null;
    changeType: null;
    firstSeenAt: null;
    httpStatus: number | null;
    finalUrl: null;
    errorCode: ErrorCode;
    errorMessage: string;
    extractedAt: string;
}

export function makeErrorRow(base: ErrorRowBase, code: ErrorCode): ErrorRow {
    return {
        recordType: 'error',
        site: base.site,
        url: base.url ?? null,
        source: null,
        sourceSitemap: null,
        lastmod: null,
        changefreq: null,
        priority: null,
        sitemapKind: null,
        imageCount: null,
        videoCount: null,
        hreflangCount: null,
        changeType: null,
        firstSeenAt: null,
        httpStatus: null,
        finalUrl: null,
        errorCode: code,
        errorMessage: TEMPLATES[code],
        extractedAt: base.extractedAt ?? new Date().toISOString(),
    };
}
