import { execFileSync } from 'node:child_process';
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Hit {
    at: number;
    method: string;
    host: string;
    path: string;
    inflight: number;
    bytesWritten: number;
    hadCookie: boolean;
}

export interface Fixture {
    httpPort: number;
    httpsPort: number;
    hits: Hit[];
    url: (host: string, path: string) => string;
    httpsUrl: (host: string, path: string) => string;
    reset: () => void;
    close: () => Promise<void>;
}

const HOSTS = ['site.test', 'ext.test', 'sub.site.test', 'delay.test', 'robots500.test'];

export function hostMapValue(): string {
    return HOSTS.map((host) => `${host}=127.0.0.1`).join(',');
}

function certPair(): { cert: Buffer; key: Buffer } {
    const dir = mkdtempSync(join(tmpdir(), 'a3b-cert-'));
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath, '-days', '1', '-nodes', '-subj', '/CN=site.test'], {
        stdio: 'ignore',
    });
    return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
}

function hostOf(req: IncomingMessage): string {
    return (req.headers.host ?? '').split(':')[0]?.toLowerCase() ?? '';
}

function redirect(res: ServerResponse, status: number, location: string, headers: Record<string, string> = {}): void {
    res.writeHead(status, { location, ...headers });
    res.end();
}

export function sitePageCount(maxDepth: number): number {
    const counts = [1, 4, 8, 8, 9];
    return counts.slice(0, maxDepth + 1).reduce((sum, n) => sum + n, 0);
}

function pageHtml(port: number, path: string): string | null {
    const marker = '<!--FIXTURE_BODY_SECRET_MARKER-->';
    const ext = `http://ext.test:${port}/ext-page`;
    const sub = `http://sub.site.test:${port}/sub`;
    const link404 = (anchor: string) => `<a href="/404">${anchor}</a>`;
    if (path === '/site' || path === '/site/') {
        return `<html><body>${marker}<a href="/site/d1/0">d1</a><a href="/site/d1/1">d1b</a><a href="/site/d1/2">d1c</a><a href="/site/d1/3">d1d</a><a href="${ext}">External</a><a href="${sub}">Sub</a>${link404('Broken 0')}</body></html>`;
    }
    const d1 = /^\/site\/d1\/(\d+)$/.exec(path);
    if (d1) {
        const n = Number(d1[1]);
        if (n > 3) return null;
        return `<html><body>${marker}<a href="/site/d2/${n * 2}">c</a><a href="/site/d2/${n * 2 + 1}">d</a>${link404(`Broken ${1 + n}`)}</body></html>`;
    }
    const d2 = /^\/site\/d2\/(\d+)$/.exec(path);
    if (d2) {
        const n = Number(d2[1]);
        if (n > 7) return null;
        return `<html><body>${marker}<a href="/site/d3/${n}">e</a>${link404(`Broken ${5 + n}`)}</body></html>`;
    }
    const d3 = /^\/site\/d3\/(\d+)$/.exec(path);
    if (d3) {
        const n = Number(d3[1]);
        if (n > 7) return null;
        const broken = n < 2 ? link404(`Broken ${13 + n}`) : '';
        return `<html><body>${marker}<a href="/site/d4/${n}">f</a>${n === 0 ? '<a href="/site/d4/8">g</a>' : ''}${broken}</body></html>`;
    }
    const d4 = /^\/site\/d4\/(\d+)$/.exec(path);
    if (d4) {
        const n = Number(d4[1]);
        if (n > 8) return null;
        return `<html><body>${marker}<p>leaf</p></body></html>`;
    }
    return null;
}

function piiHtml(port: number): string {
    const longText = 'L'.repeat(300);
    return `<html><head><title>should-not-leak</title></head><body>
<a href="mailto:jane.doe@example.com">Email jane.doe@example.com</a>
<a href="tel:+1-555-0100">Call</a>
<a href="/long">${longText}</a>
<a href="/photo"><img alt="Photo of Jane Doe" src="/p.jpg"></a>
<a href="/q?email=jane.doe@example.com">query</a>
<a href="http://user:secret@site.test:${port}/hidden">cred</a>
<a href="javascript:alert(1)">js</a>
<a href="#top">top</a>
</body></html>`;
}

