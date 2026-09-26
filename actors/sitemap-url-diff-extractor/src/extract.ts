import {
    chargeExtra,
    createSafeLogger,
    makeErrorRow,
    pushCharged,
    pushFree,
    type ChargeOutcome,
    type ErrorCode,
    type ErrorRow,
} from '@apify-actors/common';
import { classifyStartUrl, type Classified } from './classify.js';
import { applyDiff, readSnapshot, snapshotKey, writeSnapshot } from './compare.js';
import { download } from './download.js';
import { compileFilters, filterParams, keepUrl } from './filter.js';
import { runPool } from './hostLock.js';
import { extractLlmsLinks } from './llms.js';
import { SitemapBodyError, parseSitemapBuffer } from './parseSitemap.js';
import { emptyRobots, parseRobotsTxt, type RobotsFile } from './robotsFile.js';
import { errorToRow, pageToRow } from './rows.js';
import { checkHttpStatus } from './statusCheck.js';
import {
    COMMON_SITEMAP_PATHS,
    DIFF_MAX_URLS,
    type PageRecord,
    type ResolvedInput,
    type SiteSummary,
} from './types.js';

const log = () => createSafeLogger();

function hostOf(value: string): string {
    try {
        return new URL(value).host;
    } catch {
        return value;
    }
}

export interface RunState {
    stop: boolean;
    chargeLimitNoted: boolean;
}

function blankSummary(site: string): SiteSummary {
    return {
        site,
        robotsTxtFound: false,
        sitemapsFound: 0,
        sitemapFilesParsed: 0,
        urlsTotal: 0,
        urlsOutput: 0,
        addedCount: null,
        removedCount: null,
        llmsTxtFound: false,
        llmsTxtBytes: 0,
        llmsTxtLinkCount: 0,
        llmsFullTxtFound: false,
        truncated: false,
        partial: false,
        failedSitemapFiles: 0,
        chargedEvents: { 'url-extracted': 0, 'status-checked': 0, 'site-compared': 0 },
        wouldBeChargedEvents: { 'url-extracted': 0, 'status-checked': 0, 'site-compared': 0 },
        warnings: [],
        statusChecksSkipped: 0,
    };
}

function note(summary: SiteSummary, code: string): void {
    if (!summary.warnings.includes(code)) summary.warnings.push(code);
}

function recordCharge(summary: SiteSummary, event: 'url-extracted' | 'status-checked' | 'site-compared', outcome: ChargeOutcome): void {
    summary.chargedEvents[event] = (summary.chargedEvents[event] ?? 0) + outcome.chargedCount;
    summary.wouldBeChargedEvents[event] = (summary.wouldBeChargedEvents[event] ?? 0) + outcome.wouldBeChargedCount;
}

async function pushError(summarySite: string, code: ErrorCode, url: string | null, extractedAt: string, httpStatus?: number): Promise<void> {
    const row = makeErrorRow({ site: summarySite, url, extractedAt }, code);
    if (httpStatus != null) row.httpStatus = httpStatus;
    await pushFree(errorToRow(row));
}

