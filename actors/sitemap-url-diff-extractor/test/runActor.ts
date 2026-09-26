import { mkdtempSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Actor, Configuration, Dataset } from 'apify';
import { getChargedCounts } from '@apify-actors/common';

import { execute } from '../src/execute.js';
import type { ActorInput, SiteSummary } from '../src/types.js';

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

/**
 * Local memory storage ignores APIFY_LOCAL_STORAGE_DIR and keeps the first
 * client it opened. Bind CRAWLEE_STORAGE_DIR and a directory-specific client
 * before the first init, and rebind on later runs so snapshots and the
 * charging log land in the directory the test reads.
 */
export async function useStorage(dir?: string, persist = true): Promise<string> {
    const storageDir = dir ?? mkdtempSync(join(tmpdir(), 'sitemap-run-'));
    process.env.CRAWLEE_STORAGE_DIR = storageDir;
    process.env.APIFY_LOCAL_STORAGE_DIR = storageDir;
    const configuration = Configuration.getGlobalConfig();
    configuration.set('persistStorage', persist);
    const client = configuration.createMemoryStorage({
        localDataDirectory: storageDir,
        persistStorage: persist,
    });
    clearOpenStorages(configuration);
    configuration.useStorageClient(client);
    await ensureActor();
    if (process.env.ACTOR_USE_CHARGING_LOG_DATASET === 'true') {
        const dataset = await Dataset.open('charging_log');
        (Actor.getChargingManager() as unknown as { chargingLogDataset?: Dataset }).chargingLogDataset = dataset;
    }
    return storageDir;
}

export async function ensureActor(): Promise<void> {
    process.env.ACTOR_TEST_PAY_PER_EVENT = 'true';
    process.env.ACTOR_EXIT_PROCESS = '0';
    if (process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS === undefined) process.env.ALLOW_PRIVATE_HOSTS_FOR_TESTS = '1';
    if (!process.env.SITEMAP_REQUEST_GAP_MS) process.env.SITEMAP_REQUEST_GAP_MS = '0';
    if (!ready) {
        ready = Actor.init();
        await ready;
    }
    await ready;
}

export async function runInput(input: ActorInput, storageDir?: string, persist = true, loadItems = true): Promise<{
    items: Record<string, unknown>[];
    summary: SiteSummary[];
    message: string;
    storageDir: string;
    charges: Record<string, number>;
}> {
    const dir = await useStorage(storageDir, persist);
    const dataset = await Actor.openDataset();
    const before = (await dataset.getInfo())?.itemCount ?? 0;
    const message = await execute(input);
    const items = loadItems
        ? (await dataset.getData({ limit: 1_000_000, offset: before })).items
        : [];
    const summary = (await Actor.getValue<SiteSummary[]>('SUMMARY')) ?? [];
    return {
        items: items as Record<string, unknown>[],
        summary,
        message,
        storageDir: dir,
        charges: getChargedCounts(),
    };
}

export async function countEventInStorage(storageDir: string, eventName: string): Promise<number> {
    const root = join(storageDir, 'datasets', 'charging_log');
    let count = 0;
    async function walk(current: string): Promise<void> {
        let entries: string[] = [];
        try {
            entries = await readdir(current);
        } catch {
            return;
        }
        for (const entry of entries) {
            const path = join(current, entry);
            if (entry.includes('.')) {
                try {
                    const text = await readFile(path, 'utf8');
                    const matches = text.match(new RegExp(`"${eventName}"`, 'g'));
                    count += matches?.length ?? 0;
                } catch {
                    // skip unreadable files
                }
            } else {
                await walk(path);
            }
        }
    }
    await walk(root);
    return count;
}
