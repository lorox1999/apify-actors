import { gzipSync, gunzipSync } from 'node:zlib';
import os from 'node:os';

import { Actor } from 'apify';
import {
    chargeExtra,
    createSafeLogger,
    flushDataset,
    getChargedCounts,
    getWouldBeChargedCounts,
    isPrivateHost,
    isUnmetered,
    pushCharged,
    pushFree,
    redactHttpUrl,
    redactLooseText,
    resetChargedCounts,
    type ChargeOutcome,
    type CheckStatus,
} from '@apify-actors/common';

import { createDispatcher, undiciFetch } from './client.js';
import { buildBrokenLinksCsv, type CsvInputRow } from './csv.js';
import { loadDatasetUrls } from './datasetInput.js';
import { classifyHref, extractLinks } from './html.js';
import { createChecker, looksLikeHtml, type CheckedLink } from './httpCheck.js';
import { matchesFilter, resolveInput, sameSite, InputFailure } from './input.js';
import { HostScheduler } from './limiter.js';
import { errorMessage } from './messages.js';
import { RobotsCache } from './robots.js';
import {
    checkedAtNow,
    DATASET_FIELDS,
    LINK_BYTES_ESTIMATE,
    UNBILLED_ROW_CAP,
    userAgent,
    type ActorInput,
    type CheckStatus as RowStatus,
    type ElementName,
    type NotCheckedKey,
    type ResolvedInput,
    type SourceRef,
} from './types.js';

interface LinkRec {
    url: string;
    site: string;
    linkType: 'internal' | 'external' | null;
    element: ElementName | null;
    sources: SourceRef[];
    sourceCount: number;
    result?: CheckedLink;
}

interface PageRec {
    site: string;
    pageUrl: string;
    depth: number;
    seq: number;
    truncated: boolean;
    linksFound: number;
    linkUrls: string[];
    mailto: number;
    tel: number;
    javascript: number;
    other: number;
    fragment: number;
}

interface SiteAcc {
    site: string;
    host: string;
    robotsTxtFound: boolean;
    crawlDelayMs: number;
    crawlDelayCapped: boolean;
    pagesCrawled: number;
    pagesFailed: number;
    pagesBlockedByRobots: number;
    pagesTruncated: number;
    linksFound: number;
    notChecked: Record<NotCheckedKey, number>;
    schemes: { mailto: number; tel: number; javascript: number; other: number };
    fragmentOnlyLinks: number;
}

interface SavedState {
    v: 1;
    mode: ResolvedInput['mode'];
    links: LinkRec[];
    pages: PageRec[];
    written: string[];
    charged: string[];
    stopReason: string | null;
    datasetRowsRead: number;
    datasetRowsIgnored: number;
    duplicateInputs: number;
    unbilledRowsCapped: number;
    wouldLinks: number;
    wouldPages: number;
    pendingPages: number;
    sites: SiteAcc[];
}

const STATUS_RANK: Record<CheckStatus, number> = {
    broken: 0,
    restricted: 1,
    unverified: 2,
    skipped: 3,
    redirect: 4,
    ok: 5,
};

function blankRow(): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const field of DATASET_FIELDS) row[field] = null;
    row.charged = false;
    row.checkedAt = checkedAtNow();
    return row;
}

function emptyNotChecked(): Record<NotCheckedKey, number> {
    return {
        NOT_CHECKED_LIMIT: 0,
        EXTERNAL_NOT_CHECKED: 0,
        EXCLUDED_BY_FILTER: 0,
        CHARGE_LIMIT_REACHED: 0,
        TIME_LIMIT_REACHED: 0,
    };
}

function emptySite(site: string, host: string): SiteAcc {
    return {
        site,
        host,
        robotsTxtFound: false,
        crawlDelayMs: 0,
        crawlDelayCapped: false,
        pagesCrawled: 0,
        pagesFailed: 0,
        pagesBlockedByRobots: 0,
        pagesTruncated: 0,
        linksFound: 0,
        notChecked: emptyNotChecked(),
        schemes: { mailto: 0, tel: 0, javascript: 0, other: 0 },
        fragmentOnlyLinks: 0,
    };
}

function originOf(url: string): { origin: string; host: string } | null {
    const canonical = redactHttpUrl(url);
    if (!canonical) return null;
    const parsed = new URL(canonical);
    if (isPrivateHost(parsed.hostname) && process.env.A3B_TEST_ALLOW_PRIVATE_HOSTS !== '1') {
        // still a usable origin for grouping; private blocking happens per link
    }
    return { origin: parsed.origin, host: parsed.hostname.toLowerCase() };
}

/** Schema maximum: a run never parses more than this many pages across every start site. */
function maxPagesRunCap(): number {
    const raw = process.env.A3B_TEST_MAX_PAGES_TOTAL;
    if (raw !== undefined && raw !== '') {
        const n = Number(raw);
        if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
    }
    return 100_000;
}

function deadlineMs(): number | null {
    const endRaw = process.env.ACTOR_TIMEOUT_AT;
    if (!endRaw) return null;
    const end = Date.parse(endRaw);
    if (Number.isNaN(end)) return null;
    const startRaw = process.env.ACTOR_STARTED_AT;
    const start = startRaw && !Number.isNaN(Date.parse(startRaw)) ? Date.parse(startRaw) : Date.now();
    return start + 0.85 * (end - start);
}

interface Pricing {
    metered: boolean;
    maxUsd: number | null;
    linkPrice: number;
    pagePrice: number;
}

