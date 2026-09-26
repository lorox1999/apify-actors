import { errorMessage, isPrivateHost, normalizeUrl } from '@apify-actors/common';

import { FatalInputError } from './fatal.js';
import { CATEGORIES, type ActorInput, type Category, type Device, type Engine } from './types.js';

export interface ResolvedInput {
    rawUrls: string[];
    urlsDataset?: string;
    urlsDatasetField: string;
    maxUrls: number;
    strategy: 'mobile' | 'desktop' | 'both';
    devices: Device[];
    categories: Category[];
    maxOpportunities: number;
    engine: Engine;
    psiApiKey?: string;
    perUrlTimeoutSecs: number;
    retries: number;
    precheckReachability: boolean;
}

export interface UrlCheckOk {
    ok: true;
    url: string;
}

export interface UrlCheckBad {
    ok: false;
    url: string;
    message: string;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const number = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isInteger(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function safeDisplay(raw: string): string {
    try {
        const url = new URL(raw.trim());
        url.username = '';
        url.password = '';
        url.hash = '';
        return url.href.slice(0, 2048);
    } catch {
        return 'invalid-url';
    }
}

export function privateHostsAllowed(): boolean {
    return process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS === '1';
}

/** Reject credentials, non-http(s), and private hosts. The returned url never contains userinfo. */
export function checkUrl(raw: string): UrlCheckOk | UrlCheckBad {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 2048) {
        return { ok: false, url: safeDisplay(trimmed), message: 'Only http and https URLs can be audited.' };
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { ok: false, url: 'invalid-url', message: 'Only http and https URLs can be audited.' };
    }
    const display = safeDisplay(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, url: display, message: 'Only http and https URLs can be audited.' };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, url: display, message: 'URLs with a username or password are not allowed.' };
    }
    if (!privateHostsAllowed() && isPrivateHost(parsed.hostname)) {
        return { ok: false, url: display, message: 'Private or local network hosts are not allowed.' };
    }
    const normalized = normalizeUrl(parsed.href);
    if (!normalized) {
        return { ok: false, url: display, message: 'Only http and https URLs can be audited.' };
    }
    return { ok: true, url: normalized };
}

export function isLowMemoryForLighthouse(): boolean {
    const raw = process.env.ACTOR_MEMORY_MBYTES;
    if (raw === undefined || raw.trim() === '') return false;
    const mb = Number(raw);
    if (!Number.isFinite(mb)) return false;
    return mb < 4096;
}

export function resolveInput(raw: ActorInput | null | undefined): ResolvedInput {
    const urls = Array.isArray(raw?.urls) ? raw.urls.filter((url): url is string => typeof url === 'string') : [];
    const dataset = typeof raw?.urlsDataset === 'string' ? raw.urlsDataset.trim() : '';
    if (urls.every((url) => url.trim() === '') && !dataset) {
        throw new FatalInputError(errorMessage('NO_URLS'));
    }
    const engine: Engine = raw?.engine === 'psi' ? 'psi' : 'local';
    const psiApiKey = typeof raw?.psiApiKey === 'string' ? raw.psiApiKey.trim() : '';
    if (engine === 'psi' && !psiApiKey) {
        throw new FatalInputError(errorMessage('PSI_KEY_MISSING'));
    }
    const strategy = raw?.strategy === 'desktop' || raw?.strategy === 'both' ? raw.strategy : 'mobile';
    const devices: Device[] = strategy === 'both' ? ['mobile', 'desktop'] : [strategy];
    const requested = Array.isArray(raw?.categories) ? raw.categories : [];
    const categories = CATEGORIES.filter((category) => requested.includes(category));
    return {
        rawUrls: urls.map((url) => url.trim()).filter((url) => url.length > 0),
        ...(dataset ? { urlsDataset: dataset } : {}),
        urlsDatasetField: typeof raw?.urlsDatasetField === 'string' && raw.urlsDatasetField.trim() ? raw.urlsDatasetField.trim() : 'url',
        maxUrls: clampInt(raw?.maxUrls, 500, 1, 10_000),
        strategy,
        devices,
        categories: categories.length > 0 ? categories : [...CATEGORIES],
        maxOpportunities: clampInt(raw?.maxOpportunities, 5, 0, 20),
        engine,
        ...(psiApiKey ? { psiApiKey } : {}),
        perUrlTimeoutSecs: clampInt(raw?.perUrlTimeoutSecs, 90, 20, 180),
        retries: clampInt(raw?.retries, 1, 0, 2),
        precheckReachability: raw?.precheckReachability !== false,
    };
}
