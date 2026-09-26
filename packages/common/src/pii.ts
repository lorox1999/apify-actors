const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const E164_RE = /\+\d{1,3}(?:[\s.-]?\d){7,14}\b/g;
const NANP_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const HANDLE_RE = /(^|[\s(])@([A-Za-z0-9-]{1,39})\b/g;

export function scrubText(text: string, maxLen: number): string {
    let out = text.replace(EMAIL_RE, '[removed]');
    out = out.replace(E164_RE, '[removed]');
    out = out.replace(NANP_RE, '[removed]');
    out = out.replace(HANDLE_RE, '$1[removed]');
    if (out.length > maxLen) out = out.slice(0, maxLen);
    return out;
}
