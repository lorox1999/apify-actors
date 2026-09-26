import { lookup } from 'node:dns';

import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';

import { testHostMap } from './net.js';

export function createDispatcher(timeoutMs: number): Dispatcher {
    const map = testHostMap();
    return new Agent({
        connect: {
            timeout: timeoutMs,
            lookup(hostname, options, callback) {
                const mapped = map.get(String(hostname).toLowerCase());
                if (mapped) {
                    if (options?.all) {
                        callback(null, [{ address: mapped, family: 4 }]);
                        return;
                    }
                    callback(null, mapped, 4);
                    return;
                }
                lookup(hostname, options, callback);
            },
        },
        headersTimeout: timeoutMs,
        bodyTimeout: Math.max(timeoutMs, 30_000),
    });
}

export { undiciFetch };
