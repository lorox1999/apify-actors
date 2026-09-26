import { Actor, Configuration } from 'apify';

export interface DatasetLoad {
    urls: string[];
    rowsRead: number;
    rowsIgnored: number;
    missingField: boolean;
    sampleKeys: string[];
}

function readPath(item: Record<string, unknown>, field: string): unknown {
    let current: unknown = item;
    for (const part of field.split('.')) {
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

async function datasetIsReadable(id: string): Promise<boolean> {
    try {
        const storage = Configuration.getStorageClient();
        const listed = await storage.datasets().list();
        const items = listed.items ?? [];
        if (items.some((item) => item.id === id || item.name === id)) return true;
        const got = await storage.dataset(id).get();
        return Boolean(got);
    } catch {
        return false;
    }
}

export async function loadDatasetUrls(id: string, field: string, maxItems: number): Promise<DatasetLoad> {
    const readable = await datasetIsReadable(id);
    if (!readable) {
        const error = new Error('DATASET_NOT_ACCESSIBLE');
        (error as { code?: string }).code = 'DATASET_NOT_ACCESSIBLE';
        throw error;
    }
    const dataset = await Actor.openDataset(id);
    const data = await dataset.getData({ limit: maxItems });
    const urls: string[] = [];
    let rowsIgnored = 0;
    let withField = 0;
    const sampleKeys: string[] = [];
    for (const item of data.items) {
        if (!item || typeof item !== 'object') {
            rowsIgnored += 1;
            continue;
        }
        const record = item as Record<string, unknown>;
        if (sampleKeys.length < 5 && sampleKeys.length < 8) {
            for (const key of Object.keys(record)) {
                if (!sampleKeys.includes(key)) sampleKeys.push(key);
            }
        }
        if (typeof record.recordType === 'string' && record.recordType !== 'url') {
            rowsIgnored += 1;
            continue;
        }
        const value = readPath(record, field);
        if (typeof value !== 'string' || value.trim() === '') {
            rowsIgnored += 1;
            continue;
        }
        withField += 1;
        urls.push(value.trim());
    }
    const missingField = data.items.length >= 100 && withField === 0;
    return {
        urls,
        rowsRead: data.items.length,
        rowsIgnored,
        missingField,
        sampleKeys: sampleKeys.slice(0, 8),
    };
}