function billHtml(port: number): string {
    const parts: string[] = ['<html><body>'];
    for (let i = 0; i < 10; i += 1) parts.push(`<a href="/bill/p/${i}">p${i}</a>`);
    parts.push('<a href="/bill/missing">gone</a>');
    parts.push('<a href="/bill/file.pdf">pdf</a>');
    for (let i = 0; i < 88; i += 1) {
        const kind = i < 40 ? 'ok' : i < 60 ? 'r301' : i < 80 ? '404' : '403';
        parts.push(`<a href="http://ext.test:${port}/ext-${kind}?n=${i}">e${i}</a>`);
    }
    for (let i = 0; i < 5; i += 1) parts.push(`<a href="/private/${i}">priv${i}</a>`);
    for (let i = 0; i < 5; i += 1) parts.push(`<a href="http://10.1.2.${i}/x">ip${i}</a>`);
    for (let i = 0; i < 5; i += 1) parts.push(`<a href="/429-always?n=${i}">rate${i}</a>`);
    for (let i = 0; i < 5; i += 1) parts.push('<a href="/bill/p/0">again</a>');
    parts.push('</body></html>');
    return parts.join('');
}

function limitHtml(port: number): string {
    const parts: string[] = ['<html><body>'];
    for (let i = 0; i < 50; i += 1) parts.push(`<a href="/limit/ok/${i}">ok${i}</a>`);
    for (let i = 0; i < 100; i += 1) parts.push(`<a href="/limit/extra/${i}">x${i}</a>`);
    for (let i = 0; i < 30; i += 1) parts.push(`<a href="http://ext.test:${port}/out/${i}">ext${i}</a>`);
    for (let i = 0; i < 20; i += 1) parts.push(`<a href="/files/${i}.pdf">pdf${i}</a>`);
    parts.push('</body></html>');
    return parts.join('');
}

let bigHtml: Buffer | null = null;
function getBigHtml(): Buffer {
    if (bigHtml) return bigHtml;
    const early = Buffer.from('<html><body><a href="/early-link">Early link</a>');
    const pad = Buffer.alloc(5 * 1024 * 1024, 0x61);
    const late = Buffer.from('<a href="/late-link">Late link</a></body></html>');
    const extra = Buffer.alloc(1024 * 1024, 0x62);
    bigHtml = Buffer.concat([early, pad, late, extra]);
    return bigHtml;
}

