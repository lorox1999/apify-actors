import { createRequire } from 'node:module';

import { classifyThrown, type NetworkFailure } from '@apify-actors/common';

import { HostScheduler } from './limiter.js';
import { CRAWL_DELAY_CAP_MS, ROBOTS_BYTE_CAP, USER_AGENT_TOKEN, userAgent } from './types.js';

const require = createRequire(import.meta.url);

interface RobotParser {
    isAllowed(url: string, ua?: string): boolean | undefined;
    getCrawlDelay(ua?: string): number | undefined;
}

const robotsParser = require('robots-parser') as (url: string, body: string) => RobotParser;

export type RobotsDecision =
    | { kind: 'rules'; found: boolean; delayMs: number; capped: boolean; isAllowed: (url: string) => boolean }
    | { kind: 'unreachable' }
    | { kind: 'network'; failure: NetworkFailure };

async function readText(response: Response, maxBytes: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
            chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
            await reader.cancel().catch(() => undefined);
            break;
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}

export class RobotsCache {
    private readonly cache = new Map<string, Promise<RobotsDecision>>();

    constructor(
        private readonly scheduler: HostScheduler,
        private readonly respect: boolean,
        private readonly timeoutMs: number,
        private readonly minDelayMs: number,
        private readonly fetchImpl: typeof fetch,
        private readonly dispatcher: unknown,
    ) {}

    decision(origin: string, host: string): Promise<RobotsDecision> {
        const cached = this.cache.get(origin);
        if (cached) return cached;
        const pending = this.load(origin, host);
        this.cache.set(origin, pending);
        return pending;
    }

    private async load(origin: string, host: string): Promise<RobotsDecision> {
        if (!this.respect) {
            return { kind: 'rules', found: false, delayMs: this.minDelayMs, capped: false, isAllowed: () => true };
        }
        const robotsUrl = `${origin}/robots.txt`;
        await this.scheduler.acquire(host);
        try {
            const response = await this.fetchImpl(robotsUrl, {
                method: 'GET',
                redirect: 'follow',
                headers: { 'user-agent': userAgent(), accept: 'text/plain,*/*' },
                signal: AbortSignal.timeout(this.timeoutMs),
                dispatcher: this.dispatcher,
            } as RequestInit);
            if (response.status >= 500) {
                await response.body?.cancel().catch(() => undefined);
                return { kind: 'unreachable' };
            }
            if (response.status >= 400) {
                await response.body?.cancel().catch(() => undefined);
                return { kind: 'rules', found: false, delayMs: this.minDelayMs, capped: false, isAllowed: () => true };
            }
            const body = await readText(response, ROBOTS_BYTE_CAP);
            const parsed = robotsParser(robotsUrl, body);
            const seconds = parsed.getCrawlDelay(USER_AGENT_TOKEN) ?? parsed.getCrawlDelay('*');
            let delayMs = this.minDelayMs;
            let capped = false;
            if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds * 1000 > delayMs) {
                const requested = Math.round(seconds * 1000);
                if (requested > CRAWL_DELAY_CAP_MS) {
                    delayMs = CRAWL_DELAY_CAP_MS;
                    capped = true;
                } else {
                    delayMs = requested;
                }
            }
            this.scheduler.setHostDelay(host, delayMs);
            this.scheduler.delayNext(host, delayMs);
            return {
                kind: 'rules',
                found: true,
                delayMs,
                capped,
                isAllowed: (url: string) => parsed.isAllowed(url, USER_AGENT_TOKEN) !== false,
            };
        } catch (error) {
            const failure = classifyThrown(error);
            if (failure.code === 'DNS_NOT_FOUND' || failure.code === 'CONNECTION_REFUSED' || failure.code === 'TLS_ERROR') {
                return { kind: 'network', failure };
            }
            return { kind: 'unreachable' };
        } finally {
            this.scheduler.release(host);
        }
    }
}