function readPricing(): Pricing {
    const metered = !isUnmetered();
    let maxUsd: number | null = null;
    let linkPrice = process.env.ACTOR_TEST_PAY_PER_EVENT === 'true' ? 1 : 0.0006;
    let pagePrice = process.env.ACTOR_TEST_PAY_PER_EVENT === 'true' ? 1 : 0.001;
    try {
        const info = (Actor.getChargingManager() as unknown as { getPricingInfo?: () => Record<string, unknown> }).getPricingInfo?.() ?? {};
        const rawMax = info.maxTotalChargeUsd;
        if (typeof rawMax === 'number' && Number.isFinite(rawMax)) maxUsd = rawMax;
        const events = (info.pricingPerEvent as { actorChargeEvents?: Record<string, { eventPriceUsd?: number }> } | undefined)?.actorChargeEvents;
        const link = events?.['link-checked']?.eventPriceUsd;
        const page = events?.['page-crawled']?.eventPriceUsd;
        if (typeof link === 'number') linkPrice = link;
        if (typeof page === 'number') pagePrice = page;
    } catch {
        // local runs without a charging manager keep the test or FREE prices
    }
    if (maxUsd === null && process.env.ACTOR_MAX_TOTAL_CHARGE_USD) {
        const parsed = Number(process.env.ACTOR_MAX_TOTAL_CHARGE_USD);
        if (Number.isFinite(parsed)) maxUsd = parsed;
    }
    return { metered, maxUsd, linkPrice, pagePrice };
}

function projectedUsd(pricing: Pricing, extraLinks: number, extraPages: number, reservedLinks: number, pendingPages: number): number {
    const chargedLinks = getChargedCounts()['link-checked'] ?? 0;
    const chargedPages = getChargedCounts()['page-crawled'] ?? 0;
    return (chargedLinks + reservedLinks + extraLinks) * pricing.linkPrice + (chargedPages + pendingPages + extraPages) * pricing.pagePrice;
}

