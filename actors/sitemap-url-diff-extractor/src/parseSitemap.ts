import { createGunzip } from 'node:zlib';

import sax from 'sax';

import { MAX_UNCOMPRESSED_BYTES, type SitemapKind } from './types.js';

export interface ParsedUrl {
    loc: string;
    lastmod: string | null;
    changefreq: string | null;
    priority: number | null;
    imageCount: number;
    videoCount: number;
    hreflangCount: number;
    sitemapKind: SitemapKind;
}

export interface SitemapParseResult {
    urls: ParsedUrl[];
    children: string[];
    parseError: boolean;
    format: 'xml' | 'text';
}

export class SitemapBodyError extends Error {
    readonly code: 'SITEMAP_TOO_LARGE' | 'GZIP_ERROR';

    constructor(code: 'SITEMAP_TOO_LARGE' | 'GZIP_ERROR') {
        super(code);
        this.name = 'SitemapBodyError';
        this.code = code;
    }
}

export async function inflateIfNeeded(buf: Buffer): Promise<Buffer> {
    if (buf.length < 2 || buf[0] !== 0x1f || buf[1] !== 0x8b) return buf;
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];
    let uncompressed = 0;
    const compressed = buf.length;
    let failed = false;
    await new Promise<void>((resolve, reject) => {
        const fail = (error: Error) => {
            if (failed) return;
            failed = true;
            gunzip.destroy();
            reject(error);
        };
        gunzip.on('data', (chunk: Buffer) => {
            if (failed) return;
            uncompressed += chunk.length;
            if (uncompressed > MAX_UNCOMPRESSED_BYTES || (compressed >= 32 && uncompressed / compressed > 100)) {
                fail(new SitemapBodyError('SITEMAP_TOO_LARGE'));
                return;
            }
            chunks.push(chunk);
        });
        gunzip.on('error', () => fail(new SitemapBodyError('GZIP_ERROR')));
        gunzip.on('end', () => {
            if (!failed) resolve();
        });
        gunzip.end(buf);
    });
    return Buffer.concat(chunks);
}

function localName(name: string): string {
    const idx = name.lastIndexOf(':');
    return (idx >= 0 ? name.slice(idx + 1) : name).toLowerCase();
}

function kindFor(url: { imageCount: number; videoCount: number; hasNews: boolean }): SitemapKind {
    if (url.hasNews) return 'news';
    if (url.videoCount > 0) return 'video';
    if (url.imageCount > 0) return 'image';
    return 'standard';
}

export function parseXmlSitemap(xml: string): SitemapParseResult {
    const parser = sax.parser(true, { trim: true, lowercase: false });
    const urls: ParsedUrl[] = [];
    const children: string[] = [];
    let parseError = false;
    let inUrl = false;
    let inSitemap = false;
    let inImage = false;
    let inVideo = false;
    let capture: 'loc' | 'lastmod' | 'changefreq' | 'priority' | 'child' | null = null;
    let text = '';
    let current: {
        loc: string | null;
        lastmod: string | null;
        changefreq: string | null;
        priority: number | null;
        imageCount: number;
        videoCount: number;
        hreflangCount: number;
        hasNews: boolean;
    } | null = null;

    parser.onopentag = (tag) => {
        const name = localName(tag.name);
        if (name === 'url' && !inImage && !inVideo) {
            inUrl = true;
            current = {
                loc: null,
                lastmod: null,
                changefreq: null,
                priority: null,
                imageCount: 0,
                videoCount: 0,
                hreflangCount: 0,
                hasNews: false,
            };
        } else if (name === 'sitemap' && !inUrl) {
            inSitemap = true;
        } else if (name === 'image' && inUrl && current) {
            inImage = true;
            current.imageCount += 1;
        } else if (name === 'video' && inUrl && current) {
            inVideo = true;
            current.videoCount += 1;
        } else if (name === 'news' && inUrl && current) {
            current.hasNews = true;
        } else if (name === 'link' && inUrl && current) {
            const rel = String(tag.attributes.rel ?? tag.attributes.REL ?? '').toLowerCase();
            const hreflang = tag.attributes.hreflang ?? tag.attributes.HREFLANG;
            if (rel === 'alternate' && hreflang) current.hreflangCount += 1;
        } else if (name === 'loc' && inUrl && current && !inImage && !inVideo) {
            capture = 'loc';
            text = '';
        } else if (name === 'loc' && inSitemap && !inUrl) {
            capture = 'child';
            text = '';
        } else if (name === 'lastmod' && inUrl && current && !inImage && !inVideo && !inSitemap) {
            capture = 'lastmod';
            text = '';
        } else if (name === 'changefreq' && inUrl && current && !inImage && !inVideo) {
            capture = 'changefreq';
            text = '';
        } else if (name === 'priority' && inUrl && current && !inImage && !inVideo) {
            capture = 'priority';
            text = '';
        }
    };

    parser.ontext = (value) => {
        if (capture) text += value;
    };
    parser.oncdata = (value) => {
        if (capture) text += value;
    };

    parser.onclosetag = (rawName) => {
        const name = localName(rawName);
        if (capture && current && (name === 'loc' || name === 'lastmod' || name === 'changefreq' || name === 'priority')) {
            const value = text.trim();
            if (capture === 'loc') current.loc = value;
            else if (capture === 'lastmod') current.lastmod = value || null;
            else if (capture === 'changefreq') current.changefreq = value || null;
            else if (capture === 'priority') {
                const n = Number(value);
                current.priority = Number.isFinite(n) ? n : null;
            }
            capture = null;
            text = '';
        } else if (capture === 'child' && name === 'loc') {
            const value = text.trim();
            if (value) children.push(value);
            capture = null;
            text = '';
        }
        if (name === 'image') inImage = false;
        if (name === 'video') inVideo = false;
        if (name === 'url' && current) {
            if (current.loc) {
                urls.push({
                    loc: current.loc,
                    lastmod: current.lastmod,
                    changefreq: current.changefreq,
                    priority: current.priority,
                    imageCount: current.imageCount,
                    videoCount: current.videoCount,
                    hreflangCount: current.hreflangCount,
                    sitemapKind: kindFor(current),
                });
            }
            current = null;
            inUrl = false;
        }
        if (name === 'sitemap') inSitemap = false;
    };

    parser.onerror = () => {
        parseError = true;
        parser.resume();
    };

    try {
        parser.write(xml);
        parser.close();
    } catch {
        parseError = true;
    }
    return { urls, children, parseError, format: 'xml' };
}

export function parseTextSitemap(text: string): SitemapParseResult {
    const urls: ParsedUrl[] = [];
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        if (!/^https?:\/\//i.test(trimmed)) continue;
        urls.push({
            loc: trimmed,
            lastmod: null,
            changefreq: null,
            priority: null,
            imageCount: 0,
            videoCount: 0,
            hreflangCount: 0,
            sitemapKind: 'text',
        });
    }
    return { urls, children: [], parseError: false, format: 'text' };
}

export async function parseSitemapBuffer(buf: Buffer): Promise<SitemapParseResult> {
    const inflated = await inflateIfNeeded(buf);
    const text = inflated.toString('utf8').replace(/^\uFEFF/, '');
    if (text.trimStart().startsWith('<')) return parseXmlSitemap(text);
    return parseTextSitemap(text);
}
