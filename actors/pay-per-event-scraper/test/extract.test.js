import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as cheerio from 'cheerio';

import { extractPageData, normalizeText } from '../src/extract.js';

test('normalizeText collapses whitespace and trims', () => {
    assert.equal(normalizeText('  hello   world \n foo '), 'hello world foo');
    assert.equal(normalizeText(''), '');
    assert.equal(normalizeText(null), '');
    assert.equal(normalizeText(undefined), '');
});

test('extractPageData pulls title, headings and link count', () => {
    const html = `
        <html>
            <head><title>  Example   Domain </title></head>
            <body>
                <h1>Main heading</h1>
                <h2>Sub  heading</h2>
                <h2>   </h2>
                <a href="/a">a</a>
                <a href="/b">b</a>
                <a>no href</a>
            </body>
        </html>`;
    const $ = cheerio.load(html);

    const data = extractPageData($, 'https://example.com/');

    assert.equal(data.url, 'https://example.com/');
    assert.equal(data.title, 'Example Domain');
    assert.deepEqual(data.headings, ['Main heading', 'Sub heading']);
    assert.equal(data.links, 2);
});

test('extractPageData handles a page with no title or headings', () => {
    const $ = cheerio.load('<html><body><p>nothing here</p></body></html>');

    const data = extractPageData($, 'https://empty.example/');

    assert.equal(data.title, '');
    assert.deepEqual(data.headings, []);
    assert.equal(data.links, 0);
});
