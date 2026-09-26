/**
 * Maps a link-check outcome to checkStatus / errorCode.
 * Covers the broken-link Actor failure table: HTTP statuses, network errors,
 * redirect failures, and skips. Billing follows the status, not the row filter.
 */

export type CheckStatus = 'ok' | 'redirect' | 'broken' | 'restricted' | 'unverified' | 'skipped';

export interface LinkClassification {
    checkStatus: CheckStatus;
    errorCode: string | null;
    /** True for ok / redirect / broken / restricted. */
    billable: boolean;
}

function result(checkStatus: CheckStatus, errorCode: string | null, billable: boolean): LinkClassification {
    return { checkStatus, errorCode, billable };
}

const RESTRICTED: Record<number, string> = {
    401: 'HTTP_401_UNAUTHORIZED',
    403: 'HTTP_403_FORBIDDEN',
    407: 'HTTP_407_PROXY_AUTH',
    451: 'HTTP_451_LEGAL',
};

export function headerLooksLikeBotChallenge(headers: Record<string, string | undefined>): boolean {
    const value = headers['cf-mitigated'] ?? headers['CF-Mitigated'] ?? '';
    return value.toLowerCase().includes('challenge');
}

/** Final HTTP status after retries and HEAD→GET fallback. `redirectCount` is the number of 3xx hops followed. */
export function classifyHttpStatus(
    status: number,
    headers: Record<string, string | undefined>,
    redirectCount: number,
): LinkClassification {
    if (status === 999 || (headerLooksLikeBotChallenge(headers) && (status === 403 || status === 503))) {
        return result('unverified', 'BOT_PROTECTION', false);
    }
    if (status === 429) return result('unverified', 'RATE_LIMITED', false);
    const restricted = RESTRICTED[status];
    if (restricted) return result('restricted', restricted, true);
    if (status === 404) return result('broken', 'HTTP_404_NOT_FOUND', true);
    if (status === 410) return result('broken', 'HTTP_410_GONE', true);
    if (status >= 500 && status <= 599) return result('broken', 'HTTP_5XX', true);
    if (status >= 400 && status <= 499) return result('broken', 'HTTP_4XX', true);
    if (status >= 200 && status <= 299) {
        if (redirectCount > 0) return result('redirect', null, true);
        return result('ok', null, true);
    }
    if (status >= 300 && status <= 399) return result('broken', 'INVALID_REDIRECT', true);
    return result('unverified', 'UNEXPECTED_STATUS', false);
}

export type NetworkFailureCode =
    | 'DNS_NOT_FOUND'
    | 'DNS_TEMPORARY_FAILURE'
    | 'CONNECTION_REFUSED'
    | 'CONNECTION_RESET'
    | 'TIMEOUT'
    | 'TLS_ERROR'
    | 'CONNECTION_ERROR';

export interface NetworkFailure {
    code: NetworkFailureCode;
    detail: string | null;
    /** Timeout, connection reset, and temporary DNS get one retry. */
    retryable: boolean;
    /** DNS-not-found and connection-refused do not fall back from HEAD to GET. */
    headFallback: boolean;
}

const TLS_CODES = new Set([
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'CERT_UNTRUSTED',
    'ERR_SSL_WRONG_VERSION_NUMBER',
    'EPROTO',
]);

function readCause(error: unknown): { code: string; message: string } {
    const seen = new Set<unknown>();
    let current: unknown = error;
    let code = '';
    const messages: string[] = [];
    while (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current);
        const record = current as { code?: string; message?: string; cause?: unknown; name?: string };
        if (!code && typeof record.code === 'string') code = record.code;
        if (typeof record.message === 'string' && record.message) messages.push(record.message);
        if (record.name === 'AbortError' && !code) code = 'ABORT_ERR';
        current = record.cause;
    }
    return { code, message: messages.join(' ') };
}

