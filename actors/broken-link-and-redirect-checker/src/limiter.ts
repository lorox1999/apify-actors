function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Waiter {
    host: string;
    resolve: () => void;
}

/**
 * Global cap plus a per-host cap and a minimum gap between request starts.
 * A host can be pinned to one in-flight request after HTTP 429 or a Retry-After 503.
 */
export class HostScheduler {
    private globalActive = 0;
    private readonly hostActive = new Map<string, number>();
    private readonly hostMax = new Map<string, number>();
    private readonly hostDelay = new Map<string, number>();
    private readonly hostNext = new Map<string, number>();
    private readonly waiters: Waiter[] = [];
    private timer: NodeJS.Timeout | null = null;
    private closed = false;

    constructor(
        private readonly globalMax: number,
        private readonly defaultHostMax: number,
        private readonly defaultDelayMs: number,
    ) {}

    setHostDelay(host: string, delayMs: number): void {
        const next = Math.max(this.hostDelay.get(host) ?? this.defaultDelayMs, delayMs);
        this.hostDelay.set(host, next);
    }

    pinHostToOne(host: string): void {
        this.hostMax.set(host, 1);
        this.pump();
    }

    /** Make the next start on this host wait at least `delayMs` from now. */
    delayNext(host: string, delayMs: number): void {
        const at = Date.now() + delayMs;
        const prev = this.hostNext.get(host) ?? 0;
        if (at > prev) this.hostNext.set(host, at);
    }

    async acquire(host: string): Promise<void> {
        if (this.closed) return;
        await new Promise<void>((resolve) => {
            this.waiters.push({ host, resolve });
            this.pump();
        });
    }

    release(host: string): void {
        this.globalActive = Math.max(0, this.globalActive - 1);
        this.hostActive.set(host, Math.max(0, (this.hostActive.get(host) ?? 1) - 1));
        this.pump();
    }

    close(): void {
        this.closed = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        while (this.waiters.length > 0) {
            this.waiters.shift()?.resolve();
        }
    }

    private delayFor(host: string): number {
        return this.hostDelay.get(host) ?? this.defaultDelayMs;
    }

    private maxFor(host: string): number {
        return this.hostMax.get(host) ?? this.defaultHostMax;
    }

    private pump(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const now = Date.now();
        let soonest = Number.POSITIVE_INFINITY;
        for (let index = 0; index < this.waiters.length; ) {
            if (this.globalActive >= this.globalMax) break;
            const waiter = this.waiters[index];
            if (!waiter) break;
            const active = this.hostActive.get(waiter.host) ?? 0;
            const nextAt = this.hostNext.get(waiter.host) ?? 0;
            if (active >= this.maxFor(waiter.host)) {
                index += 1;
                continue;
            }
            if (now < nextAt) {
                soonest = Math.min(soonest, nextAt);
                index += 1;
                continue;
            }
            this.waiters.splice(index, 1);
            this.globalActive += 1;
            this.hostActive.set(waiter.host, active + 1);
            this.hostNext.set(waiter.host, Date.now() + this.delayFor(waiter.host));
            waiter.resolve();
        }
        if (Number.isFinite(soonest) && this.waiters.length > 0 && !this.closed) {
            const wait = Math.max(1, soonest - Date.now());
            this.timer = setTimeout(() => this.pump(), wait);
        }
    }
}

export { sleep };
