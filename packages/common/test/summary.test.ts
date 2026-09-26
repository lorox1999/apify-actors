import { beforeEach, describe, expect, it, vi } from 'vitest';

const setValue = vi.fn(async () => undefined);
const setStatusMessage = vi.fn(async () => undefined);

vi.mock('apify', () => ({
    Actor: {
        setValue: (...args: unknown[]) => setValue(...args),
        setStatusMessage: (...args: unknown[]) => setStatusMessage(...args),
        pushData: vi.fn(),
        charge: vi.fn(),
        getChargingManager: vi.fn(),
    },
}));

describe('summary', () => {
    beforeEach(() => {
        setValue.mockClear();
        setStatusMessage.mockClear();
    });

    it('accumulates records and writes SUMMARY', async () => {
        const { SummaryWriter } = await import('../src/summary.js');
        const writer = new SummaryWriter<{ site: string }>();
        writer.add({ site: 'https://a.example' });
        writer.add({ site: 'https://b.example' });
        expect(writer.snapshot()).toHaveLength(2);
        await writer.flush('Done: 2 sites, 0 URLs, 0 failed');
        expect(setValue).toHaveBeenCalledWith('SUMMARY', [
            { site: 'https://a.example' },
            { site: 'https://b.example' },
        ]);
        expect(setStatusMessage).toHaveBeenCalledWith('Done: 2 sites, 0 URLs, 0 failed');
    });

    it('formats a done message with grouped failure codes', async () => {
        const { formatDoneMessage } = await import('../src/summary.js');
        expect(formatDoneMessage(3, 12340, 1, ['NO_SITEMAP_FOUND'])).toBe('Done: 3 sites, 12,340 URLs, 1 failed (NO_SITEMAP_FOUND)');
    });

    it('omits the reason parentheses when nothing failed', async () => {
        const { formatDoneMessage } = await import('../src/summary.js');
        expect(formatDoneMessage(1, 10, 0, [])).toBe('Done: 1 sites, 10 URLs, 0 failed');
    });

    it('dedupes failure codes', async () => {
        const { formatDoneMessage } = await import('../src/summary.js');
        expect(formatDoneMessage(2, 0, 2, ['DNS_ERROR', 'DNS_ERROR'])).toBe('Done: 2 sites, 0 URLs, 2 failed (DNS_ERROR)');
    });

    it('formats zero sites', async () => {
        const { formatDoneMessage } = await import('../src/summary.js');
        expect(formatDoneMessage(0, 0, 0, [])).toContain('0 sites');
    });
});
