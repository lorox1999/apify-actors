import { Actor } from 'apify';

import { execute } from './execute.js';
import type { ActorInput } from './types.js';

const exitProcess = process.env.ACTOR_EXIT_PROCESS !== '0';

await Actor.init();
try {
    const input = await Actor.getInput<ActorInput>();
    const message = await execute(input);
    await Actor.exit(message, { exit: exitProcess });
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await Actor.fail(message, { exit: exitProcess });
    if (!exitProcess) throw error;
}
