const secrets = new Set<string>();

const HEADER_RE = /((?:authorization|cookie|set-cookie)\s*[:=]\s*)([^\r\n]+)/gi;
const QUERY_RE = /([?&](?:key|token|access_token)=)[^&#\s]+/gi;
const GITHUB_RE = /\b(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]+/g;
const GITHUB_PAT_RE = /\bgithub_pat_[A-Za-z0-9_]+/g;
const GOOGLE_KEY_RE = /\bAIza[0-9A-Za-z_-]{35}\b/g;

export function registerSecret(value: string | undefined | null): void {
    if (value && value.length > 0) secrets.add(value);
}

export function clearSecrets(): void {
    secrets.clear();
}

export function redact(text: string): string {
    let out = text;
    out = out.replace(HEADER_RE, '$1[removed]');
    out = out.replace(QUERY_RE, '$1[removed]');
    out = out.replace(GITHUB_RE, '[removed]');
    out = out.replace(GITHUB_PAT_RE, '[removed]');
    out = out.replace(GOOGLE_KEY_RE, '[removed]');
    for (const secret of secrets) {
        if (secret.length < 4) continue;
        out = out.split(secret).join('[removed]');
    }
    return out;
}

export interface LogFn {
    (message: string, ...args: unknown[]): void;
}

export interface SafeLogger {
    debug: LogFn;
    info: LogFn;
    warning: LogFn;
    error: LogFn;
}

export interface BaseLogger {
    debug?: LogFn;
    info?: LogFn;
    warning?: LogFn;
    error?: LogFn;
    warn?: LogFn;
}

function stringify(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function createSafeLogger(base?: BaseLogger): SafeLogger {
    const sink: Required<Pick<BaseLogger, 'debug' | 'info' | 'warning' | 'error'>> = {
        debug: base?.debug ?? ((message) => console.debug(message)),
        info: base?.info ?? ((message) => console.info(message)),
        warning: base?.warning ?? base?.warn ?? ((message) => console.warn(message)),
        error: base?.error ?? ((message) => console.error(message)),
    };
    const wrap = (fn: LogFn): LogFn => (message, ...args) => {
        const parts = [message, ...args].map((part) => redact(stringify(part)));
        fn(parts.join(' '));
    };
    return {
        debug: wrap(sink.debug),
        info: wrap(sink.info),
        warning: wrap(sink.warning),
        error: wrap(sink.error),
    };
}