export async function startFixture(): Promise<Fixture> {
    const hits: Hit[] = [];
    const onceCounts = new Map<string, number>();
    const inflight = new Map<string, number>();
    const { cert, key } = certPair();

    const handler = (req: IncomingMessage, res: ServerResponse): void => {
        const host = hostOf(req);
        const path = (req.url ?? '/').split('?')[0] ?? '/';
        const method = req.method ?? 'GET';
        const current = (inflight.get(host) ?? 0) + 1;
        inflight.set(host, current);
        const hit: Hit = {
            at: Date.now(),
            method,
            host,
            path,
            inflight: current,
            bytesWritten: 0,
            hadCookie: Boolean(req.headers.cookie),
        };
        hits.push(hit);
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);
        res.write = ((chunk: unknown, ...rest: unknown[]) => {
            if (chunk) hit.bytesWritten += Buffer.byteLength(chunk as Uint8Array);
            return originalWrite(chunk as never, ...(rest as []));
        }) as typeof res.write;
        res.end = ((chunk?: unknown, ...rest: unknown[]) => {
            if (chunk && typeof chunk !== 'function') hit.bytesWritten += Buffer.byteLength(chunk as Uint8Array);
            return originalEnd(chunk as never, ...(rest as []));
        }) as typeof res.end;
        res.on('close', () => {
            inflight.set(host, Math.max(0, (inflight.get(host) ?? 1) - 1));
        });

        const bump = (key: string): number => {
            const next = (onceCounts.get(key) ?? 0) + 1;
            onceCounts.set(key, next);
            return next;
        };

        if (path === '/robots.txt') {
            if (host === 'robots500.test') {
                res.writeHead(500, { 'content-type': 'text/plain' });
                res.end('no');
                return;
            }
            if (host === 'delay.test') {
                res.writeHead(200, { 'content-type': 'text/plain' });
                res.end('User-agent: *\nCrawl-delay: 2\n');
                return;
            }
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('User-agent: *\nDisallow: /private/\n');
            return;
        }

        if (path === '/slow') {
            const timer = setTimeout(() => res.end('late'), 60_000);
            res.on('close', () => clearTimeout(timer));
            return;
        }

        if (path === '/sitemap.xml') {
            const hostHeader = req.headers.host ?? `127.0.0.1:${req.socket.localPort ?? 0}`;
            const locs = Array.from({ length: 100 }, (_, index) => `<url><loc>http://${hostHeader}/page/${index}</loc></url>`).join('');
            res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
            res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs}</urlset>`);
            return;
        }
        if (path.startsWith('/page/')) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            if (method === 'HEAD') res.end();
            else res.end('<html><body><a href="/ok">status</a></body></html>');
            return;
        }
        if (path === '/ok' || path.startsWith('/limit/ok/') || path.startsWith('/limit/extra/') || path === '/early-link' || path === '/hidden' || path === '/long' || path === '/photo' || path === '/q' || path === '/sub' || path === '/ext-page' || path.startsWith('/out/')) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            if (method !== 'HEAD') res.end('<html><body>ok</body></html>');
            else res.end();
            return;
        }
        if (path.startsWith('/ext-ok')) {
            res.writeHead(200, { 'content-type': 'text/html' });
            if (method !== 'HEAD') res.end('<html>ok</html>');
            else res.end();
            return;
        }
        if (path.startsWith('/ext-r301')) {
            redirect(res, 301, '/ext-ok');
            return;
        }
        if (path.startsWith('/ext-404')) {
            res.writeHead(404);
            res.end();
            return;
        }
        if (path.startsWith('/ext-403')) {
            res.writeHead(403);
            res.end();
            return;
        }
        if (path === '/r301') {
            redirect(res, 301, '/ok');
            return;
        }
        if (path === '/chain1') {
            redirect(res, 302, '/chain2');
            return;
        }
        if (path === '/chain2') {
            redirect(res, 302, '/chain3');
            return;
        }
        if (path === '/chain3') {
            redirect(res, 302, '/ok');
            return;
        }
        if (path === '/loop-a') {
            redirect(res, 302, '/loop-b');
            return;
        }
        if (path === '/loop-b') {
            redirect(res, 302, '/loop-a');
            return;
        }
        const many = /^\/many\/(\d+)$/.exec(path);
        if (many) {
            redirect(res, 302, `/many/${Number(many[1]) + 1}`);
            return;
        }
        if (path === '/404' || path === '/bill/missing') {
            res.writeHead(404, { 'content-type': 'text/html' });
            res.end('missing');
            return;
        }
        if (path === '/410') {
            res.writeHead(410);
            res.end();
            return;
        }
        if (path === '/500') {
            res.writeHead(500);
            res.end('nope');
            return;
        }
        if (path === '/503-once') {
            if (bump('503') === 1) {
                res.writeHead(503);
                res.end();
                return;
            }
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('ok');
            return;
        }
        if (path === '/429-once') {
            if (bump('429-once') === 1) {
                res.writeHead(429, { 'retry-after': '2' });
                res.end();
                return;
            }
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('ok');
            return;
        }
        if (path === '/429-always') {
            res.writeHead(429, { 'retry-after': '0' });
            res.end();
            return;
        }
        if (path === '/head-405') {
            if (method === 'HEAD') {
                res.writeHead(405);
                res.end();
                return;
            }
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('ok');
            return;
        }
        if (path === '/head-404') {
            if (method === 'HEAD') {
                res.writeHead(404);
                res.end();
                return;
            }
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('ok');
            return;
        }
        if (path === '/403') {
            res.writeHead(403);
            res.end();
            return;
        }
        if (path === '/cf') {
            res.writeHead(403, { 'cf-mitigated': 'challenge' });
            res.end();
            return;
        }
        if (path === '/999') {
            res.writeHead(999);
            res.end();
            return;
        }
        if (path === '/cookie-redirect') {
            if (!req.headers.cookie?.includes('a3b=')) {
                redirect(res, 302, '/cookie-redirect', { 'set-cookie': 'a3b=session-secret-cookie; Path=/' });
                return;
            }
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('ok');
            return;
        }
        if (path === '/big.html') {
            const body = getBigHtml();
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(body.length) });
            if (method === 'HEAD') res.end();
            else res.end(body);
            return;
        }
        if (path === '/file.pdf' || path === '/bill/file.pdf' || path.endsWith('.pdf')) {
            res.writeHead(200, { 'content-type': 'application/pdf' });
            if (method === 'HEAD') res.end();
            else res.end('%PDF-1.4\n%fixture\n');
            return;
        }
        if (path === '/pii') {
            const address = req.socket.localPort ?? 0;
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(piiHtml(address));
            return;
        }
        if (path === '/bill' || path === '/bill/') {
            const address = req.socket.localPort ?? 0;
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(billHtml(address));
            return;
        }
        if (path.startsWith('/bill/p/')) {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('<html><body><a href="#top">x</a></body></html>');
            return;
        }
        if (path === '/limit' || path === '/limit/') {
            const address = req.socket.localPort ?? 0;
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(limitHtml(address));
            return;
        }
        if (path === '/robots-page') {
            const address = req.socket.localPort ?? 0;
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end(`<html><body><a href="/private/x">hidden</a><a href="http://delay.test:${address}/a">one</a><a href="http://delay.test:${address}/b">two</a><a href="http://robots500.test:${address}/x">bad</a></body></html>`);
            return;
        }
        if (path === '/both') {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('<html><body><a href="/big.html">big</a><a href="/file.pdf">pdf</a></body></html>');
            return;
        }
        const site = pageHtml(req.socket.localPort ?? 0, path);
        if (site) {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            if (method === 'HEAD') res.end();
            else res.end(site);
            return;
        }
        if (path === '/drip') {
            setTimeout(() => {
                res.writeHead(200, { 'content-type': 'text/html' });
                res.end('ok');
            }, 150);
            return;
        }
        res.writeHead(200, { 'content-type': 'text/html' });
        if (method === 'HEAD') res.end();
        else res.end('<html><body>ok</body></html>');
    };

    const httpServer = createHttp(handler);
    const httpsServer = createHttps({ cert, key }, handler);
    await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(0, '127.0.0.1', () => resolve());
    });
    await new Promise<void>((resolve, reject) => {
        httpsServer.once('error', reject);
        httpsServer.listen(0, '127.0.0.1', () => resolve());
    });
    const httpPort = (httpServer.address() as { port: number }).port;
    const httpsPort = (httpsServer.address() as { port: number }).port;

    return {
        httpPort,
        httpsPort,
        hits,
        url(host: string, path: string) {
            return `http://${host}:${httpPort}${path}`;
        },
        httpsUrl(host: string, path: string) {
            return `https://${host}:${httpsPort}${path}`;
        },
        reset() {
            hits.length = 0;
            onceCounts.clear();
        },
        close() {
            return Promise.all([
                new Promise<void>((resolve) => httpServer.close(() => resolve())),
                new Promise<void>((resolve) => httpsServer.close(() => resolve())),
            ]).then(() => undefined);
        },
    };
}
