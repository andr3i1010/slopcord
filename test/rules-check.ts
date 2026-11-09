// Do rules in notes reach the model when an event from their server, channel or person arrives? No model involved.
// Run: DATA_DIR=$(mktemp -d) node test/rules-check.ts
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { notesDir, rulesFor } from '../src/memory.ts';
import { systemPrompt } from '../src/pi.ts';

const note = (file: string, applies: string, body: string) =>
  writeFileSync(join(notesDir, file), `---\ndescription: test\napplies: ${applies}\n---\n${body}`);
note('server.md', '[111, 222]', '## Rules\n- When pinged in a channel I cannot post in, answer in #home.\n\n## Facts\n- not a rule\n');
note('person.md', '[333]', '# Sam\n## Rules\n- Call Sam "captain".\n');
note('no-rules.md', '[111]', '## Facts\n- just facts\n');
const event = (o: object) => JSON.stringify({ kind: 'message', id: '999', text: 'hi', ...o });

const server = rulesFor(event({ channelId: '222', guildId: '111', author: { id: '444' } }));
assert.match(server, /answer in #home/, 'server/channel rules show up');
assert.doesNotMatch(server, /not a rule|just facts/, 'only the ## Rules section, and only notes that have one');
assert.doesNotMatch(server, /captain/, "someone else's rules stay out");
assert.match(rulesFor(event({ channelId: '555', author: { id: '333' } })), /captain/, 'rules about a person come up by author id');
assert.equal(rulesFor(event({ channelId: '555', author: { id: '666' } })), '', 'nothing applies, nothing shown');

note('long.md', '[777]', `## Rules\n${'- a long rule\n'.repeat(300)}`);
assert.match(rulesFor(event({ channelId: '777' })), /cut off/, 'capped');

writeFileSync(join(notesDir, 'rules.md'), '---\ndescription: everywhere\n---\n- Never post before 07:00.\n');
const prompt = systemPrompt('brain', { username: 'bot', id: '1' } as never);
assert.match(prompt, /# Standing rules[\s\S]*Never post before 07:00/, 'rules.md is in the system prompt');
assert.doesNotMatch(prompt, /description: everywhere/, 'without its frontmatter');

console.log('rules OK');
process.exit(0);
