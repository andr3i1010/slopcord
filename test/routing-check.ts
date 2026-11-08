// The real brain and model against a fake Discord, in a temp data dir: answers must land in the channel they belong to.
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

// Two pings right after each other in one channel (the doodles + kingissuper case): one reply each.
brain.addPending('C', 'c1');
brain.deliver(event('C', 'c1', '<@999> what is 3+3? just the number', true), [], true, ['c1'], { channelId: 'C', messageId: 'c1' });
await new Promise(r => setTimeout(r, 200));
brain.addPending('C', 'c2');
brain.deliver(event('C', 'c2', '<@999> capital of France? one word', true), [], true, ['c2'], { channelId: 'C', messageId: 'c2' });

// A busy chat: a question to the bot by name, then unrelated chatter. The answer should reply to the question.
const say = (id: string, name: string, text: string, replyTo?: string) =>
  JSON.stringify({ kind: 'message', id, channelId: 'D', where: '#D in Test', author: { id: name, name, authorized: false }, replyTo, text });
brain.deliver([say('d1', 'sam', 'TestBot is het waar dat water op 100 graden kookt?'), say('d2', 'kim', 'lol', 'd1'), say('d3', 'lee', 'wie wil er later minecraft spelen')].join('\n'),
  [], false, [], { channelId: 'D', messageId: 'd3' });

for (let s = 0; s < 180 && !(sent.some(m => m.channel === 'D') && sent.some(m => m.replyTo === 'c2') && brain.status().includes('\nidle')); s++) await new Promise(r => setTimeout(r, 1000));
console.log(sent);
assert.ok(sent.some(m => m.channel === 'B' && m.text.includes('4') && m.replyTo === 'b1'), 'the ping in B was not answered in B as a reply to it');
assert.ok(!sent.some(m => m.channel === 'A' && m.replyTo), 'a chatter answer was sent as a reply');
assert.ok(!sent.some(m => m.channel === 'B' && /inkscape|export|svg/i.test(m.text)), "A's answer landed in B");
assert.ok(!sent.some(m => m.channel === 'A' && /^\s*4\s*$/.test(m.text)), "B's answer landed in A");
assert.ok(sent.some(m => m.replyTo === 'c1' && m.text.includes('6') && !/paris/i.test(m.text)), 'first ping did not get its own reply');
assert.ok(sent.some(m => m.replyTo === 'c2' && /paris/i.test(m.text) && !m.text.includes('6')), 'second ping did not get its own reply');
assert.ok(sent.some(m => m.channel === 'D' && m.replyTo === 'd1'), "busy chat: the answer to sam didn't reply to sam's message");
console.log('routing OK');
process.exit(0);
