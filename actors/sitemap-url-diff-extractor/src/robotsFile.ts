import { createRequire } from 'node:module';

import { USER_AGENT } from './types.js';

const require = createRequire(import.meta.url);

interface Robot {
    isAllowed(url: string, ua?: string): boolean | undefined;
    getSitemaps(): string[];
}

const robotsParser = require('robots-parser') as (url: string, body: string) => Robot;

export interface RobotsFile {
    found: boolean;
    sitemaps: string[];
    isAllowed: (url: string) => boolean;
}

export function emptyRobots(): RobotsFile {
    return { found: false, sitemaps: [], isAllowed: () => true };
}

export function parseRobotsTxt(robotsUrl: string, body: string): RobotsFile {
    const parsed = robotsParser(robotsUrl, body);
    const declared = new Set<string>();
    for (const entry of parsed.getSitemaps?.() ?? []) {
        if (entry) declared.add(entry);
    }
    for (const line of body.split(/\r?\n/)) {
        const match = /^\s*sitemap:\s*(\S+)/i.exec(line);
        if (match?.[1]) declared.add(match[1]);
    }
    return {
        found: true,
        sitemaps: [...declared],
        isAllowed: (url: string) => parsed.isAllowed(url, USER_AGENT) !== false,
    };
}