export async function execute(input: ActorInput | null): Promise<string> {
    const log = createSafeLogger();
    let resolved: ResolvedInput;
    try {
        resolved = resolveInput(input);
    } catch (error) {
        if (error instanceof InputFailure) {
            resetChargedCounts();
            await pushFree(errorRow('unknown', error.code, error.message, error.detail));
            await flushDataset();
            const summary = baseSummary(resolvedMode(input), error.code);
            await Actor.setValue('SUMMARY', summary);
            await Actor.setStatusMessage(error.message);
            return error.message;
        }
        throw error;
    }

    const saved = await loadState();
    if (!saved) resetChargedCounts();
    const pricing = readPricing();
    const memBytes = (Number(process.env.APIFY_MEMORY_MBYTES) || os.totalmem() / (1024 * 1024)) * 1024 * 1024;
    if (resolved.maxLinks * LINK_BYTES_ESTIMATE > memBytes * 0.6) {
        const warning = 'maxLinks is high for the allocated memory. Use at least 1 GB above 100,000 links and 2 GB above 400,000 links.';
        log.warning(warning);
        await Actor.setStatusMessage(warning);
    }

    const sites = new Map<string, SiteAcc>();
    const links = new Map<string, LinkRec>();
    const pages: PageRec[] = [];
    const written = new Set<string>(saved?.written ?? []);
    const charged = new Set<string>(saved?.charged ?? []);
    let stopReason: string | null = saved?.stopReason ?? null;
    let datasetRowsRead = saved?.datasetRowsRead ?? 0;
    let datasetRowsIgnored = saved?.datasetRowsIgnored ?? 0;
    let duplicateInputs = saved?.duplicateInputs ?? 0;
    let unbilledRowsCapped = saved?.unbilledRowsCapped ?? 0;
    let pendingPages = saved?.pendingPages ?? 0;
    let reservedLinks = 0;
    let migrating = false;
    let unbilledWritten = 0;
    const seenInputs = new Set<string>();

    if (saved) {
        for (const site of saved.sites) sites.set(site.site, site);
        for (const link of saved.links) links.set(link.url, link);
        pages.push(...saved.pages);
        for (const link of links.values()) if (link.result && !link.result.discarded && link.result.classification.billable && !charged.has(link.url)) reservedLinks += 1;
    }

    const shutdown = new AbortController();
    const scheduler = new HostScheduler(resolved.maxConcurrency, resolved.maxConcurrencyPerHost, resolved.minDelayPerHostMs);
    const dispatcher = createDispatcher(resolved.requestTimeoutSecs * 1000);
    const robots = new RobotsCache(scheduler, resolved.respectRobotsTxt, resolved.requestTimeoutSecs * 1000, resolved.minDelayPerHostMs, undiciFetch as unknown as typeof fetch, dispatcher);
    const checker = createChecker({
        scheduler,
        robots,
        timeoutMs: resolved.requestTimeoutSecs * 1000,
        maxRedirects: resolved.maxRedirects,
        useHead: resolved.useHeadRequests,
        userAgent: userAgent(),
        fetchImpl: undiciFetch as unknown as typeof fetch,
        dispatcher,
        shutdown,
        log,
        respectRobots: resolved.respectRobotsTxt,
    });

    const persist = async (): Promise<void> => {
        const state: SavedState = {
            v: 1,
            mode: resolved.mode,
            links: [...links.values()].map((link) => ({ ...link, result: link.result ? { ...link.result, body: null } : undefined })),
            pages,
            written: [...written],
            charged: [...charged],
            stopReason,
            datasetRowsRead,
            datasetRowsIgnored,
            duplicateInputs,
            unbilledRowsCapped,
            wouldLinks: getWouldBeChargedCounts()['link-checked'] ?? 0,
            wouldPages: getWouldBeChargedCounts()['page-crawled'] ?? 0,
            pendingPages,
            sites: [...sites.values()],
        };
        const payload = gzipSync(Buffer.from(JSON.stringify(state)));
        await Actor.setValue('STATE', payload, { contentType: 'application/gzip' });
    };

    const onMigrate = (): void => {
        migrating = true;
    };
    const onPersist = (): void => {
        void persist();
    };
    Actor.on('migrating', onMigrate);
    Actor.on('persistState', onPersist);
    const progress = setInterval(() => {
        const counts = countStatuses(links);
        log.info(`Checked ${counts.done.toLocaleString('en-US')} / ${links.size.toLocaleString('en-US')} links (broken ${counts.broken}, unverified ${counts.unverified}), crawled ${totalPages(sites).toLocaleString('en-US')} pages (max ${resolved.maxPagesPerSite.toLocaleString('en-US')} per site)`);
    }, 30_000);
    progress.unref?.();

    const timedOut = (): boolean => {
        const deadline = deadlineMs();
        return deadline !== null && Date.now() >= deadline;
    };

    const canReserve = (extraLinks: number, extraPages: number): boolean => {
        if (!pricing.metered || pricing.maxUsd === null) return true;
        return projectedUsd(pricing, extraLinks, extraPages, reservedLinks, pendingPages) <= pricing.maxUsd + 1e-9;
    };

    const bumpNot = (site: SiteAcc, key: NotCheckedKey): void => {
        site.notChecked[key] += 1;
        if (!stopReason) {
            if (key === 'CHARGE_LIMIT_REACHED' || key === 'TIME_LIMIT_REACHED' || key === 'NOT_CHECKED_LIMIT') stopReason = key;
        }
    };

    try {
        const loaded = await collectInputs(resolved);
        datasetRowsRead += loaded.rowsRead;
        datasetRowsIgnored += loaded.rowsIgnored;
        if (loaded.error) {
            await pushFree(errorRow('unknown', loaded.error.code, loaded.error.message, loaded.error.detail));
            await finish(resolved, sites, links, pages, stopReason, datasetRowsRead, datasetRowsIgnored, duplicateInputs, unbilledRowsCapped, true);
            return loaded.error.message;
        }
        for (const row of loaded.invalid) {
            const site = originOf(row)?.origin ?? 'unknown';
            await pushFree(errorRow(site, 'INVALID_INPUT_URL', errorMessage('INVALID_INPUT_URL') ?? 'Invalid URL', row));
        }
        if (loaded.urls.length === 0 && links.size === 0) {
            const message = errorMessage('NO_VALID_INPUT') ?? 'No valid URLs';
            await pushFree(errorRow('unknown', 'NO_VALID_INPUT', message, null));
            await finish(resolved, sites, links, pages, stopReason, datasetRowsRead, datasetRowsIgnored, duplicateInputs, unbilledRowsCapped, true);
            return message;
        }

        if (resolved.mode === 'list') {
            let cursor = 0;
            const limitHit = { current: false };
            const workers = Math.max(1, Math.min(resolved.maxConcurrency, loaded.urls.length || 1));
            const listWorker = async (): Promise<void> => {
                for (;;) {
                    if (migrating || timedOut() || limitHit.current) return;
                    const index = cursor;
                    cursor += 1;
                    if (index >= loaded.urls.length) return;
                    const raw = loaded.urls[index];
                    if (!raw) return;
                    const canonical = redactHttpUrl(raw);
                    if (!canonical) continue;
                    if (seenInputs.has(canonical) || links.has(canonical)) {
                        duplicateInputs += 1;
                        continue;
                    }
                    seenInputs.add(canonical);
                    const grouped = originOf(canonical);
                    const site = siteFor(sites, grouped?.origin ?? 'unknown', grouped?.host ?? 'unknown', resolved.minDelayPerHostMs);
                    if (!matchesFilter(canonical, resolved)) {
                        bumpNot(site, 'EXCLUDED_BY_FILTER');
                        continue;
                    }
                    if (links.size >= resolved.maxLinks) {
                        bumpNot(site, 'NOT_CHECKED_LIMIT');
                        continue;
                    }
                    if (!canReserve(1, 0)) {
                        bumpNot(site, 'CHARGE_LIMIT_REACHED');
                        limitHit.current = true;
                        return;
                    }
                    reservedLinks += 1;
                    const result = await checker.check(canonical, { readBody: false });
                    if (result.discarded) {
                        reservedLinks -= 1;
                        return;
                    }
                    const rec: LinkRec = {
                        url: canonical,
                        site: site.site,
                        linkType: null,
                        element: null,
                        sources: [],
                        sourceCount: 0,
                        result,
                    };
                    links.set(canonical, rec);
                    if (!result.classification.billable) reservedLinks = Math.max(0, reservedLinks - 1);
                    const outcome = await writeLink(resolved, rec, written, charged, () => {
                        unbilledWritten += 1;
                        return unbilledWritten <= unbilledCap();
                    }, () => {
                        unbilledRowsCapped += 1;
                    });
                    if (result.classification.billable && outcome?.accepted) reservedLinks = Math.max(0, reservedLinks - 1);
                    await applyRobots(site, robots, canonical);
                    if (outcome?.limitReached) {
                        limitHit.current = true;
                        stopReason = stopReason ?? 'CHARGE_LIMIT_REACHED';
                        return;
                    }
                }
            };
            await Promise.all(Array.from({ length: workers }, () => listWorker()));
            if (timedOut()) stopReason = stopReason ?? 'TIME_LIMIT_REACHED';
            if (!migrating) for (const raw of loaded.urls) {
                const canonical = redactHttpUrl(raw);
                if (!canonical || links.has(canonical) || seenInputs.has(canonical)) continue;
                const grouped = originOf(canonical);
                const site = siteFor(sites, grouped?.origin ?? 'unknown', grouped?.host ?? 'unknown', resolved.minDelayPerHostMs);
                if (!matchesFilter(canonical, resolved)) bumpNot(site, 'EXCLUDED_BY_FILTER');
                else if (stopReason === 'CHARGE_LIMIT_REACHED') bumpNot(site, 'CHARGE_LIMIT_REACHED');
                else bumpNot(site, 'TIME_LIMIT_REACHED');
            }
        } else {
            await crawl({
                resolved,
                urls: loaded.urls,
                sites,
                links,
                pages,
                checker,
                robots,
                canReserve,
                bumpNot,
                reserved: () => reservedLinks,
                addReserved: (n) => {
                    reservedLinks += n;
                },
                addPendingPage: () => {
                    pendingPages += 1;
                },
                takePendingPages: async () => {
                    if (pendingPages <= 0) return;
                    const n = pendingPages;
                    const outcome = await chargeExtra('page-crawled', n);
                    pendingPages = n - outcome.wouldBeChargedCount;
                    if (outcome.limitReached) stopReason = stopReason ?? 'CHARGE_LIMIT_REACHED';
                },
                shouldStop: () => migrating || timedOut() || stopReason === 'CHARGE_LIMIT_REACHED',
                abandonQueue: () => !migrating && (timedOut() || stopReason === 'CHARGE_LIMIT_REACHED'),
                stopKind: (): NotCheckedKey => (timedOut() ? 'TIME_LIMIT_REACHED' : 'CHARGE_LIMIT_REACHED'),
                noteStop: (reason: string) => {
                    stopReason = stopReason ?? reason;
                },
                onTimeout: () => {
                    if (timedOut()) stopReason = stopReason ?? 'TIME_LIMIT_REACHED';
                },
                minDelay: resolved.minDelayPerHostMs,
            });
            if (pendingPages > 0) {
                const outcome = await chargeExtra('page-crawled', pendingPages);
                pendingPages = Math.max(0, pendingPages - outcome.wouldBeChargedCount);
                if (outcome.limitReached) stopReason = stopReason ?? 'CHARGE_LIMIT_REACHED';
            }
            await writeCrawl(resolved, links, pages, sites, written, charged, () => {
                unbilledWritten += 1;
                return unbilledWritten <= unbilledCap();
            }, () => {
                unbilledRowsCapped += 1;
            });
        }

        if (migrating) {
            await persist();
            await flushDataset();
            const message = 'Run state was saved for migration.';
            await Actor.setStatusMessage(message);
            return message;
        }

        const message = await finish(resolved, sites, links, pages, stopReason, datasetRowsRead, datasetRowsIgnored, duplicateInputs, unbilledRowsCapped, true);
        await Actor.setValue('STATE', null);
        return message;
    } finally {
        clearInterval(progress);
        checker.shutdown();
        scheduler.close();
        Actor.off('migrating', onMigrate);
        Actor.off('persistState', onPersist);
    }
}

