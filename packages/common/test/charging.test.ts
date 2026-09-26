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
    beforeEach(async () => {
        pushData.mockClear();
        charge.mockReset();
        getChargingManager.mockReset();
        getChargingManager.mockReturnValue({
            calculateMaxEventChargeCountWithinLimit: () => 10,
        });
        const { resetChargedCounts } = await import('../src/charging.js');
        resetChargedCounts();
    });

    it('charges with Actor.charge and pushes the row only after a successful charge', async () => {
        charge.mockResolvedValue({ chargedCount: 1, eventChargeLimitReached: false, chargeableWithinLimit: {} });
        const { pushCharged, flushDataset, getChargedCounts } = await import('../src/charging.js');
        const outcome = await pushCharged({ recordType: 'url' }, 'url-extracted');
        expect(charge).toHaveBeenCalledWith({ eventName: 'url-extracted', count: 1 });
        expect(pushData).not.toHaveBeenCalled();
        await flushDataset();
        expect(pushData).toHaveBeenCalledWith([{ recordType: 'url' }]);
        expect(pushData.mock.calls[0]).toHaveLength(1);
        expect(outcome).toEqual({ chargedCount: 1, wouldBeChargedCount: 1, accepted: true, limitReached: false });
        expect(getChargedCounts()).toEqual({ 'url-extracted': 1 });
    });

    it('does not push a row when Actor.charge bills nothing', async () => {
        charge.mockResolvedValue({ chargedCount: 0, eventChargeLimitReached: true, chargeableWithinLimit: {} });
        const { pushCharged, flushDataset } = await import('../src/charging.js');
        const row = { recordType: 'audit', charged: true };
        const outcome = await pushCharged(row, 'url-audited-local');
        await flushDataset();
        expect(charge).toHaveBeenCalledOnce();
        expect(pushData).not.toHaveBeenCalled();
        expect(row.charged).toBe(false);
        expect(outcome).toEqual({ chargedCount: 0, wouldBeChargedCount: 0, accepted: false, limitReached: true });
    });

    it('does not push a row when the charge limit is already reached', async () => {
        getChargingManager.mockReturnValue({ calculateMaxEventChargeCountWithinLimit: () => 0 });
        const { pushCharged, flushDataset } = await import('../src/charging.js');
        const outcome = await pushCharged({ recordType: 'url' }, 'url-extracted');
        await flushDataset();
        expect(charge).not.toHaveBeenCalled();
        expect(pushData).not.toHaveBeenCalled();
        expect(outcome.limitReached).toBe(true);
    });

    it('reports limitReached when the charge itself hits the cap', async () => {
        charge.mockResolvedValue({ chargedCount: 1, eventChargeLimitReached: true, chargeableWithinLimit: {} });
        const { pushCharged, flushDataset } = await import('../src/charging.js');
        const outcome = await pushCharged({ ok: true }, 'url-extracted');
        await flushDataset();
        expect(outcome.limitReached).toBe(true);
        expect(pushData).toHaveBeenCalledOnce();
        expect(pushData).toHaveBeenCalledWith([{ ok: true }]);
    });

    it('pushFree writes a row without an event name', async () => {
        const { pushFree, flushDataset } = await import('../src/charging.js');
        await pushFree({ recordType: 'error' });
        await flushDataset();
        expect(pushData).toHaveBeenCalledWith([{ recordType: 'error' }]);
        expect(pushData.mock.calls[0]).toHaveLength(1);
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
        expect(outcome).toEqual({ chargedCount: 0, wouldBeChargedCount: 0, accepted: false, limitReached: true });
        expect(charge).not.toHaveBeenCalled();
    });

    it('canAfford allows the charge when the manager has no budget data', async () => {
        getChargingManager.mockReturnValue({});
        const { canAfford } = await import('../src/charging.js');
        expect(await canAfford('url-extracted', 3)).toBe(true);
    });

    it('writes rows unmetered when the run does not use pay-per-event pricing', async () => {
        getChargingManager.mockReturnValue({ getPricingInfo: () => ({ isPayPerEvent: false }) });
        const { pushCharged, chargeExtra, flushDataset, getChargedCounts, getWouldBeChargedCounts } = await import('../src/charging.js');
        const row = { recordType: 'url', charged: true };
        const outcome = await pushCharged(row, 'url-extracted');
        await flushDataset();
        expect(outcome).toEqual({ chargedCount: 0, wouldBeChargedCount: 1, accepted: true, limitReached: false });
        expect(pushData).toHaveBeenCalledWith([{ recordType: 'url', charged: false }]);
        expect(charge).not.toHaveBeenCalled();
        expect(await chargeExtra('site-compared', 1)).toEqual({
            chargedCount: 0,
            wouldBeChargedCount: 1,
            accepted: true,
            limitReached: false,
        });
        expect(getChargedCounts()).toEqual({});
        expect(getWouldBeChargedCounts()).toEqual({ 'url-extracted': 1, 'site-compared': 1 });
    });

    it('sets charged true only after Actor.charge bills the row', async () => {
        charge.mockResolvedValue({ chargedCount: 1, eventChargeLimitReached: false, chargeableWithinLimit: {} });
        const { pushCharged, flushDataset, getChargedCounts, getWouldBeChargedCounts } = await import('../src/charging.js');
        const row = { recordType: 'audit', charged: false };
        const outcome = await pushCharged(row, 'url-audited-local');
        await flushDataset();
        expect(outcome.accepted).toBe(true);
        expect(outcome.chargedCount).toBe(1);
        expect(pushData).toHaveBeenCalledWith([{ recordType: 'audit', charged: true }]);
        expect(getChargedCounts()).toEqual({ 'url-audited-local': 1 });
        expect(getWouldBeChargedCounts()).toEqual({ 'url-audited-local': 1 });
    });

    it('flushes dataset rows in batches of 500 and stops at the charge limit', async () => {
        let remaining = 2;
        getChargingManager.mockReturnValue({
            calculateMaxEventChargeCountWithinLimit: () => remaining,
            getPricingInfo: () => ({ isPayPerEvent: true }),
        });
        charge.mockImplementation(async () => {
            remaining -= 1;
            return { chargedCount: 1, eventChargeLimitReached: remaining <= 0, chargeableWithinLimit: {} };
        });
        const { pushCharged, flushDataset, getChargedCounts } = await import('../src/charging.js');
        const outcomes = [];
        for (let index = 0; index < 5; index += 1) {
            outcomes.push(await pushCharged({ index }, 'url-extracted'));
        }
        await flushDataset();
        expect(outcomes.filter((outcome) => outcome.chargedCount === 1)).toHaveLength(2);
        expect(outcomes[2]?.limitReached).toBe(true);
        expect(charge).toHaveBeenCalledTimes(2);
        expect(pushData.mock.calls[0]?.[0]).toEqual([{ index: 0 }, { index: 1 }]);
        expect(getChargedCounts()['url-extracted']).toBe(2);

        pushData.mockClear();
        remaining = 600;
        getChargingManager.mockReturnValue({
            calculateMaxEventChargeCountWithinLimit: () => remaining,
            getPricingInfo: () => ({ isPayPerEvent: true }),
        });
        charge.mockImplementation(async () => {
            remaining -= 1;
            return { chargedCount: 1, eventChargeLimitReached: false, chargeableWithinLimit: {} };
        });
        for (let index = 0; index < 600; index += 1) {
            await pushCharged({ index }, 'url-extracted');
        }
        expect(pushData).toHaveBeenCalledTimes(1);
        expect(pushData.mock.calls[0]?.[0]).toHaveLength(500);
        await flushDataset();
        expect(pushData).toHaveBeenCalledTimes(2);
        expect(pushData.mock.calls[1]?.[0]).toHaveLength(100);
    });
});
