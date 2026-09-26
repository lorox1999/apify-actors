import { createRequire } from 'node:module';

import { AuditFailed } from './failures.js';
import type { Category, Device, LhrLike } from './types.js';

const require = createRequire(import.meta.url);

export interface LocalAuditRequest {
    url: string;
    strategy: Device;
    categories: Category[];
    timeoutMs: number;
}

export interface LocalAuditor {
    audit(request: LocalAuditRequest): Promise<LhrLike>;
    restart(): Promise<void>;
}

interface LaunchedChrome {
    port: number;
    kill: () => void | Promise<void>;
}

const CHROME_FLAGS = ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server'];

function chromePath(): string | undefined {
    return process.env.CHROME_PATH || process.env.APIFY_CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
}

function isCrash(error: unknown): boolean {
    const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
    return /Protocol error|Target closed|ECONNRESET|browser disconnected|Chrome failed|socket hang up|Session closed|page is closed|Navigation failed/i.test(message);
}

function nodeSupportsLighthouse(): boolean {
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    return major > 22 || (major === 22 && minor >= 19);
}

/**
 * One Chrome process for the whole run. Restarts every 50 audits and after a crash or timeout.
 * CWV_CRASH_CHROME=1 fails the first audit once so a run can prove the restart path.
 */
export function createLocalAuditor(): LocalAuditor {
    let chrome: LaunchedChrome | null = null;
    let auditsSinceLaunch = 0;
    let crashPending = process.env.CWV_CRASH_CHROME === '1';

    async function close(): Promise<void> {
        const current = chrome;
        chrome = null;
        auditsSinceLaunch = 0;
        if (current) await Promise.resolve(current.kill()).catch(() => undefined);
    }

    async function launch(): Promise<LaunchedChrome> {
        if (!nodeSupportsLighthouse()) {
            throw new AuditFailed('LIGHTHOUSE_ERROR', { messageOverride: 'Local Lighthouse requires Node.js 22.19 or newer.' });
        }
        const imported = (await import('chrome-launcher')) as unknown as {
            launch?: (options: { chromeFlags: string[]; chromePath?: string }) => Promise<LaunchedChrome>;
            default?: { launch?: (options: { chromeFlags: string[]; chromePath?: string }) => Promise<LaunchedChrome> };
        };
        const launch = imported.launch ?? imported.default?.launch;
        if (!launch) throw new AuditFailed('CHROME_CRASH');
        const path = chromePath();
        chrome = await launch({
            chromeFlags: CHROME_FLAGS,
            ...(path ? { chromePath: path } : {}),
        });
        auditsSinceLaunch = 0;
        return chrome;
    }

    return {
        async restart() {
            await close();
        },
        async audit(request) {
            if (crashPending) {
                crashPending = false;
                await close();
                throw new AuditFailed('CHROME_CRASH');
            }
            if (!chrome || auditsSinceLaunch >= 50) {
                await close();
                await launch();
            }
            const current = chrome;
            if (!current) throw new AuditFailed('CHROME_CRASH');
            const lighthouseModule = (await import('lighthouse')) as { default: (url: string, flags: Record<string, unknown>, config?: unknown) => Promise<{ lhr?: LhrLike } | undefined> };
            const lighthouse = lighthouseModule.default;
            const config = request.strategy === 'desktop' ? require('lighthouse/core/config/desktop-config.js') : undefined;
            const flags: Record<string, unknown> = {
                logLevel: 'error',
                output: 'json',
                port: current.port,
                onlyCategories: request.categories,
                maxWaitForLoad: Math.min(45_000, Math.max(5_000, request.timeoutMs - 1_000)),
                disableFullPageScreenshot: true,
                skipAudits: ['screenshot-thumbnails', 'final-screenshot', 'full-page-screenshot'],
            };
            try {
                const result = await lighthouse(request.url, flags, config);
                auditsSinceLaunch += 1;
                if (!result?.lhr) throw new AuditFailed('CHROME_CRASH');
                return result.lhr;
            } catch (error) {
                await close();
                if (error instanceof AuditFailed) throw error;
                if (isCrash(error)) throw new AuditFailed('CHROME_CRASH');
                throw new AuditFailed('LIGHTHOUSE_ERROR');
            }
        },
    };
}
