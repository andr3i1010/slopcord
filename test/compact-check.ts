// Compact a copy of the live brain session, to prove compaction succeeds with the current model settings.
import { copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { config } from '../src/config.ts';
import { sessionsDir } from '../src/memory.ts';
import { makeSession } from '../src/pi.ts';

const latest = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl')).sort().at(-1)!;
const copy = join(process.argv[2] ?? '/tmp', `compact-check-${latest}`);
copyFileSync(join(sessionsDir, latest), copy);
const session = await makeSession('compaction check', [], SessionManager.open(copy));
console.log('before:', session.getContextUsage());
const started = Date.now();
const result = await session.compact();
console.log(`compacted in ${Math.round((Date.now() - started) / 1000)}s, summary ${result.summary.length} chars, tokensBefore ${result.tokensBefore}`);
console.log(result.summary.slice(0, 600));
session.dispose();
process.exit(0);
