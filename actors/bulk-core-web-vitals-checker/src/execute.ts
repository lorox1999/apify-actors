import { Actor, log } from 'apify';
import { canAfford, clearSecrets, createSafeLogger, errorMessage, flushDataset, getChargedCounts, pushCharged, pushFree, registerSecret, resetChargedCounts } from '@apify-actors/common';

import { AuditFailed, describeFailure } from './failures.js';
import { FatalInputError } from './fatal.js';
import { checkUrl, isLowMemoryForLighthouse, resolveInput } from './input.js';
import { createLocalAuditor, type LocalAuditor } from './lighthouseRunner.js';
import { normalizeLighthouseResult, runtimeErrorCode } from './normalize.js';
import { precheckUrl } from './precheck.js';
import { runPsi } from './psi.js';
import { robotsAllows } from './robots.js';
import { errorRow } from './rows.js';
import type { ActorInput, Device, Engine, FieldData, LhrLike, RunSummary } from './types.js';

export interface ExecuteOverrides {
    auditor?: LocalAuditor;
    precheck?: typeof precheckUrl;
    robotsAllow?: typeof robotsAllows;
    runPsi?: typeof runPsi;
    loadDataset?: (id: string, field: string) => Promise<string[]>;
    now?: () => string;
    /** Test override for the per-audit timer. Production uses perUrlTimeoutSecs. */
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    logger?: { info: (message: string) => void; warning: (message: string) => void; error: (message: string) => void };
    fetchImpl?: typeof fetch;
}

interface Job {
    url: string;
    strategy: Device;
}

const PSI_CONCURRENCY = 4;

function eventName(engine: Engine): 'url-audited-local' | 'url-audited' {
    return engine === 'local' ? 'url-audited-local' : 'url-audited';
}

async function defaultLoadDataset(id: string, field: string): Promise<string[]> {
    const dataset = await Actor.openDataset(id);
    const urls: string[] = [];
    await dataset.forEach((item: Record<string, unknown>) => {
        if (item.recordType === 'error') return;
        const value = item[field];
        if (typeof value === 'string' && value.trim()) urls.push(value.trim());
    });
    return urls;
}

function withTimeout<T>(timeoutMs: number, timeoutSecs: number, fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const pending = fn();
    const guarded = pending.catch((error: unknown) => {
        throw error;
    });
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AuditFailed('TIMEOUT', { timeoutSecs })), timeoutMs);
    });
    return Promise.race([guarded, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
        pending.catch(() => undefined);
    });
}

function createLock(): <T>(fn: () => Promise<T>) => Promise<T> {
    let chain: Promise<unknown> = Promise.resolve();
    return <T>(fn: () => Promise<T>): Promise<T> => {
        const run = chain.then(fn, fn);
        chain = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    };
}

function emptySummary(urlsRequested: number, auditsPlanned: number): RunSummary {
    return {
        audited: 0,
        failed: 0,
        failedByCode: {},
        billed: {},
        averageAuditDurationMs: null,
        chargeLimitReached: false,
        urlsRequested,
        auditsPlanned,
        notAudited: 0,
    };
}

function statusMessage(summary: RunSummary, lowMemory: boolean): string {
    if (lowMemory) return 'Not enough memory for local Lighthouse. Set the run memory to at least 4096 MB.';
    const codes = Object.keys(summary.failedByCode);
    const reason = codes.length > 0 ? ` (${codes.join(', ')})` : '';
    const limit = summary.chargeLimitReached ? ' Charge limit reached; remaining URLs were not audited.' : '';
    const billed = Object.values(summary.billed).reduce((sum, count) => sum + count, 0);
    return `Done: ${summary.audited} audited, ${summary.failed} failed${reason}, ${billed} billed.${limit}`;
}

