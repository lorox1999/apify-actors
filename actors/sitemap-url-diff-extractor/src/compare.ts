import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { Actor } from 'apify';
import { toSiteRoot } from '@apify-actors/common';

import { DIFF_MAX_URLS } from './types.js';
import type { ChangeType, PageRecord } from './types.js';

export interface SnapshotPayload {
    site: string;
    createdAt: string;
    urls: [string, string][];
}

export function snapshotKey(site: string, filterParams: Record<string, unknown>): string {
    const canonical = `${toSiteRoot(site)}\n${JSON.stringify(filterParams)}`;
    return `snap-${createHash('sha1').update(canonical).digest('hex')}`;
}

export type SnapshotRead =
    | { ok: true; urls: Map<string, string> }
    | { ok: false; code: 'STATE_STORE_ERROR' | 'STATE_TOO_LARGE' };

function decode(value: unknown): SnapshotPayload {
    if (value && typeof value === 'object' && !Buffer.isBuffer(value) && 'urls' in value) {
        return value as SnapshotPayload;
    }
    let buf: Buffer;
    if (Buffer.isBuffer(value)) buf = value;
    else if (value instanceof Uint8Array) buf = Buffer.from(value);
    else if (typeof value === 'string') buf = Buffer.from(value, 'base64');
    else throw new Error('unreadable snapshot');
    return JSON.parse(gunzipSync(buf).toString('utf8')) as SnapshotPayload;
}

export async function readSnapshot(storeName: string, key: string): Promise<SnapshotRead | null> {
    try {
        const store = await Actor.openKeyValueStore(storeName);
        const value = await store.getValue(key);
        if (value == null) return null;
        const payload = decode(value);
        if (!Array.isArray(payload.urls)) return { ok: false, code: 'STATE_STORE_ERROR' };
        if (payload.urls.length > DIFF_MAX_URLS) return { ok: false, code: 'STATE_TOO_LARGE' };
        return { ok: true, urls: new Map(payload.urls) };
    } catch {
        return { ok: false, code: 'STATE_STORE_ERROR' };
    }
}

export async function writeSnapshot(storeName: string, key: string, payload: SnapshotPayload): Promise<'ok' | 'STATE_STORE_ERROR' | 'STATE_TOO_LARGE'> {
    if (payload.urls.length > DIFF_MAX_URLS) return 'STATE_TOO_LARGE';
    try {
        const store = await Actor.openKeyValueStore(storeName);
        const body = gzipSync(Buffer.from(JSON.stringify(payload)));
        await store.setValue(key, body, { contentType: 'application/gzip' });
        return 'ok';
    } catch {
        return 'STATE_STORE_ERROR';
    }
}

export function applyDiff(pages: PageRecord[], previous: Map<string, string> | null, now: string): { added: number; removed: PageRecord[] } {
    const prev = previous ?? new Map<string, string>();
    const current = new Set(pages.map((page) => page.norm));
    let added = 0;
    for (const page of pages) {
        const seen = prev.get(page.norm);
        if (seen) {
            page.changeType = 'unchanged';
            page.firstSeenAt = seen;
        } else {
            page.changeType = 'added';
            page.firstSeenAt = now;
            added += 1;
        }
    }
    const removed: PageRecord[] = [];
    for (const [url, firstSeenAt] of prev) {
        if (current.has(url)) continue;
        removed.push({
            url,
            norm: url,
            source: 'sitemap',
            sourceSitemap: null,
            lastmod: null,
            changefreq: null,
            priority: null,
            sitemapKind: null,
            imageCount: null,
            videoCount: null,
            hreflangCount: null,
            changeType: 'removed' satisfies ChangeType,
            firstSeenAt,
            httpStatus: null,
            finalUrl: null,
        });
    }
    return { added, removed };
}
