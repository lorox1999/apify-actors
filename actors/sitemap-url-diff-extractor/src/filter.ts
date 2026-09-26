import { normalizeUrl } from '@apify-actors/common';

import { FatalInputError } from './fatal.js';
import type { ResolvedInput } from './types.js';

export interface CompiledFilters {
    include?: RegExp;
    exclude?: RegExp;
    lastmodFromMs: number | null;
    lastmodToMs: number | null;
    dropUrlsWithoutLastmod: boolean;
    sameHostOnly: boolean;
    siteHost: string;
}

export function filterParams(input: ResolvedInput): Record<string, unknown> {
    return {
        includeUrlRegex: input.includeUrlRegex ?? null,
        excludeUrlRegex: input.excludeUrlRegex ?? null,
        lastmodFrom: input.lastmodFrom ?? null,
        lastmodTo: input.lastmodTo ?? null,
        dropUrlsWithoutLastmod: input.dropUrlsWithoutLastmod,
        sameHostOnly: input.sameHostOnly,
        includeLlmsTxtUrls: input.includeLlmsTxtUrls,
    };
}

function compile(pattern: string | undefined): RegExp | undefined {
    if (!pattern) return undefined;
    try {
        return new RegExp(pattern);
    } catch {
        throw new FatalInputError('Invalid regular expression. Check includeUrlRegex and excludeUrlRegex.');
    }
}

export function parseDateBoundary(value: string | undefined, end: boolean): number | null {
    if (!value) return null;
    const relative = /^(\d+)\s*(day|days|week|weeks|month|months|year|years)(?:\s+ago)?$/i.exec(value.trim());
    if (relative) {
        const n = Number(relative[1]);
        const unit = (relative[2] ?? 'days').toLowerCase();
        const day = 86_400_000;
        const span = unit.startsWith('day') ? day : unit.startsWith('week') ? 7 * day : unit.startsWith('month') ? 30 * day : 365 * day;
        return Date.now() - n * span;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
        const [year, month, day] = value.trim().split('-').map((part) => Number(part)) as [number, number, number];
        if (end) return Date.UTC(year, month - 1, day, 23, 59, 59, 999);
        return Date.UTC(year, month - 1, day, 0, 0, 0, 0);
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) throw new FatalInputError('Invalid lastmod filter date. Use YYYY-MM-DD or a relative value such as 7 days.');
    return parsed;
}

export function compileFilters(input: ResolvedInput, site: string): CompiledFilters {
    const siteHost = new URL(site).hostname;
    return {
        include: compile(input.includeUrlRegex),
        exclude: compile(input.excludeUrlRegex),
        lastmodFromMs: parseDateBoundary(input.lastmodFrom, false),
        lastmodToMs: parseDateBoundary(input.lastmodTo, true),
        dropUrlsWithoutLastmod: input.dropUrlsWithoutLastmod,
        sameHostOnly: input.sameHostOnly,
        siteHost,
    };
}

export function lastmodToMs(value: string | null): number | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

export function keepUrl(rawUrl: string, lastmod: string | null, filters: CompiledFilters): string | null {
    const norm = normalizeUrl(rawUrl);
    if (!norm) return null;
    if (filters.sameHostOnly) {
        try {
            if (new URL(norm).hostname !== filters.siteHost) return null;
        } catch {
            return null;
        }
    }
    if (filters.include && !filters.include.test(norm) && !filters.include.test(rawUrl)) return null;
    if (filters.exclude && (filters.exclude.test(norm) || filters.exclude.test(rawUrl))) return null;
    const dateFilter = filters.lastmodFromMs != null || filters.lastmodToMs != null;
    const ms = lastmodToMs(lastmod);
    if (dateFilter && ms == null) {
        return filters.dropUrlsWithoutLastmod ? null : norm;
    }
    if (ms != null && filters.lastmodFromMs != null && ms < filters.lastmodFromMs) return null;
    if (ms != null && filters.lastmodToMs != null && ms > filters.lastmodToMs) return null;
    return norm;
}