export async function processStartUrl(input: ResolvedInput, raw: string, state: RunState, extractedAt: string): Promise<{ summary: SiteSummary; failed: boolean; failedCode?: string }> {
    const classified = classifyStartUrl(raw);
    const summary = blankSummary(classified.site);
    if (state.stop) {
        note(summary, 'CHARGE_LIMIT_REACHED');
        return { summary, failed: false };
    }
    if (classified.kind === 'invalid') {
        await pushError(classified.site, 'INVALID_INPUT_URL', null, extractedAt);
        return { summary, failed: true, failedCode: 'INVALID_INPUT_URL' };
    }
    if (classified.kind === 'private') {
        await pushError(classified.site, 'PRIVATE_HOST', classified.site, extractedAt);
        return { summary, failed: true, failedCode: 'PRIVATE_HOST' };
    }

    const filters = compileFilters(input, classified.site);
    const timeoutMs = input.requestTimeoutSecs * 1000;
    const errors: ErrorRow[] = [];
    const pages: PageRecord[] = [];
    const seenUrls = new Set<string>();
    const halt = { dns: false };

    const recordError = (code: ErrorCode, url: string | null, httpStatus?: number) => {
        if (code === 'DNS_ERROR') {
            const siteHost = hostOf(classified.site);
            const failedHost = hostOf(url ?? classified.site);
            if (!errors.some((row) => row.errorCode === 'DNS_ERROR')) {
                errors.push(makeErrorRow({ site: classified.site, url: failedHost, extractedAt }, 'DNS_ERROR'));
                log().warning(`Recorded DNS_ERROR for ${failedHost}`);
            }
            if (failedHost === siteHost) halt.dns = true;
            return;
        }
        const row = makeErrorRow({ site: classified.site, url, extractedAt }, code);
        if (httpStatus != null) row.httpStatus = httpStatus;
        errors.push(row);
        log().warning(`Recorded ${code} for ${classified.site}`);
    };

    let robots = emptyRobots();
    if (input.respectRobotsTxt || input.discoverFromRobotsTxt || classified.kind === 'robots') {
        const robotsUrl = classified.kind === 'robots' ? classified.url : `${classified.site}/robots.txt`;
        const loaded = await loadRobots(robotsUrl, timeoutMs, input.respectRobotsTxt);
        robots = loaded.robots;
        summary.robotsTxtFound = loaded.robots.found;
        if (loaded.error && classified.kind !== 'sitemap') {
            recordError(loaded.error, robotsUrl, loaded.status);
            if (loaded.error !== 'SITEMAP_HTTP_404') summary.failedSitemapFiles += 1;
        }
    }

    const roots = halt.dns
        ? { urls: [] as string[], declared: 0 }
        : await discoverRoots(input, classified, robots, timeoutMs, summary, recordError, halt);
    summary.sitemapsFound = roots.declared;
    if (!halt.dns) {
        await crawlSitemaps(input, classified.site, roots.urls, robots, timeoutMs, filters, pages, seenUrls, summary, recordError, state, halt);
    }

    if (pages.length === 0 && roots.urls.length === 0 && !errors.some((row) => row.errorCode.startsWith('SITEMAP_HTTP') || row.errorCode === 'TIMEOUT' || row.errorCode === 'BLOCKED_BY_ROBOTS' || row.errorCode === 'SITEMAP_PARSE_ERROR' || row.errorCode === 'SITEMAP_TOO_LARGE' || row.errorCode === 'GZIP_ERROR' || row.errorCode === 'REDIRECT_LOOP' || row.errorCode === 'RATE_LIMITED' || row.errorCode === 'DNS_ERROR' || row.errorCode === 'CONNECTION_ERROR')) {
        recordError('NO_SITEMAP_FOUND', null);
    } else if (pages.length === 0 && roots.urls.length > 0 && errors.length === 0) {
        recordError('NO_SITEMAP_FOUND', null);
    }

    if (!halt.dns && (input.checkLlmsTxt || classified.kind === 'llms')) {
        await readLlms(input, classified, timeoutMs, filters, pages, seenUrls, summary, recordError, state, halt);
    }

    summary.urlsTotal = pages.length;

    let removed: PageRecord[] = [];
    if (input.compareWithPreviousRun && !state.stop) {
        if (pages.length > DIFF_MAX_URLS) {
            note(summary, 'STATE_TOO_LARGE');
            recordError('STATE_TOO_LARGE', null);
        } else {
            const compared = await compareSite(input, classified.site, pages, extractedAt, summary);
            if (compared) removed = compared;
        }
    }

    let output = [...pages, ...removed];
    if (input.outputMode === 'changesOnly' && input.compareWithPreviousRun && summary.addedCount != null) {
        output = output.filter((page) => page.changeType === 'added' || page.changeType === 'removed');
    }

    if (input.checkHttpStatus) {
        await statusCheckPages(input, output, robots, timeoutMs, summary, recordError, state);
    }

    for (const page of output) {
        if (state.stop) break;
        const outcome = await pushCharged(pageToRow(classified.site, page, extractedAt), 'url-extracted');
        recordCharge(summary, 'url-extracted', outcome);
        if (outcome.accepted) summary.urlsOutput += 1;
        if (outcome.limitReached) {
            state.stop = true;
            note(summary, 'CHARGE_LIMIT_REACHED');
        }
    }

    for (const row of errors) await pushFree(errorToRow(row));

    const failedCodes = errors
        .map((row) => row.errorCode)
        .filter((code) => code !== 'CHARGE_LIMIT_REACHED' && code !== 'STATE_TOO_LARGE' && code !== 'STATE_STORE_ERROR');
    const failed = summary.urlsOutput === 0 && failedCodes.length > 0;
    return { summary, failed, failedCode: failed ? failedCodes[0] : undefined };
}

