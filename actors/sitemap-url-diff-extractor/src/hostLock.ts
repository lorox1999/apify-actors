const tails = new Map<string, Promise<void>>();
const lastAt = new Map<string, number>();

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function requestGapMs(): number {
    const raw = process.env.SITEMAP_REQUEST_GAP_MS;
    if (raw === undefined || raw === '') return 200;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 200;
}

/** Serializes requests to one host and keeps at least `gapMs` between them. */
export async function withHostGap<T>(host: string, gapMs: number, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(host) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    tails.set(host, prev.then(() => gate, () => gate));
    await prev.catch(() => undefined);
    try {
        if (gapMs > 0 && lastAt.has(host)) {
            const wait = gapMs - (Date.now() - (lastAt.get(host) ?? 0));
            if (wait > 0) await sleep(wait);
        }
        return await fn();
    } finally {
        lastAt.set(host, Date.now());
        release();
    }
}

export async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    if (items.length === 0) return;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) return;
            const item = items[index];
            if (item !== undefined) await fn(item);
        }
    });
    await Promise.all(workers);
}
