import { Actor } from 'apify';

export interface ChargeOutcome {
    /** Events `Actor.charge` actually billed. Zero when the run is not pay-per-event, or when the charge was refused. */
    chargedCount: number;
    /**
     * Events accepted as billable work. Matches `chargedCount` on a pay-per-event run.
     * On an unmetered run this is the count that would have been billed.
     */
    wouldBeChargedCount: number;
    /** True when the dataset row was written, or when an extra event was accepted. */
    accepted: boolean;
    limitReached: boolean;
}

/** Dataset rows are written in chunks so a large sitemap does not push one item at a time. */
const DATASET_BATCH_SIZE = 500;

const counts = new Map<string, number>();
const wouldBeCounts = new Map<string, number>();
const pending: Record<string, unknown>[] = [];
let writeQueue: Promise<void> = Promise.resolve();

export function resetChargedCounts(): void {
    counts.clear();
    wouldBeCounts.clear();
    pending.length = 0;
}

/** Events `Actor.charge` actually billed. Empty when the run is not pay-per-event. */
export function getChargedCounts(): Record<string, number> {
    return Object.fromEntries(counts);
}

/** Accepted billable work, including events that were not billed because the run is unmetered. */
export function getWouldBeChargedCounts(): Record<string, number> {
    return Object.fromEntries(wouldBeCounts);
}

function addCount(eventName: string, n: number): void {
    if (n <= 0) return;
    counts.set(eventName, (counts.get(eventName) ?? 0) + n);
}

function addWouldBe(eventName: string, n: number): void {
    if (n <= 0) return;
    wouldBeCounts.set(eventName, (wouldBeCounts.get(eventName) ?? 0) + n);
}

/** Rows that already have a `charged` field report whether this call billed them. */
function stampCharged(item: Record<string, unknown>, charged: boolean): void {
    if ('charged' in item) item.charged = charged;
}

function refused(): ChargeOutcome {
    return { chargedCount: 0, wouldBeChargedCount: 0, accepted: false, limitReached: true };
}

interface ChargingManagerLike {
    calculateMaxEventChargeCountWithinLimit?: (eventName: string) => number;
    chargeableWithinLimit?: Record<string, number>;
    getChargedEventCount?: (eventName: string) => number;
    getPricingInfo?: () => { isPayPerEvent?: boolean };
}

/**
 * True when the run is known NOT to use pay-per-event pricing (e.g. a private
 * deployment before pricing is configured). Actor.charge() then returns
 * chargedCount = 0 for every event. Rows are still written, with `charged`
 * false when that field exists, and the work is counted as would-be-charged
 * rather than billed.
 */
export function isUnmetered(): boolean {
    try {
        const manager = Actor.getChargingManager() as ChargingManagerLike;
        if (typeof manager.getPricingInfo !== 'function') return false;
        return manager.getPricingInfo().isPayPerEvent === false;
    } catch {
        return false;
    }
}

export async function canAfford(eventName: string, n = 1): Promise<boolean> {
    if (isUnmetered()) return true;
    const manager = Actor.getChargingManager() as ChargingManagerLike;
    if (typeof manager.calculateMaxEventChargeCountWithinLimit === 'function') {
        return manager.calculateMaxEventChargeCountWithinLimit(eventName) >= n;
    }
    const within = manager.chargeableWithinLimit?.[eventName];
    if (typeof within === 'number') return within >= n;
    return true;
}

async function enqueueDataset(item: Record<string, unknown>): Promise<void> {
    pending.push(item);
    if (pending.length >= DATASET_BATCH_SIZE) await flushDataset();
}

/**
 * Write any buffered dataset rows. Charging stays per row; this only batches the writes.
 * Safe to call more than once. Concurrent callers share one ordered write queue.
 */
export async function flushDataset(): Promise<void> {
    if (pending.length > 0) {
        const batch = pending.splice(0, pending.length);
        writeQueue = writeQueue.then(() => Actor.pushData(batch));
    }
    await writeQueue;
}

/**
 * Charge with Actor.charge(), then keep the dataset row only when the charge
 * succeeded. pushData is called without an event name so the removed
 * apify-default-dataset-item event is never used. Rows are flushed in batches.
 */
export async function pushCharged(item: Record<string, unknown>, eventName: string): Promise<ChargeOutcome> {
    if (isUnmetered()) {
        stampCharged(item, false);
        await enqueueDataset(item);
        addWouldBe(eventName, 1);
        return { chargedCount: 0, wouldBeChargedCount: 1, accepted: true, limitReached: false };
    }
    if (!(await canAfford(eventName, 1))) {
        stampCharged(item, false);
        return refused();
    }
    const result = await Actor.charge({ eventName, count: 1 });
    const chargedCount = result.chargedCount ?? 0;
    if (chargedCount > 0) {
        stampCharged(item, true);
        await enqueueDataset(item);
        addCount(eventName, chargedCount);
        addWouldBe(eventName, chargedCount);
        return {
            chargedCount,
            wouldBeChargedCount: chargedCount,
            accepted: true,
            limitReached: Boolean(result.eventChargeLimitReached),
        };
    }
    stampCharged(item, false);
    return refused();
}

export async function pushFree(item: Record<string, unknown>): Promise<void> {
    await enqueueDataset(item);
}

export async function chargeExtra(eventName: string, count = 1): Promise<ChargeOutcome> {
    if (isUnmetered()) {
        addWouldBe(eventName, count);
        return { chargedCount: 0, wouldBeChargedCount: count, accepted: true, limitReached: false };
    }
    if (!(await canAfford(eventName, count))) {
        return refused();
    }
    const result = await Actor.charge({ eventName, count });
    const chargedCount = result.chargedCount ?? 0;
    if (chargedCount > 0) {
        addCount(eventName, chargedCount);
        addWouldBe(eventName, chargedCount);
    }
    return {
        chargedCount,
        wouldBeChargedCount: chargedCount,
        accepted: chargedCount > 0,
        limitReached: Boolean(result.eventChargeLimitReached) || chargedCount < count,
    };
}
