import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateInputSchema } from '@apify/input_schema';
import Ajv2019 from 'ajv/dist/2019.js';
import { describe, expect, it } from 'vitest';

const ajv = new Ajv2019({ strict: false, allErrors: true, validateSchema: false });

const schemaDir = resolve('docs/specs/schemas');

function load(name: string): Record<string, unknown> {
    return JSON.parse(readFileSync(resolve(schemaDir, name), 'utf8')) as Record<string, unknown>;
}

describe('actor schemas', () => {
    const inputNames = readdirSync(schemaDir).filter((name) => name.endsWith('.input_schema.json'));

    it('finds an input schema for each actor spec', () => {
        expect(inputNames.sort()).toEqual([
            'actor1.input_schema.json',
            'actor2.input_schema.json',
            'actor3.input_schema.json',
            'actor3b.input_schema.json',
        ]);
    });

    it.each(inputNames)('validates %s', (name) => {
        const schema = load(name);
        expect(() => validateInputSchema(ajv, schema)).not.toThrow();
    });

    it.each([
        'actor1.output_schema.json',
        'actor2.output_schema.json',
        'actor3.output_schema.json',
        'actor3b.output_schema.json',
    ])('gives every output property a type in %s', (name) => {
        const schema = load(name) as { properties: Record<string, { type?: string }> };
        for (const [key, property] of Object.entries(schema.properties)) {
            expect(property.type, key).toBe('string');
        }
    });

    it.each(['actor1.dataset_schema.json', 'actor2.dataset_schema.json', 'actor3.dataset_schema.json', 'actor3b.dataset_schema.json'])(
        'view fields exist on %s',
        (name) => {
            const schema = load(name) as {
                fields: { properties: Record<string, unknown> };
                views: Record<string, { transformation?: { fields?: string[] } }>;
            };
            const properties = schema.fields.properties;
            for (const view of Object.values(schema.views)) {
                for (const field of view.transformation?.fields ?? []) {
                    expect(properties, field).toHaveProperty(field);
                }
            }
        },
    );
});
