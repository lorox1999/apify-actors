/**
 * Pure page-parsing helpers.
 *
 * Kept free of any Apify/Crawlee runtime state so they can be unit tested
 * deterministically without network access.
 */

/**
 * Normalize whitespace in a string, collapsing runs of whitespace and trimming.
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function normalizeText(value) {
    if (!value) return '';
    return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Extract structured data from a loaded Cheerio document.
 *
 * @param {import('cheerio').CheerioAPI} $ Cheerio instance for the page.
 * @param {string} url The URL the page was loaded from.
 * @returns {{ url: string, title: string, headings: string[], links: number }}
 */
export function extractPageData($, url) {
    const title = normalizeText($('title').first().text());

    const headings = $('h1, h2')
        .map((_i, el) => normalizeText($(el).text()))
        .get()
        .filter((text) => text.length > 0);

    const links = $('a[href]').length;

    return { url, title, headings, links };
}
