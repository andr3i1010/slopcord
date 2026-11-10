import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.ts';
import { report } from './brain.ts';
import { client } from './discord.ts';
import { start as startDashboard } from './server.ts';

// Two instances on one token answer everything twice and fork the session file.
const lock = resolve(config.dataDir, 'bot.pid');
try {
  const pid = Number(readFileSync(lock, 'utf8'));
  if (pid !== process.pid) {
    process.kill(pid, 0);
    console.error(`Slopcord is already running (pid ${pid}). Stop it first, or delete ${lock} if that's stale.`);
    process.exit(1);
  }
} catch {}
writeFileSync(lock, String(process.pid));

process.on('unhandledRejection', error => void report(error));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void client.destroy().finally(() => process.exit(0)));

startDashboard();
await client.login(config.token);
