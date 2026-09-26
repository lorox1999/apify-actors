import { normalizeUrl } from '@apify-actors/common';

const MD_LINK = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi;
const ANGLE = /<(https?:\/\/[^>\s]+)>/gi;
const BARE = /(?:^|\s)(https?:\/\/[^\s<>)\]]+)/gi;

export function extractLlmsLinks(text: string): { links: string[]; count: number } {
    const found: string[] = [];
    const push = (value: string) => {
        const cleaned = value.replace(/[),.;]+$/, '');
        const norm = normalizeUrl(cleaned);
        if (norm) found.push(norm);
    };
    for (const match of text.matchAll(MD_LINK)) if (match[1]) push(match[1]);
    for (const match of text.matchAll(ANGLE)) if (match[1]) push(match[1]);
    for (const match of text.matchAll(BARE)) if (match[1]) push(match[1]);
    const unique = [...new Set(found)];
    return { links: unique, count: unique.length };
}
