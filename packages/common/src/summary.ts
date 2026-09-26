import { Actor } from 'apify';

export class SummaryWriter<T extends object> {
    private readonly records: T[] = [];

    add(record: T): void {
        this.records.push(record);
    }

    snapshot(): T[] {
        return [...this.records];
    }

    async flush(statusMessage: string): Promise<void> {
        await Actor.setValue('SUMMARY', this.records);
        await Actor.setStatusMessage(statusMessage);
    }
}

export function formatDoneMessage(sites: number, urls: number, failed: number, failedCodes: string[]): string {
    const unique = [...new Set(failedCodes)];
    const reason = unique.length > 0 ? ` (${unique.join(', ')})` : '';
    return `Done: ${sites} sites, ${urls.toLocaleString('en-US')} URLs, ${failed} failed${reason}`;
}
