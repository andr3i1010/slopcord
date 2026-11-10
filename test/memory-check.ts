// Does the send gate show the right memories, once per run, and never block when Jev has nothing or fails? Jev is stubbed.
// Run: DATA_DIR=$(mktemp -d) node test/memory-check.ts
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { memories, memoryGate, recall } from '../src/jev.ts';
import { notesDir } from '../src/memory.ts';

mkdirSync(join(notesDir, 'archive'), { recursive: true });
writeFileSync(join(notesDir, 'rules.md'), '---\ndescription: everywhere\n- not a memory: frontmatter\n---\n- Never type @everyone.\n');
writeFileSync(join(notesDir, 'people.md'), '---\ndescription: who is who\n---\n# People\n## Facts\n- Zovrenth: she/her.\n- Abel is learning French.\n## History\n- 9 nov: something happened.\n');
writeFileSync(join(notesDir, 'archive', 'old.md'), '- An archived memory.\n');

const all = memories();
assert.deepEqual(all, ['people › Facts: Zovrenth: she/her.', 'people › Facts: Abel is learning French.', 'rules: Never type @everyone.'],
  'bullets outside frontmatter, History and archive/, labelled note › heading');

/** A stand-in for Jev: each memory scores what `rate` gives it for its text. */
const stub = (rate: (memory: string) => number) => async (_state: unknown, questions: Record<string, object>) =>
  Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, rate(JSON.stringify(q))]));

assert.equal(await recall('chat', {}, stub(() => 0.2)), '', 'nothing above 0.5, nothing shown');
assert.equal(await recall('chat', {}, async () => { throw new Error('Jev down'); }), '', 'Jev failing shows nothing');
const ranked = await recall('chat', {}, stub(m => m.includes('French') ? 0.9 : m.includes('everyone') ? 0.6 : 0.1));
assert.equal(ranked, '- people › Facts: Abel is learning French.\n- rules: Never type @everyone.', 'only ≥ 0.5, best first');

writeFileSync(join(notesDir, 'many.md'), Array.from({ length: 20 }, (_, i) => `- Memory number ${i} ${'x'.repeat(300)}\n`).join(''));
const capped = (await recall('chat', {}, stub(() => 0.9))).split('\n');
assert.ok(capped.length <= 8 && capped.join('\n').length <= 1500, 'at most 8 lines and 1500 characters');

// The gate, through a fake Pi extension API.
let rate = (m: string) => (m.includes('everyone') ? 0.8 : 0.1);
const gate = memoryGate(() => 'chat', stub(m => rate(m)));
let onToolCall: (e: object) => Promise<any> = async () => undefined;
gate.extension({ on: (event: string, fn: typeof onToolCall) => { if (event === 'tool_call') onToolCall = fn; } } as never);
const send = { toolName: 'send', input: { channelId: 'c', text: 'hi @everyone' } };

assert.equal(await onToolCall({ toolName: 'react', input: {} }), undefined, 'other tools pass');
const held = await onToolCall(send);
assert.equal(held?.block, true, "the run's first send is held back");
assert.match(held.reason, /Not sent yet[\s\S]*Never type @everyone[\s\S]*Send again/);
assert.equal(await onToolCall(send), undefined, 'the second send in the same run goes through');

gate.newRun(); rate = () => 0.1;
assert.equal(await onToolCall(send), undefined, 'nothing relevant: the first send goes straight through');
gate.newRun(); rate = () => { throw new Error('Jev down'); };
assert.equal(await onToolCall(send), undefined, 'Jev failing never blocks a send');

console.log('memory OK');
process.exit(0);
