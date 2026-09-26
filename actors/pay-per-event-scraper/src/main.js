import { Actor } from 'apify';
import { CheerioCrawler, log } from 'crawlee';

import { extractPageData } from './extract.js';

/**
 * Name of the pay-per-event event charged once per successfully scraped page.
 * Must match an event declared in `.actor/pay_per_event.json`.
 */
const PAGE_SCRAPED_EVENT = 'page-scraped';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
    startUrls = [{ url: 'https://example.com' }, { url: 'https://www.iana.org/help/example-domains' }],
    maxItems = 20,
} = input;

// Normalize the start URLs into the shape Crawlee expects.
const requests = startUrls.map((entry) => (typeof entry === 'string' ? { url: entry } : entry));

log.info('Starting pay-per-event scraper', { startUrls: requests.map((r) => r.url), maxItems });

let scrapedCount = 0;

const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: maxItems,
    requestHandler: async ({ request, $ }) => {
        const data = extractPageData($, request.loadedUrl ?? request.url);
        await Actor.pushData(data);

        // Charge for the pay-per-event billing model: one charge per scraped page.
        await Actor.charge({ eventName: PAGE_SCRAPED_EVENT });
        scrapedCount += 1;

        log.info(`Scraped and charged for page (${scrapedCount})`, { url: data.url, title: data.title });
    },
    failedRequestHandler: async ({ request }) => {
        log.warning('Request failed', { url: request.url, errors: request.errorMessages });
    },
});

await crawler.run(requests);

log.info('Scraper finished', { scrapedCount });

await Actor.exit();
