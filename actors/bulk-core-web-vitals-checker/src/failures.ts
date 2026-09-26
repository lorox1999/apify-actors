import { errorMessage, type ErrorCode } from '@apify-actors/common';

export class AuditFailed extends Error {
    readonly errorCode: ErrorCode;
    readonly httpStatus?: number;
    readonly timeoutSecs?: number;
    readonly lighthouseCode?: string;
    readonly messageOverride?: string;

    constructor(
        errorCode: ErrorCode,
        extra?: { httpStatus?: number; timeoutSecs?: number; lighthouseCode?: string; messageOverride?: string },
    ) {
        super(extra?.messageOverride ?? errorCode);
        this.name = 'AuditFailed';
        this.errorCode = errorCode;
        if (extra?.httpStatus !== undefined) this.httpStatus = extra.httpStatus;
        if (extra?.timeoutSecs !== undefined) this.timeoutSecs = extra.timeoutSecs;
        if (extra?.lighthouseCode !== undefined) this.lighthouseCode = extra.lighthouseCode;
        if (extra?.messageOverride !== undefined) this.messageOverride = extra.messageOverride;
    }
}

export function describeFailure(error: AuditFailed): string {
    if (error.messageOverride) return error.messageOverride;
    if (error.errorCode === 'HTTP_4XX_PRECHECK' && error.httpStatus) {
        const bypass = error.httpStatus === 403 ? ' Access controls are not bypassed.' : '';
        return `The URL returned HTTP ${error.httpStatus} during the reachability check.${bypass}`;
    }
    if (error.errorCode === 'HTTP_5XX_PRECHECK' && error.httpStatus) {
        return `The URL returned HTTP ${error.httpStatus} during the reachability check.`;
    }
    if (error.errorCode === 'TIMEOUT' && error.timeoutSecs) {
        return `Audit exceeded ${error.timeoutSecs} s.`;
    }
    if (error.errorCode === 'LIGHTHOUSE_ERROR' && error.lighthouseCode) {
        return `Lighthouse reported runtime error ${error.lighthouseCode}.`;
    }
    if (error.errorCode === 'PSI_ERROR' && error.lighthouseCode) {
        return `PageSpeed Insights reported runtime error ${error.lighthouseCode}.`;
    }
    return errorMessage(error.errorCode);
}
