import { Actor } from 'apify';
import { redact } from '@apify-actors/common';

import { execute } from './execute.js';
import { FatalInputError } from './fatal.js';
import type { ActorInput } from './types.js';

const exitProcess = process.env.ACTOR_EXIT_PROCESS !== '0';

await Actor.init();
try {
    const input = await Actor.getInput<ActorInput>();
    const message = await execute(input);
    await Actor.exit(message, { exit: exitProcess });
} catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = error instanceof FatalInputError ? redact(raw) : redact(raw || 'The run failed before it could finish.');
    await Actor.fail(message, { exit: exitProcess });
    if (!exitProcess) throw error;
}
