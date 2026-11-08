import { config } from './config.ts';
import { report } from './brain.ts';
import { client } from './discord.ts';

process.on('unhandledRejection', error => void report(error));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void client.destroy().finally(() => process.exit(0)));

await client.login(config.token);
