import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';

export type Handler = (req: IncomingMessage, res: ServerResponse, base: string) => void | Promise<void>;

export async function startServer(handler: Handler): Promise<{ base: string; close: () => Promise<void>; server: Server }> {
    const server = createServer((req, res) => {
        const address = server.address();
        const port = address && typeof address !== 'string' ? address.port : 0;
        const base = `http://127.0.0.1:${port}`;
        Promise.resolve(handler(req, res, base)).catch((error: unknown) => {
            res.writeHead(500);
            res.end(error instanceof Error ? error.message : 'error');
        });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    return {
        base: `http://127.0.0.1:${address.port}`,
        server,
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };
}

export function urlset(urls: { loc: string; lastmod?: string; changefreq?: string; priority?: string; extra?: string }[]): string {
    const body = urls.map((url) => {
        return `<url><loc>${url.loc}</loc>${url.lastmod ? `<lastmod>${url.lastmod}</lastmod>` : ''}${url.changefreq ? `<changefreq>${url.changefreq}</changefreq>` : ''}${url.priority ? `<priority>${url.priority}</priority>` : ''}${url.extra ?? ''}</url>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

export function robots(sitemapUrl: string, extra = ''): string {
    return `User-agent: *\nDisallow:\n${extra}Sitemap: ${sitemapUrl}\n`;
}
