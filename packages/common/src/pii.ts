const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const E164_RE = /\+\d{1,3}(?:[\s.-]?\d){7,14}\b/g;
const NANP_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const HANDLE_RE = /(^|[\s(])@([A-Za-z0-9-]{1,39})\b/g;
const ANCHOR_PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]*)?\d(?:[\s.-]?\d){6,}/g;

function replaceGlobal(text: string, pattern: RegExp, replacement: string): string {
    pattern.lastIndex = 0;
    return text.replace(pattern, replacement);
}

export function scrubText(text: string, maxLen: number): string {
    let out = replaceGlobal(text, EMAIL_RE, '[removed]');
    out = replaceGlobal(out, E164_RE, '[removed]');
    out = replaceGlobal(out, NANP_RE, '[removed]');
    out = replaceGlobal(out, HANDLE_RE, '$1[removed]');
    if (out.length > maxLen) out = out.slice(0, maxLen);
    return out;
}

/** Collapse whitespace, replace email/phone-shaped text, then cap at 100 characters plus an ellipsis. */
export function redactAnchorText(text: string): string {
    let out = text.replace(/\s+/g, ' ').trim();
    out = replaceGlobal(out, EMAIL_RE, '[redacted]');
    out = replaceGlobal(out, ANCHOR_PHONE_RE, '[redacted]');
    if (out.length > 100) out = `${out.slice(0, 100)}…`;
    return out;
}

export function redactQueryValue(value: string): string {
    EMAIL_RE.lastIndex = 0;
    if (EMAIL_RE.test(value)) return '[redacted-email]';
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 9) return '[redacted-phone]';
    return value;
}

function stripUserInfo(url: URL): void {
    url.username = '';
    url.password = '';
}

function redactRawQuery(search: string): string {
    if (!search) return '';
    const body = search.startsWith('?') ? search.slice(1) : search;
    const parts = body.split('&').map((part) => {
        if (!part) return part;
        const eq = part.indexOf('=');
        if (eq === -1) return part;
        const key = part.slice(0, eq);
        const rawValue = part.slice(eq + 1);
        let decoded = rawValue;
        try {
            decoded = decodeURIComponent(rawValue.replace(/\+/g, ' '));
        } catch {
            decoded = rawValue;
        }
        const redacted = redactQueryValue(decoded);
        if (redacted === decoded) return part;
        return `${key}=${redacted}`;
    });
    return `?${parts.join('&')}`;
}

/**
 * Public link URL for dataset, CSV, state and logs.
 * Drops user:pass@, replaces email-like and long phone-like query values, and drops the fragment.
 */
export function redactHttpUrl(input: string): string | null {
    try {
        const url = new URL(input);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        url.protocol = url.protocol.toLowerCase();
        url.hostname = url.hostname.toLowerCase();
        url.hash = '';
        stripUserInfo(url);
        if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
            url.port = '';
        }
        const search = redactRawQuery(url.search);
        return `${url.origin}${url.pathname}${search}`;
    } catch {
        return null;
    }
}

/** Last-resort text for a href that cannot be parsed. Never keeps an email, a phone, or user:pass@. */
export function redactLooseText(raw: string, maxLen = 300): string {
    let out = raw.replace(/^(https?:\/\/)[^/\s@:]+:[^/\s@]+@/i, '$1');
    out = replaceGlobal(out, EMAIL_RE, '[redacted-email]');
    out = replaceGlobal(out, ANCHOR_PHONE_RE, '[redacted-phone]');
    if (out.length > maxLen) out = out.slice(0, maxLen);
    return out;
}
