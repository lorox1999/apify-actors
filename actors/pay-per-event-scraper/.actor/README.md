# Pay-per-event Scraper

An example [Apify](https://apify.com) Actor demonstrating the **pay-per-event** pricing model.

It crawls a list of start URLs, extracts each page's title, headings, and link
count into the default dataset, and charges the `page-scraped` event once per
successfully scraped page.

## Input

| Field | Type | Description |
| --- | --- | --- |
| `startUrls` | array | URLs to scrape. Defaults to the IANA example domains. |
| `maxItems` | integer | Maximum number of pages to scrape/charge. Defaults to `20`. |

## Pay-per-event

Pricing is declared in [`pay_per_event.json`](./pay_per_event.json). Each scraped
page triggers `Actor.charge({ eventName: 'page-scraped' })`.
