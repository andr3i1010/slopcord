// Does the bot hear exactly what it gained or lost when its roles or a channel's overwrites change? No Discord, no model.
// Run: node test/permissions-check.ts
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P, type Guild } from 'discord.js';
import { changes, snapshot } from '../src/permissions.ts';

/** A server where the bot has `base`, and each channel either matches it (undefined) or has its own effective bits. */
const guild = (base: bigint, channels: Record<string, bigint | undefined>) => ({
  id: 'g', name: 'Streek',
  members: { me: { permissions: { bitfield: base } } },
  channels: { cache: new Map(Object.entries(channels).map(([id, own]) => [id, { id, name: id, isThread: () => false, permissionsFor: () => ({ bitfield: own ?? base }) }])) },
}) as unknown as Guild;
const diff = (before: Guild, after: Guild) => changes(after, snapshot(before)!, snapshot(after)!) as any[];

const view = P.ViewChannel, send = P.SendMessages, mod = P.ModerateMembers, base = view | send;

assert.deepEqual(diff(guild(base, { chat: undefined }), guild(base, { chat: undefined })), [], 'nothing changed, nothing said');

const granted = diff(guild(base, { chat: undefined }), guild(base | mod, { chat: undefined }));
assert.equal(granted.length, 1, 'a server-wide grant is one event, not one per channel');
assert.deepEqual([granted[0].where, granted[0].gained, granted[0].lost], ['Streek', ['ModerateMembers'], []]);

const muted = diff(guild(base, { chat: undefined, clanker: undefined }), guild(base, { chat: view, clanker: undefined }));
assert.equal(muted.length, 1, 'only the channel whose overwrite changed');
assert.deepEqual([muted[0].channelId, muted[0].where, muted[0].lost, muted[0].gained], ['chat', '#chat in Streek', ['SendMessages'], []]);

assert.deepEqual(diff(guild(base, { chat: undefined }), guild(base, { chat: undefined, fresh: view })), [], 'a new channel is not a change');

const blocked = diff(guild(view, { chat: view }), guild(base, { chat: view }));
assert.equal(blocked.length, 1, 'gaining Send server-wide while #chat still denies it says nothing about #chat');
assert.deepEqual(blocked[0].gained, ['SendMessages']);

console.log('permissions OK');