export function classifyThrown(error: unknown): NetworkFailure {
    const { code, message } = readCause(error);
    const upper = code.toUpperCase();
    const lowerMessage = message.toLowerCase();
    if (
        TLS_CODES.has(code) ||
        TLS_CODES.has(upper) ||
        upper.includes('CERT') ||
        upper.includes('TLS') ||
        lowerMessage.includes('self-signed') ||
        lowerMessage.includes('certificate') ||
        lowerMessage.includes('ssl') ||
        lowerMessage.includes('tls')
    ) {
        const detail = code || (lowerMessage.includes('self-signed') ? 'DEPTH_ZERO_SELF_SIGNED_CERT' : 'TLS_ERROR');
        return { code: 'TLS_ERROR', detail, retryable: false, headFallback: true };
    }
    if (code === 'ENOTFOUND' || code === 'ENODATA' || lowerMessage.includes('getaddrinfo enotfound')) {
        return { code: 'DNS_NOT_FOUND', detail: code || 'ENOTFOUND', retryable: false, headFallback: false };
    }
    if (code === 'EAI_AGAIN' || lowerMessage.includes('eai_again') || lowerMessage.includes('servfail')) {
        return { code: 'DNS_TEMPORARY_FAILURE', detail: code || 'EAI_AGAIN', retryable: true, headFallback: true };
    }
    if (code === 'ECONNREFUSED' || lowerMessage.includes('econnrefused') || lowerMessage.includes('bad port')) {
        return { code: 'CONNECTION_REFUSED', detail: code || 'ECONNREFUSED', retryable: false, headFallback: false };
    }
    if (code === 'ECONNRESET' || code === 'EPIPE' || lowerMessage.includes('socket hang up') || lowerMessage.includes('econnreset')) {
        return { code: 'CONNECTION_RESET', detail: code || 'ECONNRESET', retryable: true, headFallback: true };
    }
    if (
        code === 'UND_ERR_CONNECT_TIMEOUT' ||
        code === 'UND_ERR_HEADERS_TIMEOUT' ||
        code === 'UND_ERR_BODY_TIMEOUT' ||
        code === 'ABORT_ERR' ||
        code === 'ETIMEDOUT' ||
        lowerMessage.includes('timeout') ||
        lowerMessage.includes('aborted')
    ) {
        const detail = code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT' ? 'connect' : 'headers';
        return { code: 'TIMEOUT', detail, retryable: true, headFallback: true };
    }
    return { code: 'CONNECTION_ERROR', detail: code || null, retryable: true, headFallback: true };
}

export function classifyNetworkFailure(failure: NetworkFailure): LinkClassification {
    if (failure.code === 'DNS_NOT_FOUND') return result('broken', 'DNS_NOT_FOUND', true);
    if (failure.code === 'CONNECTION_REFUSED') return result('broken', 'CONNECTION_REFUSED', true);
    if (failure.code === 'TIMEOUT') return result('broken', 'TIMEOUT', true);
    if (failure.code === 'TLS_ERROR') return result('broken', 'TLS_ERROR', true);
    if (failure.code === 'DNS_TEMPORARY_FAILURE') return result('unverified', 'DNS_TEMPORARY_FAILURE', false);
    if (failure.code === 'CONNECTION_RESET') return result('unverified', 'CONNECTION_RESET', false);
    return result('unverified', 'CONNECTION_RESET', false);
}

export function classifyRedirectProblem(
    code: 'REDIRECT_LOOP' | 'TOO_MANY_REDIRECTS' | 'INVALID_REDIRECT' | 'UNSUPPORTED_REDIRECT_SCHEME',
): LinkClassification {
    if (code === 'UNSUPPORTED_REDIRECT_SCHEME') return result('unverified', code, false);
    return result('broken', code, true);
}

export function classifySkip(code: 'BLOCKED_BY_ROBOTS' | 'PRIVATE_HOST' | 'INVALID_URL' | 'ROBOTS_UNREACHABLE'): LinkClassification {
    if (code === 'ROBOTS_UNREACHABLE') return result('unverified', code, false);
    return result('skipped', code, false);
}
