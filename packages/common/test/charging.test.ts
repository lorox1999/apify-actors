import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushData = vi.fn(async () => undefined);
const charge = vi.fn();
const getChargingManager = vi.fn();

vi.mock('apify', () => ({
    Actor: {
        pushData: (...args: unknown[]) => pushData(...args),
        charge: (...args: unknown[]) => charge(...args),
        getChargingManager: () => getChargingManager(),
        setValue: vi.fn(),
        setStatusMessage: vi.fn(),
    },
}));

describe('charging', () => {
    beforeEach(() => {
        pushData.mockClear();
        charge.mockReset();
        getChargingManager.mockReset();
        getChargingManager.mockReturnValue({
            calculateMaxEventChargeCountWithinLimit: () => 10,
        });
    });

    it('charges with Actor.charge and pushes the row only after a successful charge', async () => {
        charge.mockResolvedValue({ chargedCount: 1, eventChargeLimitReached: false, chargeableWithinLimit: {} });
        const { pushCharged, resetChargedCounts, getChargedCounts } = await import('../src/charging.js');
        resetChargedCounts();
        const outcome = await pushCharged({ recordType: 'url' }, 'url-extracted');
        expect(charge).toHaveBeenCalledWith({ eventName: 'url-extracted', count: 1 });
        expect(pushData).toHaveBeenCalledWith({ recordType: 'url' });
        expect(pushData.mock.calls[0]).toHaveLength(1);
        expect(outcome).toEqual({ chargedCount: 1, limitReached: false });
        expect(getChargedCounts()).toEqual({ 'url-extracted': 1 });
    });

    it('does not push a row when the charge limit is already reached', async () => {
        getChargingManager.mockReturnValue({ calculateMaxEventChargeCountWithinLimit: () => 0 });
        const { pushCharged, resetChargedCounts } = await import('../src/charging.js');
        resetChargedCounts();
        const outcome = await pushCharged({ recordType: 'url' }, 'url-extracted');
        expect(charge).not.toHaveBeenCalled();
        expect(pushData).not.toHaveBeenCalled();
        expect(outcome.limitReached).toBe(true);
    });

    it('reports limitReached when the charge itself hits the cap', async () => {
        charge.mockResolvedValue({ chargedCount: 1, eventChargeLimitReached: true, chargeableWithinLimit: {} });
        const { pushCharged, resetChargedCounts } = await import('../src/charging.js');
        resetChargedCounts();
        const outcome = await pushCharged({ ok: true }, 'url-extracted');
        expect(outcome.limitReached).toBe(true);
        expect(pushData).toHaveBeenCalledOnce();
    });

    it('pushFree writes a row without an event name', async () => {
        const { pushFree } = await import('../src/charging.js');
        await pushFree({ recordType: 'error' });
        expect(pushData).toHaveBeenCalledWith({ recordType: 'error' });
        expect(charge).not.toHaveBeenCalled();
    });

    it('chargeExtra uses Actor.charge and canAfford reads the charging manager', async () => {
        charge.mockResolvedValue({ chargedCount: 1, eventChargeLimitReached: false, chargeableWithinLimit: { 'site-compared': 4 } });
        const { canAfford, chargeExtra, getChargedCounts, resetChargedCounts } = await import('../src/charging.js');
        resetChargedCounts();
        expect(await canAfford('site-compared', 1)).toBe(true);
        const outcome = await chargeExtra('site-compared', 1);
        expect(outcome.chargedCount).toBe(1);
        expect(getChargedCounts()['site-compared']).toBe(1);
    });

    it('canAfford falls back to chargeableWithinLimit', async () => {
        getChargingManager.mockReturnValue({ chargeableWithinLimit: { 'status-checked': 0 } });
        const { canAfford } = await import('../src/charging.js');
        expect(await canAfford('status-checked')).toBe(false);
    });

    it('chargeExtra stops when the event is no longer affordable', async () => {
        getChargingManager.mockReturnValue({ calculateMaxEventChargeCountWithinLimit: () => 0 });
        const { chargeExtra, resetChargedCounts } = await import('../src/charging.js');
        resetChargedCounts();
        const outcome = await chargeExtra('status-checked', 2);
        expect(outcome).toEqual({ chargedCount: 0, limitReached: true });
        expect(charge).not.toHaveBeenCalled();
    });

    it('canAfford allows the charge when the manager has no budget data', async () => {
        getChargingManager.mockReturnValue({});
        const { canAfford } = await import('../src/charging.js');
        expect(await canAfford('url-extracted', 3)).toBe(true);
    });
});
