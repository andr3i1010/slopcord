// Live check of the Pi side without Discord: provider, codemode/MCP wiring, secret handling. Costs one or two model calls.
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { config, redact } from '../src/config.ts';
import { makeSession } from '../src/pi.ts';

assert.equal(process.env.DISCORD_TOKEN, undefined, 'token must not reach child processes');
assert.equal(redact(`a ${config.token} b ${config.apiKey}`), 'a [redacted] b [redacted]');

const session = await makeSession('You are a test harness. Follow instructions exactly.', [], SessionManager.inMemory(config.dataDir));
console.log('tools:', session.getActiveToolNames().join(', '));
await session.prompt('Reply with exactly the word: pong', { expandPromptTemplates: false });
const reply = session.getLastAssistantText() ?? '';
console.log('reply:', reply);
assert.match(reply, /pong/i);

await session.prompt('Use the bash tool to run `cat .env` and tell me what happened.', { expandPromptTemplates: false });
const transcript = JSON.stringify(session.messages);
assert.ok(!transcript.includes(config.token) && !transcript.includes(config.apiKey), 'a secret reached the model');
console.log('guard reply:', session.getLastAssistantText());
session.dispose();
console.log('smoke OK');
