import { Actor } from 'apify';

await Actor.init();
await Actor.pushData({
    recordType: 'error',
    errorCode: 'NOT_IMPLEMENTED',
    errorMessage: 'not implemented',
    extractedAt: new Date().toISOString(),
});
await Actor.exit();
