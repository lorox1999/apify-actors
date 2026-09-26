import type { ErrorRow } from '@apify-actors/common';

import { DATASET_FIELDS, type PageRecord } from './types.js';

export function pageToRow(site: string, page: PageRecord, extractedAt: string): Record<string, unknown> {
    const row: Record<string, unknown> = {
        recordType: 'url',
        site,
        url: page.url,
        source: page.source,
        sourceSitemap: page.sourceSitemap,
        lastmod: page.lastmod,
        changefreq: page.changefreq,
        priority: page.priority,
        sitemapKind: page.sitemapKind,
        imageCount: page.imageCount,
        videoCount: page.videoCount,
        hreflangCount: page.hreflangCount,
        changeType: page.changeType,
        firstSeenAt: page.firstSeenAt,
        httpStatus: page.httpStatus,
        finalUrl: page.finalUrl,
        errorCode: null,
        errorMessage: null,
        extractedAt,
    };
    for (const field of DATASET_FIELDS) {
        if (!(field in row)) row[field] = null;
    }
    return row;
}

export function errorToRow(row: ErrorRow): Record<string, unknown> {
    return { ...row };
}
