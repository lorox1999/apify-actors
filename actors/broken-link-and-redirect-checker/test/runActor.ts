import { mkdtempSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Actor, Configuration, Dataset } from 'apify';
import { getChargedCounts } from '@apify-actors/common';

import { execute } from '../src/execute.js';
import { hostMapValue } from './fixtures/a3b-server.js';
import type { ActorInput } from '../src/types.js';

let ready: Promise<void> | null = null;
const captured: string[] = [];

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

function remember(args: unknown[]): void {
    captured.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
}

function tapLog(): void {
    const flag = globalThis as { __a3bTapped?: boolean };
    if (flag.__a3bTapped) return;
    flag.__a3bTapped = true;
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            remember(args);
            return original(...args);
        };
    }
    const log = Actor.log as unknown as Record<string, (...args: unknown[]) => unknown> | undefined;
    if (!log) return;
    for (const level of ['info', 'warning', 'error', 'debug', 'exception']) {
        const original = log[level];
        if (typeof original !== 'function') continue;
        log[level] = (...args: unknown[]) => {
            remember(args);
            return original.apply(log, args);
        };
    }
}

export function logLines(): string[] {
    return captured;
}

export function clearLogs(): void {
    captured.length = 0;
}

export async function useStorage(dir?: string, persist = true): Promise<string> {
    const storageDir = dir ?? mkdtempSync(join(tmpdir(), 'a3b-run-'));
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
    process.env.ACTOR_TEST_PAY_PER_EVENT = process.env.ACTOR_TEST_PAY_PER_EVENT ?? 'true';
    process.env.ACTOR_EXIT_PROCESS = '0';
    process.env.A3B_TEST_HOST_MAP = hostMapValue();
    if (process.env.A3B_TEST_RETRY_DELAY_MS === undefined) process.env.A3B_TEST_RETRY_DELAY_MS = '0';
    if (!ready) {
        ready = Actor.init();
        await ready;
        tapLog();
    }
    await ready;
}

export interface RunOptions {
    storageDir?: string;
    persist?: boolean;
    allowPrivate?: boolean;
}

export async function runInput(input: ActorInput, options: RunOptions = {}): Promise<{
    items: Record<string, unknown>[];
    summary: Record<string, unknown>;
    csv: string;
    message: string;
    storageDir: string;
    charges: Record<string, number>;
}> {
    if (options.allowPrivate === false) process.env.A3B_TEST_ALLOW_PRIVATE_HOSTS = '0';
    else process.env.A3B_TEST_ALLOW_PRIVATE_HOSTS = '1';
    const dir = await useStorage(options.storageDir, options.persist ?? true);
    const dataset = await Actor.openDataset();
    const before = (await dataset.getInfo())?.itemCount ?? 0;
    const message = await execute(input);
    const items = (await dataset.getData({ limit: 1_000_000, offset: before })).items as Record<string, unknown>[];
    const summary = (await Actor.getValue<Record<string, unknown>>('SUMMARY')) ?? {};
    const csvValue = await Actor.getValue<string>('BROKEN_LINKS.csv');
    const csv = typeof csvValue === 'string' ? csvValue : '';
    return {
        items,
        summary,
        csv,
        message,
        storageDir: dir,
        charges: getChargedCounts(),
    };
}

export async function storageText(storageDir: string): Promise<string> {
    const chunks: string[] = [];
    async function walk(current: string): Promise<void> {
        let entries: string[] = [];
        try {
            entries = await readdir(current);
        } catch {
            return;
        }
        for (const entry of entries) {
            const path = join(current, entry);
            let isFile = false;
            try {
                const text = await readFile(path);
                chunks.push(text.toString('utf8'));
                isFile = true;
            } catch {
                isFile = false;
            }
            if (!isFile) await walk(path);
        }
    }
    await walk(storageDir);
    return chunks.join('\n');
}
