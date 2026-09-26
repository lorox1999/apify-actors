import { Actor } from 'apify';

export interface ChargeOutcome {
    chargedCount: number;
    limitReached: boolean;
}

const counts = new Map<string, number>();

export function resetChargedCounts(): void {
    counts.clear();
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
}

export async function canAfford(eventName: string, n = 1): Promise<boolean> {
    const manager = Actor.getChargingManager() as ChargingManagerLike;
    if (typeof manager.calculateMaxEventChargeCountWithinLimit === 'function') {
        return manager.calculateMaxEventChargeCountWithinLimit(eventName) >= n;
    }
    const within = manager.chargeableWithinLimit?.[eventName];
    if (typeof within === 'number') return within >= n;
    return true;
}

/**
 * Charge with Actor.charge(), then push the dataset row only when the charge
 * succeeded. pushData is called without an event name so the removed
 * apify-default-dataset-item event is never used.
 */
export async function pushCharged(item: Record<string, unknown>, eventName: string): Promise<ChargeOutcome> {
    if (!(await canAfford(eventName, 1))) {
        return { chargedCount: 0, limitReached: true };
    }
    const result = await Actor.charge({ eventName, count: 1 });
    const chargedCount = result.chargedCount ?? 0;
    if (chargedCount > 0) {
        await Actor.pushData(item);
        addCount(eventName, chargedCount);
    }
    return {
        chargedCount,
        limitReached: Boolean(result.eventChargeLimitReached) || chargedCount < 1,
    };
}

export async function pushFree(item: Record<string, unknown>): Promise<void> {
    await Actor.pushData(item);
}

export async function chargeExtra(eventName: string, count = 1): Promise<ChargeOutcome> {
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