async function loadRobots(url: string, timeoutMs: number, respect: boolean): Promise<{ robots: RobotsFile; error?: ErrorCode; status?: number }> {
    const outcome = await download(url, timeoutMs, log());
    if (!outcome.ok) {
        if (outcome.code === 'SITEMAP_HTTP_404') return { robots: emptyRobots() };
        return { robots: emptyRobots(), error: outcome.code, status: outcome.status };
    }
    if (outcome.result.status === 404) return { robots: emptyRobots() };
    if (outcome.result.status >= 400) {
        return { robots: emptyRobots(), error: outcome.result.status === 403 ? 'SITEMAP_HTTP_403' : 'SITEMAP_HTTP_ERROR', status: outcome.result.status };
    }
    const robots = parseRobotsTxt(outcome.result.finalUrl, outcome.result.body.toString('utf8'));
    if (!respect) robots.isAllowed = () => true;
    return { robots };
}

async function discoverRoots(
    input: ResolvedInput,
    classified: Exclude<Classified, { kind: 'invalid' | 'private' }>,
    robots: RobotsFile,
    timeoutMs: number,
    summary: SiteSummary,
    recordError: (code: ErrorCode, url: string | null, httpStatus?: number) => void,
    halt: { dns: boolean },
): Promise<{ urls: string[]; declared: number }> {
    if (classified.kind === 'sitemap') {
        if (input.respectRobotsTxt && !robots.isAllowed(classified.url)) {
            recordError('BLOCKED_BY_ROBOTS', classified.url);
            summary.failedSitemapFiles += 1;
            return { urls: [], declared: 1 };
        }
        return { urls: [classified.url], declared: 1 };
    }
    const declared: string[] = [];
    if (input.discoverFromRobotsTxt || classified.kind === 'robots') {
        for (const entry of robots.sitemaps) {
            try {
                declared.push(new URL(entry, classified.site).href);
            } catch {
                recordError('INVALID_INPUT_URL', entry);
            }
        }
    }
    if (declared.length > 0) return { urls: declared, declared: declared.length };
    if (!input.probeCommonPaths) return { urls: [], declared: 0 };
    const found: string[] = [];
    for (const path of COMMON_SITEMAP_PATHS) {
        if (halt.dns) break;
        const url = `${classified.site}${path}`;
        if (input.respectRobotsTxt && !robots.isAllowed(url)) {
            recordError('BLOCKED_BY_ROBOTS', url);
            continue;
        }
        const outcome = await download(url, timeoutMs, log());
        if (!outcome.ok) {
            if (outcome.code === 'SITEMAP_HTTP_404') continue;
            recordError(outcome.code, url, outcome.status);
            continue;
        }
        if (outcome.result.status === 404) continue;
        const parsed = await safeParse(outcome.result.body, recordError, url, summary);
        if (!parsed) continue;
        if (parsed.urls.length === 0 && parsed.children.length === 0) continue;
        found.push(outcome.result.finalUrl || url);
        break;
    }
    return { urls: found, declared: found.length };
}

async function safeParse(
    body: Buffer,
    recordError: (code: ErrorCode, url: string | null, httpStatus?: number) => void,
    url: string,
    summary: SiteSummary,
) {
    try {
        return await parseSitemapBuffer(body);
    } catch (error) {
        const code: ErrorCode = error instanceof SitemapBodyError ? error.code : 'GZIP_ERROR';
        recordError(code, url);
        summary.failedSitemapFiles += 1;
        return null;
    }
}