export async function execute(raw: ActorInput | null | undefined, overrides: ExecuteOverrides = {}): Promise<string> {
    resetChargedCounts();
    clearSecrets();
    const input = resolveInput(raw);
    if (input.psiApiKey) registerSecret(input.psiApiKey);

    const logger = overrides.logger ?? createSafeLogger({
        debug: (message) => log.debug(message),
        info: (message) => log.info(message),
        warning: (message) => log.warning(message),
        error: (message) => log.error(message),
    });
    const now = overrides.now ?? (() => new Date().toISOString());
    const precheck = overrides.precheck ?? ((url: string) => precheckUrl(url, overrides.fetchImpl));
    const robotsAllow = overrides.robotsAllow ?? ((url: string) => robotsAllows(url, overrides.fetchImpl));
    const callPsi = overrides.runPsi ?? runPsi;
    const loadDataset = overrides.loadDataset ?? defaultLoadDataset;
    const auditor = overrides.auditor ?? createLocalAuditor();
    const event = eventName(input.engine);
    const timeoutMs = overrides.timeoutMs ?? input.perUrlTimeoutSecs * 1000;

    let jobs: Job[] = [];
    let summary = emptySummary(0, 0);
    const durations: number[] = [];
    let lowMemory = false;

    const recordError = async (job: Job, failure: AuditFailed, auditDurationMs?: number): Promise<void> => {
        summary.failed += 1;
        summary.failedByCode[failure.errorCode] = (summary.failedByCode[failure.errorCode] ?? 0) + 1;
        await pushFree(errorRow({
            url: job.url,
            strategy: job.strategy,
            engine: input.engine,
            errorCode: failure.errorCode,
            errorMessage: describeFailure(failure),
            auditedAt: now(),
            auditDurationMs: auditDurationMs ?? null,
        }) as unknown as Record<string, unknown>);
    };

    try {
    let urls = [...input.rawUrls];
    if (input.urlsDataset) {
        try {
            urls = urls.concat(await loadDataset(input.urlsDataset, input.urlsDatasetField));
        } catch {
            logger.warning('Dataset read failed.');
            throw new FatalInputError('The dataset could not be read.');
        }
    }
    urls = urls.slice(0, input.maxUrls);
    if (urls.length === 0) {
        throw new FatalInputError(errorMessage('NO_URLS'));
    }

    jobs = urls.flatMap((url) => input.devices.map((strategy) => ({ url, strategy })));
    summary = emptySummary(urls.length, jobs.length);
    lowMemory = input.engine === 'local' && isLowMemoryForLighthouse();

    if (lowMemory) {
        for (const job of jobs) {
            const checked = checkUrl(job.url);
            await recordError({ url: checked.url, strategy: job.strategy }, new AuditFailed('LOW_MEMORY_FOR_LIGHTHOUSE'));
        }
    } else {
        await runJobs();
    }

    await flushDataset();
    summary.billed = getChargedCounts();
    summary.averageAuditDurationMs = durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null;
    const message = statusMessage(summary, lowMemory);
    await Actor.setValue('SUMMARY', summary);
    await Actor.setStatusMessage(message);
    logger.info(message);
    return message;
    } finally {
        await auditor.restart().catch(() => undefined);
    }

    async function runJobs(): Promise<void> {
        const queue = [...jobs];
        let stopForCharge = false;
        let stopForKey = false;
        let inflight = 0;
        const lock = createLock();
        const concurrency = input.engine === 'local' ? 1 : PSI_CONCURRENCY;

        async function worker(): Promise<void> {
            for (;;) {
                const next = queue.shift();
                if (!next) return;
                if (stopForKey) {
                    const checked = checkUrl(next.url);
                    await recordError({ url: checked.url, strategy: next.strategy }, new AuditFailed('PSI_KEY_INVALID'));
                    continue;
                }
                if (stopForCharge) {
                    summary.notAudited += 1;
                    continue;
                }
                await runJob(next);
            }
        }

        async function reserve(): Promise<boolean> {
            return lock(async () => {
                if (stopForCharge || stopForKey) return false;
                if (!(await canAfford(event, inflight + 1))) {
                    stopForCharge = true;
                    summary.chargeLimitReached = true;
                    return false;
                }
                inflight += 1;
                return true;
            });
        }

        function release(): void {
            inflight = Math.max(0, inflight - 1);
        }

        async function runJob(job: Job): Promise<void> {
            const checked = checkUrl(job.url);
            if (!checked.ok) {
                await recordError({ url: checked.url, strategy: job.strategy }, new AuditFailed('INVALID_URL', { messageOverride: checked.message }));
                return;
            }
            const safeJob = { url: checked.url, strategy: job.strategy };
            try {
                const allowed = await robotsAllow(safeJob.url);
                if (!allowed) {
                    await recordError(safeJob, new AuditFailed('BLOCKED_BY_ROBOTS'));
                    return;
                }
                if (input.precheckReachability) {
                    await precheck(safeJob.url);
                }
            } catch (error) {
                const failure = error instanceof AuditFailed ? error : new AuditFailed('UNREACHABLE');
                await recordError(safeJob, failure);
                return;
            }

            if (stopForKey) {
                await recordError(safeJob, new AuditFailed('PSI_KEY_INVALID'));
                return;
            }
            if (!(await reserve())) {
                if (stopForKey) await recordError(safeJob, new AuditFailed('PSI_KEY_INVALID'));
                else summary.notAudited += 1;
                return;
            }

            const started = Date.now();
            try {
                const outcome = await auditJob(safeJob);
                const row = normalizeLighthouseResult({
                    lhr: outcome.lhr,
                    url: safeJob.url,
                    strategy: safeJob.strategy,
                    engine: input.engine,
                    categories: input.categories,
                    maxOpportunities: input.maxOpportunities,
                    auditDurationMs: Date.now() - started,
                    auditedAt: now(),
                    field: outcome.field,
                });
                const charge = await pushCharged(row as unknown as Record<string, unknown>, event);
                if (charge.chargedCount < 1) {
                    stopForCharge = true;
                    summary.chargeLimitReached = true;
                    summary.notAudited += 1;
                    return;
                }
                summary.audited += 1;
                durations.push(row.auditDurationMs ?? 0);
                if (charge.limitReached) {
                    stopForCharge = true;
                    summary.chargeLimitReached = true;
                }
            } catch (error) {
                const failure = error instanceof AuditFailed ? error : new AuditFailed(input.engine === 'psi' ? 'PSI_ERROR' : 'LIGHTHOUSE_ERROR');
                if (failure.errorCode === 'PSI_KEY_INVALID') stopForKey = true;
                await recordError(safeJob, failure, Date.now() - started);
            } finally {
                release();
            }
        }

        async function auditJob(job: Job): Promise<{ lhr: LhrLike; field: FieldData | null }> {
            if (input.engine === 'psi') {
                const result = await callPsi({
                    pageUrl: job.url,
                    strategy: job.strategy,
                    categories: input.categories,
                    apiKey: input.psiApiKey ?? '',
                    timeoutMs,
                    ...(overrides.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
                    ...(overrides.sleep ? { sleep: overrides.sleep } : {}),
                    logger,
                });
                const code = runtimeErrorCode(result.lhr);
                if (code) throw new AuditFailed('PSI_ERROR', { lighthouseCode: code });
                return { lhr: result.lhr, field: result.field };
            }
            return { lhr: await auditLocalWithRetries(job), field: null };
        }

        async function auditLocalWithRetries(job: Job): Promise<LhrLike> {
            const attempts = input.retries + 1;
            let last: unknown;
            for (let attempt = 0; attempt < attempts; attempt += 1) {
                try {
                    return await withTimeout(timeoutMs, input.perUrlTimeoutSecs, () => auditor.audit({
                        url: job.url,
                        strategy: job.strategy,
                        categories: input.categories,
                        timeoutMs,
                    }));
                } catch (error) {
                    last = error;
                    const failure = error instanceof AuditFailed ? error : new AuditFailed('LIGHTHOUSE_ERROR');
                    if (failure.errorCode === 'TIMEOUT' || failure.errorCode === 'CHROME_CRASH') {
                        await auditor.restart().catch(() => undefined);
                    }
                    const retryable = failure.errorCode === 'TIMEOUT' || failure.errorCode === 'CHROME_CRASH';
                    if (!retryable || attempt === attempts - 1) throw failure;
                }
            }
            throw last instanceof AuditFailed ? last : new AuditFailed('LIGHTHOUSE_ERROR');
        }

        await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
        if (stopForCharge) summary.notAudited += queue.length;
        queue.length = 0;
    }
}