function unbilledCap(): number {
    const override = process.env.A3B_TEST_UNBILLED_CAP;
    if (override && Number.isFinite(Number(override))) return Number(override);
    return UNBILLED_ROW_CAP;
}

function resolvedMode(input: ActorInput | null): 'crawl' | 'list' {
    return input?.mode === 'list' ? 'list' : 'crawl';
}

async function collectInputs(input: ResolvedInput): Promise<{
    urls: string[];
    rowsRead: number;
    rowsIgnored: number;
    invalid: string[];
    error: { code: string; message: string; detail: string | null } | null;
}> {
    const invalid: string[] = [];
    const urls: string[] = [];
    let rowsRead = 0;
    let rowsIgnored = 0;
    const seeds = input.mode === 'list' ? input.urls : input.startUrls;
    if (input.mode === 'crawl' && seeds.length === 0 && !input.urlsDataset) {
        return { urls, rowsRead, rowsIgnored, invalid, error: { code: 'MODE_INPUT_MISMATCH', message: errorMessage('MODE_INPUT_MISMATCH') ?? 'Mode mismatch', detail: 'crawl' } };
    }
    if (input.mode === 'list' && seeds.length === 0 && !input.urlsDataset) {
        return { urls, rowsRead, rowsIgnored, invalid, error: { code: 'MODE_INPUT_MISMATCH', message: errorMessage('MODE_INPUT_MISMATCH') ?? 'Mode mismatch', detail: 'list' } };
    }
    for (const raw of seeds) {
        const canonical = redactHttpUrl(raw);
        if (!canonical) invalid.push(redactLooseText(raw));
        else urls.push(canonical);
    }
    if (input.urlsDataset) {
        try {
            const loaded = await loadDatasetUrls(input.urlsDataset, input.urlsDatasetField, input.maxDatasetItems);
            rowsRead += loaded.rowsRead;
            rowsIgnored += loaded.rowsIgnored;
            if (loaded.missingField) {
                return {
                    urls,
                    rowsRead,
                    rowsIgnored,
                    invalid,
                    error: {
                        code: 'DATASET_FIELD_MISSING',
                        message: `${errorMessage('DATASET_FIELD_MISSING')} Fields seen: ${loaded.sampleKeys.join(', ') || 'none'}.`,
                        detail: input.urlsDatasetField,
                    },
                };
            }
            for (const raw of loaded.urls) {
                const canonical = redactHttpUrl(raw);
                if (!canonical) invalid.push(redactLooseText(raw));
                else urls.push(canonical);
            }
        } catch {
            return {
                urls,
                rowsRead,
                rowsIgnored,
                invalid,
                error: { code: 'DATASET_NOT_ACCESSIBLE', message: errorMessage('DATASET_NOT_ACCESSIBLE') ?? 'Dataset not accessible', detail: input.urlsDataset },
            };
        }
    }
    return { urls, rowsRead, rowsIgnored, invalid, error: null };
}

function siteFor(sites: Map<string, SiteAcc>, origin: string, host: string, minDelay: number): SiteAcc {
    const existing = sites.get(origin);
    if (existing) return existing;
    const created = emptySite(origin, host);
    created.crawlDelayMs = minDelay;
    sites.set(origin, created);
    return created;
}

function countStatuses(links: Map<string, LinkRec>): { done: number; broken: number; unverified: number } {
    let done = 0;
    let broken = 0;
    let unverified = 0;
    for (const link of links.values()) {
        if (!link.result || link.result.discarded) continue;
        done += 1;
        if (link.result.classification.checkStatus === 'broken') broken += 1;
        if (link.result.classification.checkStatus === 'unverified') unverified += 1;
    }
    return { done, broken, unverified };
}

function totalPages(sites: Map<string, SiteAcc>): number {
    let n = 0;
    for (const site of sites.values()) n += site.pagesCrawled;
    return n;
}

async function applyRobots(site: SiteAcc, robots: RobotsCache, url: string): Promise<void> {
    const parsed = new URL(url);
    const decision = await robots.decision(parsed.origin, parsed.hostname.toLowerCase());
    if (decision.kind === 'rules' && decision.found) {
        site.robotsTxtFound = true;
        site.crawlDelayMs = decision.delayMs;
        site.crawlDelayCapped = decision.capped;
    }
}

