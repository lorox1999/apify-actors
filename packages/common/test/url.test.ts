import { describe, expect, it } from 'vitest';

import { isPrivateHost, normalizeUrl, toSiteRoot } from '../src/url.js';

describe('url', () => {
    it('lowercases the host, drops the fragment and the default port, and keeps query order', () => {
        expect(normalizeUrl('HTTPS://Example.COM:443/a/B?b=1&a=2#frag')).toBe('https://example.com/a/B?b=1&a=2');
    });

    it('drops the default http port', () => {
        expect(normalizeUrl('http://Example.com:80/x')).toBe('http://example.com/x');
    });

    it('keeps a non-default port', () => {
        expect(normalizeUrl('http://example.com:8080/x')).toBe('http://example.com:8080/x');
    });

    it('returns null for a non-http URL', () => {
        expect(normalizeUrl('ftp://example.com/a')).toBeNull();
        expect(normalizeUrl('not a url')).toBeNull();
    });

    it('builds a site root from a domain or a URL', () => {
        expect(toSiteRoot('Example.com/path')).toBe('https://example.com');
        expect(toSiteRoot('http://Docs.Apify.com:80/platform')).toBe('http://docs.apify.com');
    });

    it('detects localhost, private IPv4, link-local and .local names', () => {
        expect(isPrivateHost('localhost')).toBe(true);
        expect(isPrivateHost('foo.local')).toBe(true);
        expect(isPrivateHost('127.0.0.1')).toBe(true);
        expect(isPrivateHost('10.1.2.3')).toBe(true);
        expect(isPrivateHost('192.168.0.5')).toBe(true);
        expect(isPrivateHost('172.16.0.1')).toBe(true);
        expect(isPrivateHost('172.15.0.1')).toBe(false);
        expect(isPrivateHost('169.254.1.1')).toBe(true);
        expect(isPrivateHost('8.8.8.8')).toBe(false);
        expect(isPrivateHost('::1')).toBe(true);
        expect(isPrivateHost('[::1]')).toBe(true);
        expect(isPrivateHost('fc00::1')).toBe(true);
        expect(isPrivateHost('fe80::1')).toBe(true);
        expect(isPrivateHost('2001:4860:4860::8888')).toBe(false);
        expect(isPrivateHost('999.1.1.1')).toBe(false);
        expect(isPrivateHost('1.2.3.4')).toBe(false);
    });

    it('strips a default port from a site root', () => {
        expect(toSiteRoot('https://example.com:443/docs')).toBe('https://example.com');
    });
});
