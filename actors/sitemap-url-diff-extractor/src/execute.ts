import { flushDataset, formatDoneMessage, resetChargedCounts, SummaryWriter } from '@apify-actors/common';

import { processStartUrl, type RunState } from './extract.js';
import { runPool } from './hostLock.js';
import { resolveInput } from './input.js';
import type { ActorInput, SiteSummary } from './types.js';

export async function execute(raw: ActorInput | null | undefined): Promise<string> {
    resetChargedCounts();
    const input = resolveInput(raw);
    const state: RunState = { stop: false, chargeLimitNoted: false };
    const writer = new SummaryWriter<SiteSummary>();
    const extractedAt = new Date().toISOString();
    const outcomes: { failed: boolean; failedCode?: string; urls: number }[] = [];

    await runPool(input.startUrls, 5, async (startUrl) => {
        const result = await processStartUrl(input, startUrl, state, extractedAt);
        writer.add(result.summary);
        outcomes.push({
            failed: result.failed,
            failedCode: result.failedCode,
            urls: result.summary.urlsOutput,
        });
    });

    await flushDataset();

    const failed = outcomes.filter((outcome) => outcome.failed);
    const urls = outcomes.reduce((sum, outcome) => sum + outcome.urls, 0);
    const message = formatDoneMessage(
        outcomes.length,
        urls,
        failed.length,
        failed.map((outcome) => outcome.failedCode).filter((code): code is string => Boolean(code)),
    );
    await writer.flush(message);
    return message;
}