async function writeLink(
    input: ResolvedInput,
    link: LinkRec,
    written: Set<string>,
    charged: Set<string>,
    allowUnbilled: () => boolean,
    capUnbilled: () => void,
): Promise<ChargeOutcome | null> {
    if (!link.result || link.result.discarded || written.has(link.url)) return null;
    const status = link.result.classification.checkStatus;
    const billable = link.result.classification.billable && !charged.has(link.url);
    const write = shouldWrite(status, input.outputMode);
    if (write && billable) {
        const row = linkToRow(link, true);
        const outcome = await pushCharged(row, 'link-checked');
        if (outcome.accepted) {
            charged.add(link.url);
            written.add(link.url);
        }
        return outcome;
    }
    if (write) {
        if (!allowUnbilled()) {
            capUnbilled();
            written.add(link.url);
            return null;
        }
        await pushFree(linkToRow(link, false));
        written.add(link.url);
        return null;
    }
    if (billable) {
        const outcome = await chargeExtra('link-checked', 1);
        if (outcome.accepted) {
            charged.add(link.url);
            written.add(link.url);
        }
        return outcome;
    }
    written.add(link.url);
    return null;
}

function shouldWrite(status: CheckStatus, mode: ResolvedInput['outputMode']): boolean {
    if (mode === 'all') return true;
    if (mode === 'brokenOnly') return status === 'broken';
    return status !== 'ok';
}

async function writeCrawl(
    input: ResolvedInput,
    links: Map<string, LinkRec>,
    pages: PageRec[],
    sites: Map<string, SiteAcc>,
    written: Set<string>,
    charged: Set<string>,
    allowUnbilled: () => boolean,
    capUnbilled: () => void,
): Promise<void> {
    const ordered = [...links.values()].filter((link) => link.result && !link.result.discarded);
    ordered.sort((a, b) => {
        const as = a.result?.classification.checkStatus ?? 'ok';
        const bs = b.result?.classification.checkStatus ?? 'ok';
        const rank = STATUS_RANK[as] - STATUS_RANK[bs];
        if (rank !== 0) return rank;
        return a.url.localeCompare(b.url);
    });
    for (const link of ordered) {
        await writeLink(input, link, written, charged, allowUnbilled, capUnbilled);
    }
    for (const page of pages) {
        await pushFree(pageToRow(page, links));
    }
    void sites;
}

function linkToRow(link: LinkRec, charged: boolean): Record<string, unknown> {
    const result = link.result;
    const row = blankRow();
    row.recordType = 'link';
    row.site = link.site;
    row.linkUrl = link.url;
    row.linkType = link.linkType;
    row.element = link.element;
    row.checkStatus = result?.classification.checkStatus ?? null;
    row.statusCode = result?.statusCode ?? null;
    row.finalStatusCode = result?.finalStatusCode ?? null;
    row.finalUrl = result?.finalUrl ?? null;
    row.redirectCount = result?.redirectCount ?? null;
    row.redirectChain = result?.redirectChain ?? null;
    row.responseTimeMs = result?.responseTimeMs ?? null;
    row.method = result?.method ?? null;
    row.errorCode = result?.classification.errorCode ?? null;
    row.errorDetail = result?.errorDetail ?? null;
    row.errorMessage = result?.errorMessage ?? null;
    const first = [...link.sources].sort((a, b) => a.pageSeq - b.pageSeq)[0];
    row.sourcePage = first?.pageUrl ?? null;
    row.anchorText = first?.anchorText ?? null;
    row.sourceCount = link.sourceCount || null;
    row.sources = link.sources.length
        ? [...link.sources]
            .sort((a, b) => a.pageSeq - b.pageSeq)
            .map((source) => ({ pageUrl: source.pageUrl, anchorText: source.anchorText, element: source.element }))
        : null;
    row.charged = charged;
    return row;
}

function pageToRow(page: PageRec, links: Map<string, LinkRec>): Record<string, unknown> {
    const counts = { broken: 0, restricted: 0, redirect: 0, unverified: 0 };
    for (const url of page.linkUrls) {
        const status = links.get(url)?.result?.classification.checkStatus;
        if (status === 'broken') counts.broken += 1;
        else if (status === 'restricted') counts.restricted += 1;
        else if (status === 'redirect') counts.redirect += 1;
        else if (status === 'unverified') counts.unverified += 1;
    }
    const row = blankRow();
    row.recordType = 'page';
    row.site = page.site;
    row.pageUrl = page.pageUrl;
    row.depth = page.depth;
    row.linksFound = page.linksFound;
    row.brokenLinks = counts.broken;
    row.restrictedLinks = counts.restricted;
    row.redirectLinks = counts.redirect;
    row.unverifiedLinks = counts.unverified;
    row.mailtoLinks = page.mailto;
    row.telLinks = page.tel;
    row.otherSchemeLinks = page.other + page.javascript;
    row.truncated = page.truncated;
    row.charged = false;
    return row;
}

function errorRow(site: string, code: string, message: string, detail: string | null): Record<string, unknown> {
    const row = blankRow();
    row.recordType = 'error';
    row.site = site;
    row.errorCode = code;
    row.errorDetail = detail;
    row.errorMessage = message;
    row.linkUrl = detail && code === 'INVALID_INPUT_URL' ? detail : null;
    row.charged = false;
    return row;
}

async function finish(
    input: ResolvedInput,
    sites: Map<string, SiteAcc>,
    links: Map<string, LinkRec>,
    pages: PageRec[],
    stopReason: string | null,
    datasetRowsRead: number,
    datasetRowsIgnored: number,
    duplicateInputs: number,
    unbilledRowsCapped: number,
    deleteState: boolean,
): Promise<string> {
    await flushDataset();
    const summary = buildSummary(input, sites, links, pages, stopReason, datasetRowsRead, datasetRowsIgnored, duplicateInputs, unbilledRowsCapped);
    const csvRows = csvFromLinks(links, input.maxSourcesPerLink);
    const csv = buildBrokenLinksCsv(csvRows);
    summary.csvTruncated = csv.truncated;
    await Actor.setValue('SUMMARY', summary);
    await Actor.setValue('BROKEN_LINKS.csv', csv.csv, { contentType: 'text/csv; charset=utf-8' });
    if (deleteState) await Actor.setValue('STATE', null);
    const message = doneMessage(summary);
    await Actor.setStatusMessage(message);
    return message;
}

