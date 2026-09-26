import { lookup } from 'node:dns/promises';

import { isPrivateHost } from '@apify-actors/common';

export function platformHome(): boolean {
    return process.env.APIFY_IS_AT_HOME === '1';
}

export function allowPrivateHosts(): boolean {
    if (platformHome()) return false;
    return process.env.A3B_TEST_ALLOW_PRIVATE_HOSTS === '1';
}

/** host=ip pairs. Ignored on the Apify platform. */
export function testHostMap(): Map<string, string> {
    const map = new Map<string, string>();
    if (platformHome()) return map;
    const raw = process.env.A3B_TEST_HOST_MAP;
    if (!raw) return map;
    for (const part of raw.split(',')) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const host = part.slice(0, eq).trim().toLowerCase();
        const ip = part.slice(eq + 1).trim();
        if (host && ip) map.set(host, ip);
    }
    return map;
}

export function retryDelayMs(): number {
    const override = process.env.A3B_TEST_RETRY_DELAY_MS;
    if (override !== undefined && override !== '') {
        const n = Number(override);
        if (Number.isFinite(n) && n >= 0) return n;
    }
    return 1000 + Math.floor(Math.random() * 2001);
}

export async function hostIsPrivate(hostname: string): Promise<boolean> {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (allowPrivateHosts()) return false;
    if (isPrivateHost(host)) return true;
    if (testHostMap().has(host)) return false;
    try {
        const records = await lookup(host, { all: true, verbatim: true });
        return records.some((record) => isPrivateHost(record.address));
    } catch {
        return false;
    }
}