async function crawlSitemaps(
    input: ResolvedInput,
    site: string,
    roots: string[],
    robots: RobotsFile,
    timeoutMs: number,
    filters: ReturnType<typeof compileFilters>,
    pages: PageRecord[],
    seenUrls: Set<string>,
    summary: SiteSummary,
    recordError: (code: ErrorCode, url: string | null, httpStatus?: number) => void,
    state: RunState,
    halt: { dns: boolean },
): Promise<void> {
    const queue = roots.map((url) => ({ url, depth: 1 }));
    const seenFiles = new Set<string>();
    let attempted = 0;
    while (queue.length > 0) {
        if (state.stop || halt.dns) return;
        if (pages.length >= input.maxUrlsPerSite) {
            summary.truncated = true;
            note(summary, 'MAX_URLS_REACHED');
            return;
        }
        const next = queue.shift();
        if (!next) break;
        let absolute: string;
        try {
            absolute = new URL(next.url, site).href;
        } catch {
            recordError('INVALID_INPUT_URL', next.url);
            continue;
        }
        if (seenFiles.has(absolute)) continue;
        seenFiles.add(absolute);
        if (next.depth > input.maxSitemapDepth) {
            summary.truncated = true;
            continue;
        }
        if (input.respectRobotsTxt && !robots.isAllowed(absolute)) {
            recordError('BLOCKED_BY_ROBOTS', absolute);
            summary.failedSitemapFiles += 1;
            continue;
        }
        if (attempted >= input.maxSitemapFiles) {
            summary.truncated = true;
            note(summary, 'MAX_SITEMAP_FILES_REACHED');
            return;
        }
        attempted += 1;
        const outcome = await download(absolute, timeoutMs, log());
        if (!outcome.ok) {
            recordError(outcome.code, absolute, outcome.status);
            summary.failedSitemapFiles += 1;
            continue;
        }
        const parsed = await safeParse(outcome.result.body, recordError, absolute, summary);
        if (!parsed) continue;
        summary.sitemapFilesParsed += 1;
        if (parsed.parseError) {
            summary.partial = true;
            recordError('SITEMAP_PARSE_ERROR', absolute);
            summary.failedSitemapFiles += 1;
        }
        for (const entry of parsed.urls) {
            if (pages.length >= input.maxUrlsPerSite) {
                summary.truncated = true;
                note(summary, 'MAX_URLS_REACHED');
                break;
            }
            let absoluteLoc: string;
            try {
                absoluteLoc = new URL(entry.loc, absolute).href;
            } catch {
                continue;
            }
            const norm = keepUrl(absoluteLoc, entry.lastmod, filters);
            if (!norm || seenUrls.has(norm)) continue;
            seenUrls.add(norm);
            pages.push({
                url: norm,
                norm,
                source: 'sitemap',
                sourceSitemap: absolute,
                lastmod: entry.lastmod,
                changefreq: entry.changefreq,
                priority: entry.priority,
                sitemapKind: entry.sitemapKind,
                imageCount: entry.imageCount,
                videoCount: entry.videoCount,
                hreflangCount: entry.hreflangCount,
                changeType: null,
                firstSeenAt: null,
                httpStatus: null,
                finalUrl: null,
            });
        }
        if (next.depth < input.maxSitemapDepth) {
            for (const child of parsed.children) queue.push({ url: child, depth: next.depth + 1 });
        } else if (parsed.children.length > 0) {
            summary.truncated = true;
        }
    }
}

async function readLlms(
    input: ResolvedInput,
    classified: Exclude<Classified, { kind: 'invalid' | 'private' }>,
    timeoutMs: number,
    filters: ReturnType<typeof compileFilters>,
    pages: PageRecord[],
    seenUrls: Set<string>,
    summary: SiteSummary,
    recordError: (code: ErrorCode, url: string | null, httpStatus?: number) => void,
    state: RunState,
    halt: { dns: boolean },
): Promise<void> {
    const files = classified.kind === 'llms'
        ? [classified.url]
        : [`${classified.site}/llms.txt`, `${classified.site}/llms-full.txt`];
    for (const url of files) {
        if (halt.dns || state.stop) return;
        const isFull = url.toLowerCase().includes('llms-full.txt');
        const outcome = await download(url, timeoutMs, log());
        if (!outcome.ok) {
            if (outcome.code === 'SITEMAP_HTTP_404') continue;
            recordError(outcome.code, url, outcome.status);
            continue;
        }
        if (outcome.result.status === 404) continue;
        if (outcome.result.status >= 400) {
            recordError(outcome.result.status === 403 ? 'SITEMAP_HTTP_403' : 'SITEMAP_HTTP_ERROR', url, outcome.result.status);
            continue;
        }
        const text = outcome.result.body.toString('utf8');
        const extracted = extractLlmsLinks(text);
        if (isFull) summary.llmsFullTxtFound = true;
        else {
            summary.llmsTxtFound = true;
            summary.llmsTxtBytes = outcome.result.body.length;
            summary.llmsTxtLinkCount = extracted.count;
        }
        if (!input.includeLlmsTxtUrls || state.stop) continue;
        for (const link of extracted.links) {
            if (pages.length >= input.maxUrlsPerSite) {
                summary.truncated = true;
                note(summary, 'MAX_URLS_REACHED');
                break;
            }
            const norm = keepUrl(link, null, filters);
            if (!norm || seenUrls.has(norm)) continue;
            seenUrls.add(norm);
            pages.push({
                url: norm,
                norm,
                source: 'llms.txt',
                sourceSitemap: url,
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
            });
        }
    }
}

