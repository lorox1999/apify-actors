import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getChargedCounts } from '@apify-actors/common';
import { Actor, Configuration } from 'apify';

import { execute, type ExecuteOverrides } from '../src/execute.js';
import type { ActorInput, RunSummary } from '../src/types.js';

let ready: Promise<void> | null = null;

interface StorageManagerLike {
    name: string;
    cache: Map<string, { clearCache?: () => void }>;
}

function clearOpenStorages(configuration: Configuration): void {
    const managers = configuration.storageManagers as Map<unknown, StorageManagerLike>;
    for (const manager of managers.values()) {
        if (manager.name === 'KeyValueStore') {
            for (const item of manager.cache.values()) item.clearCache?.();
        }
    }
    managers.clear();
}

export async function useStorage(dir?: string): Promise<string> {
    const storageDir = dir ?? mkdtempSync(join(tmpdir(), 'cwv-run-'));
    process.env.CRAWLEE_STORAGE_DIR = storageDir;
    process.env.APIFY_LOCAL_STORAGE_DIR = storageDir;
    const configuration = Configuration.getGlobalConfig();
    configuration.set('persistStorage', true);
    const client = configuration.createMemoryStorage({
        localDataDirectory: storageDir,
        persistStorage: true,
    });
    clearOpenStorages(configuration);
    configuration.useStorageClient(client);
    await ensureActor();
    return storageDir;
}

export async function ensureActor(): Promise<void> {
    process.env.ACTOR_TEST_PAY_PER_EVENT = 'true';
    process.env.ACTOR_EXIT_PROCESS = '0';
    if (!ready) ready = Actor.init();
    await ready;
}

export async function runInput(input: ActorInput, overrides: ExecuteOverrides = {}, prepare?: () => Promise<void>): Promise<{
    items: Record<string, unknown>[];
    summary: RunSummary;
    message: string;
    storageDir: string;
    charges: Record<string, number>;
}> {
    const dir = await useStorage();
    if (prepare) await prepare();
    const dataset = await Actor.openDataset();
    const before = (await dataset.getInfo())?.itemCount ?? 0;
    const message = await execute(input, overrides);
    const items = (await dataset.getData({ limit: 1_000_000, offset: before })).items as Record<string, unknown>[];
    const summary = (await Actor.getValue<RunSummary>('SUMMARY')) ?? {
        audited: 0,
        failed: 0,
        failedByCode: {},
        billed: {},
        wouldBeBilled: {},
        averageAuditDurationMs: null,
        chargeLimitReached: false,
        urlsRequested: 0,
        auditsPlanned: 0,
        notAudited: 0,
    };
    return { items, summary, message, storageDir: dir, charges: getChargedCounts() };
}

export function storageContains(dir: string, needle: string): boolean {
    const walk = (current: string): boolean => {
        for (const entry of readdirSync(current)) {
            const path = join(current, entry);
            const info = statSync(path);
            if (info.isDirectory()) {
                if (walk(path)) return true;
            } else if (readFileSync(path, 'utf8').includes(needle)) {
                return true;
            }
        }
        return false;
    };
    return walk(dir);
}