function csvFromLinks(links: Map<string, LinkRec>, maxSources: number): CsvInputRow[] {
    const rows: CsvInputRow[] = [];
    for (const link of links.values()) {
        const status = link.result?.classification.checkStatus;
        if (!status || status === 'ok' || status === 'redirect' || link.result?.discarded) continue;
        const sources = [...link.sources].sort((a, b) => a.pageSeq - b.pageSeq).slice(0, maxSources);
        if (sources.length === 0) {
            rows.push({
                sourcePage: '',
                anchorText: '',
                linkUrl: link.url,
                linkType: link.linkType ?? '',
                checkStatus: status,
                statusCode: link.result?.finalStatusCode != null ? String(link.result.finalStatusCode) : '',
                errorCode: link.result?.classification.errorCode ?? '',
                finalUrl: link.result?.finalUrl ?? '',
            });
            continue;
        }
        for (const source of sources) {
            rows.push({
                sourcePage: source.pageUrl,
                anchorText: source.anchorText ?? '',
                linkUrl: link.url,
                linkType: link.linkType ?? '',
                checkStatus: status,
                statusCode: link.result?.finalStatusCode != null ? String(link.result.finalStatusCode) : '',
                errorCode: link.result?.classification.errorCode ?? '',
                finalUrl: link.result?.finalUrl ?? '',
            });
        }
    }
    return rows;
}

function buildSummary(
    input: ResolvedInput,
    sites: Map<string, SiteAcc>,
    links: Map<string, LinkRec>,
    pages: PageRec[],
    stopReason: string | null,
    datasetRowsRead: number,
    datasetRowsIgnored: number,
    duplicateInputs: number,
    unbilledRowsCapped: number,
): Record<string, unknown> {
    const siteRows = [...sites.values()].map((site) => {
        const mine = [...links.values()].filter((link) => link.site === site.site && link.result && !link.result.discarded);
        const byStatus: Record<RowStatus, number> = { ok: 0, redirect: 0, broken: 0, restricted: 0, unverified: 0, skipped: 0 };
        const byErrorCode: Record<string, number> = {};
        for (const link of mine) {
            const status = link.result?.classification.checkStatus;
            if (!status) continue;
            byStatus[status] += 1;
            const code = link.result?.classification.errorCode;
            if (code) byErrorCode[code] = (byErrorCode[code] ?? 0) + 1;
        }
        const checked = byStatus.ok + byStatus.redirect + byStatus.broken + byStatus.restricted + byStatus.unverified;
        const skipped = byStatus.skipped;
        const notSum = Object.values(site.notChecked).reduce((sum, n) => sum + n, 0);
        return {
            site: site.site,
            robotsTxtFound: site.robotsTxtFound,
            crawlDelayMs: site.crawlDelayMs,
            crawlDelayCapped: site.crawlDelayCapped,
            pagesCrawled: site.pagesCrawled,
            pagesFailed: site.pagesFailed,
            pagesBlockedByRobots: site.pagesBlockedByRobots,
            pagesTruncated: site.pagesTruncated,
            linksFound: site.linksFound,
            uniqueLinks: checked + skipped + notSum,
            linksChecked: checked + skipped,
            byStatus,
            byErrorCode,
            notChecked: site.notChecked,
            schemes: site.schemes,
            fragmentOnlyLinks: site.fragmentOnlyLinks,
        };
    });
    const counts = getChargedCounts();
    const wouldBe = getWouldBeChargedCounts();
    const billed = {
        'link-checked': counts['link-checked'] ?? 0,
        'page-crawled': counts['page-crawled'] ?? 0,
    };
    const wouldBeBilled = {
        'link-checked': wouldBe['link-checked'] ?? 0,
        'page-crawled': wouldBe['page-crawled'] ?? 0,
    };
    return {
        mode: input.mode,
        sites: siteRows,
        datasetRowsRead,
        datasetRowsIgnored,
        duplicateInputs,
        unbilledRowsCapped,
        csvTruncated: false,
        stopReason,
        chargedEvents: billed,
        billed,
        wouldBeBilled,
    };
}

function baseSummary(mode: 'crawl' | 'list', stopReason: string | null): Record<string, unknown> {
    return {
        mode,
        sites: [],
        datasetRowsRead: 0,
        datasetRowsIgnored: 0,
        duplicateInputs: 0,
        unbilledRowsCapped: 0,
        csvTruncated: false,
        stopReason,
        chargedEvents: { 'link-checked': 0, 'page-crawled': 0 },
        billed: { 'link-checked': 0, 'page-crawled': 0 },
        wouldBeBilled: { 'link-checked': 0, 'page-crawled': 0 },
    };
}

function doneMessage(summary: Record<string, unknown>): string {
    const sites = (summary.sites as Array<Record<string, unknown>>) ?? [];
    let pages = 0;
    let checked = 0;
    let broken = 0;
    let restricted = 0;
    let redirects = 0;
    let skipped = 0;
    let unverified = 0;
    let notChecked = 0;
    const reasons = new Set<string>();
    for (const site of sites) {
        pages += Number(site.pagesCrawled ?? 0);
        const by = site.byStatus as Record<string, number>;
        checked += (by?.ok ?? 0) + (by?.redirect ?? 0) + (by?.broken ?? 0) + (by?.restricted ?? 0);
        broken += by?.broken ?? 0;
        restricted += by?.restricted ?? 0;
        redirects += by?.redirect ?? 0;
        skipped += by?.skipped ?? 0;
        unverified += by?.unverified ?? 0;
        const missed = site.notChecked as Record<string, number>;
        for (const [key, value] of Object.entries(missed ?? {})) {
            if (value > 0) {
                notChecked += value;
                reasons.add(reasonLabel(key));
            }
        }
    }
    const reason = reasons.size > 0 ? ` (${[...reasons].join(', ')})` : '';
    const tail = `${checked} links checked (${broken} broken, ${restricted} restricted, ${redirects} redirects), ${skipped} skipped, ${unverified} unverified, ${notChecked} not checked${reason}`;
    if (summary.mode === 'list') return `Done: ${tail}`;
    return `Done: ${pages} pages, ${tail}`;
}

