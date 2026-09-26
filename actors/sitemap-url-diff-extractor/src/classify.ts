import { isPrivateHost, toSiteRoot } from '@apify-actors/common';

export type Classified =
    | { kind: 'invalid'; raw: string; site: string }
    | { kind: 'private'; raw: string; site: string }
    | { kind: 'homepage'; site: string; url: string }
    | { kind: 'robots'; site: string; url: string }
    | { kind: 'sitemap'; site: string; url: string }
    | { kind: 'llms'; site: string; url: string };

export function privateHostsAllowed(): boolean {
    return process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS === '1';
}

export function classifyStartUrl(raw: string): Classified {
    const trimmed = raw.trim();
    const siteFallback = trimmed.slice(0, 2048) || 'invalid';
    if (trimmed.length < 3) return { kind: 'invalid', raw, site: siteFallback };
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
        return { kind: 'invalid', raw, site: siteFallback };
    }
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let url: URL;
    try {
        url = new URL(withScheme);
    } catch {
        return { kind: 'invalid', raw, site: siteFallback };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { kind: 'invalid', raw, site: siteFallback };
    }
    let site: string;
    try {
        site = toSiteRoot(url.href);
    } catch {
        return { kind: 'invalid', raw, site: siteFallback };
    }
    if (isPrivateHost(url.hostname) && !privateHostsAllowed()) {
        return { kind: 'private', raw, site };
    }
    const path = url.pathname.toLowerCase();
    if (path.endsWith('/robots.txt')) return { kind: 'robots', site, url: url.href };
    if (path.endsWith('/llms.txt') || path.endsWith('/llms-full.txt')) return { kind: 'llms', site, url: url.href };
    if (path.endsWith('.xml') || path.endsWith('.xml.gz') || path.endsWith('.gz') || path.endsWith('.txt')) {
        return { kind: 'sitemap', site, url: url.href };
    }
    return { kind: 'homepage', site, url: url.href };
}
