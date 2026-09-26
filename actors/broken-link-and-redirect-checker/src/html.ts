import { Parser } from 'htmlparser2';

import { redactAnchorText } from '@apify-actors/common';

import type { ElementName } from './types.js';

export interface ExtractedLink {
    href: string;
    element: ElementName;
    anchorText: string | null;
}

export interface ExtractResult {
    links: ExtractedLink[];
    nofollow: boolean;
}

interface AnchorFrame {
    href?: string;
    text: string;
    hasImg: boolean;
}

function isStylesheet(rel: string | undefined): boolean {
    return (rel ?? '')
        .toLowerCase()
        .split(/\s+/)
        .includes('stylesheet');
}

export function extractLinks(html: string, checkAssetLinks: boolean): ExtractResult {
    const links: ExtractedLink[] = [];
    let nofollow = false;
    const stack: AnchorFrame[] = [];

    const pushAnchor = (frame: AnchorFrame | undefined): void => {
        if (!frame?.href) return;
        const collapsed = frame.text.replace(/\s+/g, ' ').trim();
        let anchorText: string | null = null;
        if (!collapsed && frame.hasImg) anchorText = '[image]';
        else if (collapsed) anchorText = redactAnchorText(frame.text);
        links.push({ href: frame.href, element: 'a', anchorText });
    };

    const parser = new Parser(
        {
            onopentag(name, attribs) {
                const tag = name.toLowerCase();
                if (tag === 'meta' && (attribs.name ?? attribs['http-equiv'] ?? '').toLowerCase() === 'robots') {
                    if ((attribs.content ?? '').toLowerCase().includes('nofollow')) nofollow = true;
                }
                if (tag === 'a' || tag === 'area') {
                    stack.push({ ...(attribs.href ? { href: attribs.href } : {}), text: '', hasImg: false });
                    return;
                }
                const top = stack[stack.length - 1];
                if (tag === 'img' && top) top.hasImg = true;
                if (!checkAssetLinks) return;
                if (tag === 'img' && attribs.src) links.push({ href: attribs.src, element: 'img', anchorText: null });
                if (tag === 'script' && attribs.src) links.push({ href: attribs.src, element: 'script', anchorText: null });
                if (tag === 'iframe' && attribs.src) links.push({ href: attribs.src, element: 'iframe', anchorText: null });
                if (tag === 'link' && attribs.href && isStylesheet(attribs.rel)) {
                    links.push({ href: attribs.href, element: 'link', anchorText: null });
                }
            },
            ontext(text) {
                const top = stack[stack.length - 1];
                if (top) top.text += text;
            },
            onclosetag(name) {
                const tag = name.toLowerCase();
                if (tag !== 'a' && tag !== 'area') return;
                pushAnchor(stack.pop());
            },
        },
        { decodeEntities: true },
    );
    parser.write(html);
    parser.end();
    while (stack.length > 0) pushAnchor(stack.pop());
    return { links, nofollow };
}

export type HrefKind =
    | { kind: 'fragment' }
    | { kind: 'scheme'; scheme: 'mailto' | 'tel' | 'javascript' | 'other' }
    | { kind: 'http'; url: URL }
    | { kind: 'invalid'; raw: string };

export function classifyHref(raw: string, base: string): HrefKind {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) return { kind: 'fragment' };
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('mailto:')) return { kind: 'scheme', scheme: 'mailto' };
    if (lower.startsWith('tel:')) return { kind: 'scheme', scheme: 'tel' };
    if (lower.startsWith('javascript:')) return { kind: 'scheme', scheme: 'javascript' };
    if (lower.startsWith('data:') || lower.startsWith('sms:') || lower.startsWith('ftp:') || lower.startsWith('blob:')) {
        return { kind: 'scheme', scheme: 'other' };
    }
    try {
        const url = new URL(trimmed, base);
        if (url.protocol === 'http:' || url.protocol === 'https:') return { kind: 'http', url };
        if (url.protocol === 'mailto:') return { kind: 'scheme', scheme: 'mailto' };
        if (url.protocol === 'tel:') return { kind: 'scheme', scheme: 'tel' };
        if (url.protocol === 'javascript:') return { kind: 'scheme', scheme: 'javascript' };
        return { kind: 'scheme', scheme: 'other' };
    } catch {
        return { kind: 'invalid', raw: trimmed };
    }
}