function reasonLabel(key: string): string {
    if (key === 'NOT_CHECKED_LIMIT') return 'max links';
    if (key === 'EXTERNAL_NOT_CHECKED') return 'external off';
    if (key === 'EXCLUDED_BY_FILTER') return 'filtered';
    if (key === 'CHARGE_LIMIT_REACHED') return 'charge limit';
    if (key === 'TIME_LIMIT_REACHED') return 'time limit';
    return key;
}

async function loadState(): Promise<SavedState | null> {
    const raw = await Actor.getValue<Uint8Array | Buffer | { gzip?: string }>('STATE');
    if (!raw) return null;
    try {
        const buffer = Buffer.isBuffer(raw) ? raw : raw instanceof Uint8Array ? Buffer.from(raw) : Buffer.from(raw.gzip ?? '', 'base64');
        if (buffer.length === 0) return null;
        const json = gunzipSync(buffer).toString('utf8');
        const parsed = JSON.parse(json) as SavedState;
        if (parsed.v !== 1) return null;
        return parsed;
    } catch {
        return null;
    }
}

interface CrawlArgs {
    resolved: ResolvedInput;
    urls: string[];
    sites: Map<string, SiteAcc>;
    links: Map<string, LinkRec>;
    pages: PageRec[];
    checker: ReturnType<typeof createChecker>;
    robots: RobotsCache;
    canReserve: (links: number, pages: number) => boolean;
    bumpNot: (site: SiteAcc, key: NotCheckedKey) => void;
    reserved: () => number;
    addReserved: (n: number) => void;
    addPendingPage: () => void;
    takePendingPages: () => Promise<void>;
    shouldStop: () => boolean;
    abandonQueue: () => boolean;
    stopKind: () => NotCheckedKey;
    noteStop: (reason: string) => void;
    onTimeout: () => void;
    minDelay: number;
}