async function compareSite(input: ResolvedInput, site: string, pages: PageRecord[], now: string, summary: SiteSummary): Promise<PageRecord[] | null> {
    const key = snapshotKey(site, filterParams(input));
    const previous = await readSnapshot(input.stateStoreName, key);
    if (previous && !previous.ok) {
        note(summary, previous.code);
        return null;
    }
    const hasBaseline = Boolean(previous && previous.ok);
    if (!hasBaseline) {
        const written = await writeSnapshot(input.stateStoreName, key, {
            site,
            createdAt: now,
            urls: pages.map((page) => [page.norm, page.firstSeenAt ?? now, page.source]),
        });
        if (written !== 'ok') {
            note(summary, written);
            return null;
        }
        return [];
    }
    const { added, removed } = applyDiff(pages, previous && previous.ok ? previous.urls : null, now);
    const charge = await chargeExtra('site-compared', 1);
    recordCharge(summary, 'site-compared', charge);
    if (!charge.accepted) {
        clearChangeTypes(pages);
        note(summary, 'CHARGE_LIMIT_REACHED');
        return null;
    }
    const written = await writeSnapshot(input.stateStoreName, key, {
        site,
        createdAt: now,
        urls: pages.map((page) => [page.norm, page.firstSeenAt ?? now, page.source]),
    });
    if (written !== 'ok') {
        clearChangeTypes(pages);
        note(summary, written);
        summary.addedCount = null;
        summary.removedCount = null;
        return null;
    }
    summary.addedCount = added;
    summary.removedCount = removed.length;
    if (charge.limitReached) note(summary, 'CHARGE_LIMIT_REACHED');
    return removed;
}

function clearChangeTypes(pages: PageRecord[]): void {
    for (const page of pages) {
        page.changeType = null;
        page.firstSeenAt = null;
    }
}

async function statusCheckPages(
    input: ResolvedInput,
    pages: PageRecord[],
    robots: RobotsFile,
    timeoutMs: number,
    summary: SiteSummary,
    recordError: (code: ErrorCode, url: string | null, httpStatus?: number) => void,
    state: RunState,
): Promise<void> {
    const targets = pages.filter((page) => page.changeType !== 'removed').slice(0, input.statusCheckMaxUrls);
    const groups = new Map<string, PageRecord[]>();
    for (const page of targets) {
        let host = 'unknown';
        try {
            host = new URL(page.url).host;
        } catch {
            continue;
        }
        const list = groups.get(host) ?? [];
        list.push(page);
        groups.set(host, list);
    }
    await Promise.all([...groups.values()].map((group) => runPool(group, input.statusCheckConcurrencyPerHost, async (page) => {
        if (state.stop) return;
        if (input.respectRobotsTxt && !robots.isAllowed(page.url)) {
            summary.statusChecksSkipped += 1;
            return;
        }
        const outcome = await checkHttpStatus(page.url, timeoutMs);
        if (!outcome.ok) {
            recordError(outcome.code, page.url);
            return;
        }
        const charge = await chargeExtra('status-checked', 1);
        recordCharge(summary, 'status-checked', charge);
        if (!charge.accepted) {
            state.stop = true;
            note(summary, 'CHARGE_LIMIT_REACHED');
            return;
        }
        page.httpStatus = outcome.httpStatus;
        page.finalUrl = outcome.finalUrl;
        if (charge.limitReached) {
            state.stop = true;
            note(summary, 'CHARGE_LIMIT_REACHED');
        }
    })));
    if (summary.statusChecksSkipped > 0) {
        recordError('BLOCKED_BY_ROBOTS', null);
        note(summary, 'BLOCKED_BY_ROBOTS');
    }
}
