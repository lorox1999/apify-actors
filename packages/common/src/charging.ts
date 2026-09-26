import { Actor } from 'apify';

export interface ChargeOutcome {
    chargedCount: number;
    limitReached: boolean;
}

/** Dataset rows are written in chunks so a large sitemap does not push one item at a time. */
const DATASET_BATCH_SIZE = 500;

const counts = new Map<string, number>();
const pending: Record<string, unknown>[] = [];
let writeQueue: Promise<void> = Promise.resolve();

export function resetChargedCounts(): void {
    counts.clear();
    pending.length = 0;
}

export function getChargedCounts(): Record<string, number> {
    return Object.fromEntries(counts);
}

function addCount(eventName: string, n: number): void {
    counts.set(eventName, (counts.get(eventName) ?? 0) + n);
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
 * chargedCount = 0 for every event, so without this check no row would ever be
 * written. In that case work proceeds unmetered (nothing is billed).
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
        await enqueueDataset(item);
        addCount(eventName, 1);
        return { chargedCount: 1, limitReached: false };
    }
    if (!(await canAfford(eventName, 1))) {
        return { chargedCount: 0, limitReached: true };
    }
    const result = await Actor.charge({ eventName, count: 1 });
    const chargedCount = result.chargedCount ?? 0;
    if (chargedCount > 0) {
        await enqueueDataset(item);
        addCount(eventName, chargedCount);
    }
    return {
        chargedCount,
        limitReached: Boolean(result.eventChargeLimitReached) || chargedCount < 1,
    };
}

export async function pushFree(item: Record<string, unknown>): Promise<void> {
    await enqueueDataset(item);
}

export async function chargeExtra(eventName: string, count = 1): Promise<ChargeOutcome> {
    if (isUnmetered()) {
        addCount(eventName, count);
        return { chargedCount: count, limitReached: false };
    }
    if (!(await canAfford(eventName, count))) {
        return { chargedCount: 0, limitReached: true };
    }
    const result = await Actor.charge({ eventName, count });
    const chargedCount = result.chargedCount ?? 0;
    if (chargedCount > 0) addCount(eventName, chargedCount);
    return {
        chargedCount,
        limitReached: Boolean(result.eventChargeLimitReached) || chargedCount < count,
    };
}