async function crawl(args: CrawlArgs): Promise<void> {
    const queue: Array<{ url: string; depth: number; site: string; asLink: boolean; seq: number }> = [];
    let seq = args.pages.length;
    const queuedPages = new Set<string>(args.pages.map((page) => page.pageUrl));
    for (const url of args.urls) {
        const grouped = originOf(url);
        if (!grouped) continue;
        const site = siteFor(args.sites, grouped.origin, grouped.host, args.minDelay);
        if (!matchesFilter(url, args.resolved)) {
            args.bumpNot(site, 'EXCLUDED_BY_FILTER');
            continue;
        }
        if (queuedPages.has(url)) continue;
        queuedPages.add(url);
        queue.push({ url, depth: 0, site: site.site, asLink: args.links.has(url), seq: seq++ });
    }
    for (const link of args.links.values()) {
        if (link.result || queuedPages.has(link.url)) continue;
        queuedPages.add(link.url);
        queue.push({ url: link.url, depth: args.resolved.maxDepth + 1, site: link.site, asLink: true, seq: seq++ });
    }
    const pagesStartedBySite = new Map<string, number>();
    for (const page of args.pages) {
        pagesStartedBySite.set(page.site, (pagesStartedBySite.get(page.site) ?? 0) + 1);
    }
    let totalStarted = args.pages.length;
    let inFlight = 0;
    const workers = Math.max(1, Math.min(args.resolved.maxConcurrency, 8));

    const handle = async (task: { url: string; depth: number; site: string; asLink: boolean; seq: number }): Promise<void> => {
        const site = args.sites.get(task.site) ?? siteFor(args.sites, task.site, new URL(task.url).hostname, args.minDelay);
        const perSiteStarted = pagesStartedBySite.get(task.site) ?? 0;
        const crawlThis = task.depth <= args.resolved.maxDepth
            && perSiteStarted < args.resolved.maxPagesPerSite
            && totalStarted < maxPagesRunCap();
        const asLink = task.asLink || args.links.has(task.url);
        if (!asLink && !crawlThis) {
            args.noteStop('MAX_PAGES_REACHED');
            return;
        }
        if (asLink && !args.links.get(task.url)?.result) {
            if (!args.canReserve(1, crawlThis ? 1 : 0)) {
                args.bumpNot(site, 'CHARGE_LIMIT_REACHED');
                return;
            }
            args.addReserved(1);
        } else if (crawlThis && !args.canReserve(0, 1)) {
            args.bumpNot(site, 'CHARGE_LIMIT_REACHED');
            return;
        }
        if (crawlThis) {
            pagesStartedBySite.set(task.site, perSiteStarted + 1);
            totalStarted += 1;
        }
        const result = await args.checker.check(task.url, { readBody: crawlThis });
        await applyRobots(site, args.robots, task.url);
        if (result.discarded) {
            if (asLink) args.addReserved(-1);
            return;
        }
        if (asLink) {
            const link = args.links.get(task.url);
            if (link) link.result = result;
            if (!result.classification.billable) args.addReserved(-1);
        }
        const html = Boolean(result.body && looksLikeHtml(result.contentType, result.body));
        const okPage = result.finalStatusCode !== null && result.finalStatusCode >= 200 && result.finalStatusCode < 300 && html;
        if (!crawlThis) return;
        if (!okPage) {
            const httpOk = result.finalStatusCode !== null && result.finalStatusCode >= 200 && result.finalStatusCode < 300;
            if (result.classification.errorCode === 'BLOCKED_BY_ROBOTS') site.pagesBlockedByRobots += 1;
            else if (!httpOk) site.pagesFailed += 1;
            if (!asLink) {
                await pushFree(errorRow(site.site, 'START_URL_FAILED', errorMessage('START_URL_FAILED') ?? 'Start URL failed', result.classification.errorCode));
            }
            return;
        }
        let extracted;
        try {
            extracted = extractLinks(result.body?.toString('utf8') ?? '', args.resolved.checkAssetLinks);
        } catch {
            site.pagesFailed += 1;
            return;
        }
        const page: PageRec = {
            site: site.site,
            pageUrl: task.url,
            depth: task.depth,
            seq: task.seq,
            truncated: result.truncated,
            linksFound: 0,
            linkUrls: [],
            mailto: 0,
            tel: 0,
            javascript: 0,
            other: 0,
            fragment: 0,
        };
        if (result.truncated) site.pagesTruncated += 1;
        const nofollow = result.nofollow || extracted.nofollow;
        const seenOnPage = new Set<string>();
        for (const found of extracted.links) {
            const kind = classifyHref(found.href, task.url);
            if (kind.kind === 'fragment') {
                page.fragment += 1;
                site.fragmentOnlyLinks += 1;
                continue;
            }
            if (kind.kind === 'scheme') {
                if (kind.scheme === 'mailto') {
                    page.mailto += 1;
                    site.schemes.mailto += 1;
                } else if (kind.scheme === 'tel') {
                    page.tel += 1;
                    site.schemes.tel += 1;
                } else if (kind.scheme === 'javascript') {
                    page.javascript += 1;
                    site.schemes.javascript += 1;
                } else {
                    page.other += 1;
                    site.schemes.other += 1;
                }
                continue;
            }
            if (kind.kind === 'invalid') {
                const raw = redactLooseText(kind.raw);
                const key = `invalid:${raw}`;
                if (!args.links.has(key)) {
                    args.links.set(key, {
                        url: raw,
                        site: site.site,
                        linkType: 'internal',
                        element: found.element,
                        sources: [],
                        sourceCount: 0,
                        result: {
                            url: raw,
                            classification: { checkStatus: 'skipped', errorCode: 'INVALID_URL', billable: false },
                            statusCode: null,
                            finalStatusCode: null,
                            finalUrl: null,
                            redirectCount: 0,
                            redirectChain: null,
                            responseTimeMs: null,
                            method: null,
                            errorDetail: null,
                            errorMessage: errorMessage('INVALID_URL'),
                            body: null,
                            truncated: false,
                            contentType: null,
                            nofollow: false,
                            discarded: false,
                        },
                    });
                }
                continue;
            }
            const canonical = redactHttpUrl(kind.url.href);
            if (!canonical) continue;
            const host = new URL(canonical).hostname;
            const internal = sameSite(host, site.host, args.resolved.includeSubdomains);
            if (!seenOnPage.has(canonical)) {
                seenOnPage.add(canonical);
                const existing = args.links.get(canonical);
                if (existing) {
                    page.linksFound += 1;
                    site.linksFound += 1;
                    page.linkUrls.push(canonical);
                    existing.sourceCount += 1;
                    existing.sources.push({ pageUrl: task.url, anchorText: found.anchorText, element: found.element, pageSeq: task.seq });
                    existing.sources.sort((a, b) => a.pageSeq - b.pageSeq);
                    if (existing.sources.length > args.resolved.maxSourcesPerLink) existing.sources.length = args.resolved.maxSourcesPerLink;
                } else if (!matchesFilter(canonical, args.resolved)) {
                    page.linksFound += 1;
                    site.linksFound += 1;
                    args.bumpNot(site, 'EXCLUDED_BY_FILTER');
                } else if (!internal && !args.resolved.checkExternalLinks) {
                    page.linksFound += 1;
                    site.linksFound += 1;
                    args.bumpNot(site, 'EXTERNAL_NOT_CHECKED');
                } else if (args.links.size >= args.resolved.maxLinks) {
                    page.linksFound += 1;
                    site.linksFound += 1;
                    args.bumpNot(site, 'NOT_CHECKED_LIMIT');
                } else {
                    page.linksFound += 1;
                    site.linksFound += 1;
                    page.linkUrls.push(canonical);
                    args.links.set(canonical, {
                        url: canonical,
                        site: site.site,
                        linkType: internal ? 'internal' : 'external',
                        element: found.element,
                        sources: [{ pageUrl: task.url, anchorText: found.anchorText, element: found.element, pageSeq: task.seq }],
                        sourceCount: 1,
                    });
                    const childDepth = task.depth + 1;
                    const candidate = internal && !nofollow && found.element === 'a' && childDepth <= args.resolved.maxDepth;
                    if (!queuedPages.has(canonical)) {
                        queuedPages.add(canonical);
                        queue.push({
                            url: canonical,
                            depth: candidate ? childDepth : args.resolved.maxDepth + 1,
                            site: site.site,
                            asLink: true,
                            seq: seq++,
                        });
                    }
                }
            } else {
                page.linksFound += 1;
                site.linksFound += 1;
            }
        }
        args.pages.push(page);
        site.pagesCrawled += 1;
        args.addPendingPage();
        if ((getChargedCounts()['page-crawled'] ?? 0) + 0 >= 0 && site.pagesCrawled % 50 === 0) await args.takePendingPages();
    };

    const active = new Set<Promise<void>>();
    while ((queue.length > 0 || active.size > 0) && (active.size > 0 || !args.shouldStop())) {
        if (args.abandonQueue() && queue.length > 0) {
            args.onTimeout();
            const reason = args.stopKind();
            while (queue.length > 0) {
                const skipped = queue.shift();
                if (!skipped) break;
                const site = args.sites.get(skipped.site);
                const existing = skipped.url ? args.links.get(skipped.url) : undefined;
                if (!site || existing?.result) continue;
                if (existing) args.links.delete(skipped.url);
                args.bumpNot(site, reason);
            }
        }
        while (queue.length > 0 && active.size < workers && !args.shouldStop()) {
            const task = queue.shift();
            if (!task) break;
            const job = handle(task).finally(() => {
                active.delete(job);
            });
            active.add(job);
            inFlight = active.size;
        }
        if (active.size === 0) break;
        await Promise.race(active);
    }
    args.onTimeout();
    void inFlight;
    await args.takePendingPages();
}
