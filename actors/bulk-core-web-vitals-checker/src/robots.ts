import { createRequire } from 'node:module';

import { USER_AGENT } from './types.js';

const require = createRequire(import.meta.url);

interface Robot {
    isAllowed(url: string, ua?: string): boolean | undefined;
}

const robotsParser = require('robots-parser') as (url: string, body: string) => Robot;

const ROBOTS_LIMIT = 512_000;

async function readLimited(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > ROBOTS_LIMIT) {
            await reader.cancel().catch(() => undefined);
            return '';
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}

/**
 * Honor robots.txt when it can be read. A missing or unreadable file allows the audit.
 * Disallow is never bypassed with another IP or a proxy.
 */
export async function robotsAllows(pageUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
    let robotsUrl: string;
    try {
        const url = new URL(pageUrl);
        robotsUrl = `${url.origin}/robots.txt`;
    } catch {
        return true;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetchImpl(robotsUrl, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'user-agent': USER_AGENT, accept: 'text/plain,*/*' },
        });
        if (response.status === 404 || response.status === 410) {
            await response.body?.cancel().catch(() => undefined);
            return true;
        }
        if (response.status < 200 || response.status >= 300) {
            await response.body?.cancel().catch(() => undefined);
            return true;
        }
        const body = await readLimited(response);
        if (!body) return true;
        const parsed = robotsParser(robotsUrl, body);
        return parsed.isAllowed(pageUrl, USER_AGENT) !== false;
    } catch {
        return true;
    } finally {
        clearTimeout(timer);
    }
}
