export function isPrivateHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
    if (host === '0.0.0.0' || host === '::1' || host === '::') return true;
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (ipv4) {
        const octets = ipv4.slice(1).map((part) => Number(part));
        if (octets.some((n) => n > 255)) return false;
        const [a, b] = octets as [number, number, number, number];
        if (a === 10 || a === 127 || a === 0) return true;
        if (a === 169 && b === 254) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        return false;
    }
    if (host.includes(':')) {
        const first = host.split(':')[0] ?? '';
        if (first === 'fc' || first === 'fd' || first.startsWith('fc') || first.startsWith('fd')) return true;
        if (first.startsWith('fe8') || first.startsWith('fe9') || first.startsWith('fea') || first.startsWith('feb')) return true;
    }
    return false;
}

export function toSiteRoot(input: string): string {
    const trimmed = input.trim();
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withScheme);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
        url.port = '';
    }
    return `${url.protocol}//${url.host}`;
}

export function normalizeUrl(input: string): string | null {
    try {
        const url = new URL(input);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        url.protocol = url.protocol.toLowerCase();
        url.hostname = url.hostname.toLowerCase();
        url.hash = '';
        if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
            url.port = '';
        }
        return url.href;
    } catch {
        return null;
    }
}
