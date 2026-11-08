// The real brain and model against a fake Discord, in a temp data dir: answers must land in the channel they belong to.
// Channel routing only; how the model words or targets its replies isn't tested.
// Run: DATA_DIR=$(mktemp -d) node test/routing-check.ts
import assert from 'node:assert/strict';
import { container } from '@sapphire/framework';

const sent: { channel: string; text: string; replyTo?: string }[] = [];
const message = (channelId: string, id: string) => ({
  id, channelId,
  reactions: { resolve: () => undefined }, react: async () => {}, reply: async () => ({ id: 'r' }),
});
const channel = (id: string) => ({
  id, lastMessageId: undefined, isSendable: () => true, sendTyping: async () => {},
  isDMBased: () => false,
  send: async (o: any) => { sent.push({ channel: id, text: typeof o === 'string' ? o : o.content, replyTo: o.reply?.messageReference }); return { id: `s${sent.length}` }; },
  messages: { fetch: async (mid: string) => message(id, mid) },
});
(container as any).client = {
  user: { id: '999', username: 'TestBot' },
  channels: { fetch: async (id: string) => channel(id) },
  users: { fetch: async () => ({ send: async (o: any) => console.log('owner DM:', o.content) }) },
};

const brain = await import('../src/brain.ts');
await brain.start();
const event = (channelId: string, id: string, text: string, toYou?: boolean) =>
  JSON.stringify({ kind: 'message', id, channelId, toYou, where: `#${channelId} in Test`, author: { id: '5', name: 'sam', authorized: false }, text });

brain.deliver(event('A', 'a1', 'TestBot, how do I export an SVG in Inkscape? one line please'), [], false, [], { channelId: 'A', messageId: 'a1' });
await new Promise(r => setTimeout(r, 300));
brain.addPending('B', 'b1');
brain.deliver(event('B', 'b1', '<@999> what is 2+2? just the number', true), [], true, ['b1'], { channelId: 'B', messageId: 'b1' });

for (let s = 0; s < 120 && !(sent.some(m => m.channel === 'B') && brain.status().includes('\nidle')); s++) await new Promise(r => setTimeout(r, 1000));
console.log(sent);
assert.ok(sent.some(m => m.channel === 'B' && m.text.includes('4')), 'the ping in B was not answered in B');
assert.ok(!sent.some(m => m.channel === 'B' && /inkscape|export|svg/i.test(m.text)), "A's answer landed in B");
assert.ok(!sent.some(m => m.channel === 'A' && /^\s*4\s*$/.test(m.text)), "B's answer landed in A");
console.log('routing OK');
process.exit(0);
