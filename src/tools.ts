import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { container } from '@sapphire/framework';
import type { Message } from 'discord.js';
import { Type } from 'typebox';
import { config, leaksSecret, redact } from './config.ts';
import { loadMedia, media } from './media.ts';

export const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }], details: undefined });

export async function channel(id: string) {
  const c = await container.client.channels.fetch(id);
  if (!c?.isSendable()) throw new Error(`Channel ${id} is not a text channel I can use.`);
  return c;
}

export const fetchMessage = async (channelId: string, messageId: string) => (await channel(channelId)).messages.fetch(messageId);

export const where = (m: Message) => m.inGuild() ? `#${m.channel.name} in ${m.guild.name}` : 'DM';

/** One Discord message as an event line. JSON keeps typed text from passing as harness fields. */
export function describe(m: Message, kind = 'message', toYou?: boolean) {
  return JSON.stringify({
    kind, id: m.id, channelId: m.channelId, toYou,
    where: where(m),
    time: m.createdAt.toISOString(),
    author: { id: m.author.id, name: m.member?.displayName ?? m.author.displayName, authorized: config.authorized.has(m.author.id), bot: m.author.bot || undefined },
    replyTo: m.reference?.messageId,
    text: m.content,
    mentions: m.mentions.users.size ? Object.fromEntries(m.mentions.users.map(u => [u.id, u.displayName])) : undefined,
    media: media(m).length ? media(m) : undefined,
    edited: m.editedAt?.toISOString(),
  });
}


// shortcut: cuts at the last newline before 2000 chars, can split a code block; smarter splitting if that bites.
type FileSpec = { name: string; path?: string; url?: string; text?: string };

/** Upload bytes, checked so no file (or .gz/.tgz of the repo) carries the bot's own secrets out. */
async function fileBytes(f: FileSpec) {
  if (f.text !== undefined) return Buffer.from(redact(f.text));
  const bytes = f.path ? await readFile(resolve(config.dataDir, f.path)) : Buffer.from(await (await fetch(f.url ?? '')).arrayBuffer());
  let plain = bytes;
  try { plain = gunzipSync(bytes); } catch {}
  // shortcut: zip/xz/7z archives aren't unpacked for this check; add them if the bot starts making those.
  if (leaksSecret(bytes) || leaksSecret(plain)) throw new Error("That file contains the bot's own secrets; refusing to upload it.");
  return bytes;
}

function split(t: string) {
  const out: string[] = [];
  while (t.length > 2000) {
    const cut = t.lastIndexOf('\n', 2000) > 1000 ? t.lastIndexOf('\n', 2000) : 2000;
    out.push(t.slice(0, cut));
    t = t.slice(cut);
  }
  return [...out, t];
}

/** Discord messages for a text. Output is uncapped, so a wall of text goes out as an excerpt plus the full text as a file. */
export function outgoing(t: string): { content: string; files?: { attachment: Buffer; name: string }[] }[] {
  if (t.length <= 8000) return split(t).map(content => ({ content }));
  return [{ content: `${t.slice(0, 1500).trimEnd()}…\n-# full text attached`, files: [{ attachment: Buffer.from(t), name: 'reply.md' }] }];
}

const ids = { channelId: Type.String(), messageId: Type.String() };

const read: ToolDefinition[] = [
  defineTool({
    name: 'history', label: 'History', description: 'Read recent messages in a channel or DM, newest last. Page back with `before`.',
    parameters: Type.Object({ channelId: Type.String(), before: Type.Optional(Type.String({ description: 'message ID' })), limit: Type.Optional(Type.Number({ description: '1-100, default 30' })) }),
    async execute(_id, p) {
      const messages = await (await channel(p.channelId)).messages.fetch({ limit: Math.min(Math.max(p.limit ?? 30, 1), 100), before: p.before });
      return text([...messages.values()].reverse().map(m => describe(m)).join('\n') || 'no messages');
    },
  }),
  defineTool({
    name: 'view_media', label: 'View media',
    description: 'Look at an image, GIF, video, sticker, custom emoji, avatar, or a media link (Tenor, Klipy, Giphy, YouTube pages work too). GIFs and videos come back as a few frames spread over their length; there is no audio.',
    parameters: Type.Object({ url: Type.String() }),
    async execute(_id, p) {
      const { images, note } = await loadMedia(p.url);
      return { content: [{ type: 'text', text: note }, ...images], details: undefined };
    },
  }),
  defineTool({
    name: 'profile', label: 'Profile', description: "A user's profile; with guildId also their nickname, roles and join date there.",
    parameters: Type.Object({ userId: Type.String(), guildId: Type.Optional(Type.String()) }),
    async execute(_id, p) {
      const user = await container.client.users.fetch(p.userId, { force: true });
      const member = p.guildId ? await (await container.client.guilds.fetch(p.guildId)).members.fetch(p.userId).catch(() => undefined) : undefined;
      return text(JSON.stringify({
        id: user.id, username: user.username, displayName: user.displayName, bot: user.bot, created: user.createdAt.toISOString(),
        avatar: user.displayAvatarURL({ size: 512 }), banner: user.bannerURL({ size: 1024 }),
        nickname: member?.nickname, joined: member?.joinedAt?.toISOString(),
        roles: member?.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.name),
      }));
    },
  }),
];

const write: ToolDefinition[] = [
  defineTool({
    name: 'send', label: 'Send', description: 'Post a message in a channel or DM. This is the only way to talk; not calling it means staying silent. Long text is split automatically.',
    parameters: Type.Object({
      channelId: Type.String(), text: Type.String(),
      replyTo: Type.Optional(Type.String({ description: 'message ID to reply to' })),
      files: Type.Optional(Type.Array(Type.Object({
        name: Type.String(),
        path: Type.Optional(Type.String({ description: 'file on the server, relative to your workspace' })),
        url: Type.Optional(Type.String()),
        text: Type.Optional(Type.String({ description: 'file contents to send as-is' })),
      }))),
    }),
    async execute(_id, p) {
      const c = await channel(p.channelId);
      const files = await Promise.all((p.files ?? []).map(async f => ({ name: f.name, attachment: await fileBytes(f) })));
      const messages = outgoing(redact(p.text));
      const sent: string[] = [];
      for (const [i, msg] of messages.entries()) {
        const last = i === messages.length - 1;
        const m = await c.send({ content: msg.content, files: [...msg.files ?? [], ...last ? files : []], reply: i === 0 && p.replyTo ? { messageReference: p.replyTo, failIfNotExists: false } : undefined });
        sent.push(m.id);
      }
      return text(`sent ${sent.join(', ')}`);
    },
  }),
  defineTool({
    name: 'edit', label: 'Edit', description: 'Replace the text of one of your own messages.',
    parameters: Type.Object({ ...ids, text: Type.String() }),
    async execute(_id, p) { await (await fetchMessage(p.channelId, p.messageId)).edit(redact(p.text)); return text('edited'); },
  }),
  defineTool({
    name: 'delete_message', label: 'Delete', description: 'Delete a message (your own, or others where you have permission).',
    parameters: Type.Object(ids),
    async execute(_id, p) { await (await fetchMessage(p.channelId, p.messageId)).delete(); return text('deleted'); },
  }),
  defineTool({
    name: 'react', label: 'React', description: 'React to a message with an emoji (unicode, or name:id for custom ones). Often nicer than a whole reply.',
    parameters: Type.Object({ ...ids, emoji: Type.String() }),
    async execute(_id, p) { await (await fetchMessage(p.channelId, p.messageId)).react(p.emoji); return text('reacted'); },
  }),
];

function discordApi(readOnly: boolean) {
  return defineTool({
    name: 'discord_api', label: 'Discord API',
    description: `Call any Discord REST v10 endpoint as the bot; authentication is added for you.${readOnly ? ' Read-only: GET only.' : ''} Example: GET /guilds/{id}/channels.`,
    parameters: Type.Object({
      method: readOnly ? Type.Literal('GET') : Type.Union(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => Type.Literal(m))),
      path: Type.String({ description: 'e.g. /channels/123/messages' }),
      body: Type.Optional(Type.Any()),
      query: Type.Optional(Type.Record(Type.String(), Type.String())),
    }),
    async execute(_id, p) {
      if (readOnly && p.method !== 'GET') throw new Error('Workers can only GET.');
      const result = await container.client.rest.request({
        method: p.method as never, fullRoute: p.path as never, body: p.body,
        query: p.query ? new URLSearchParams(p.query) : undefined,
      });
      return text(JSON.stringify(result ?? 'ok').slice(0, 30_000));
    },
  });
}

export const discordTools = (readOnly: boolean) => [...read, ...(readOnly ? [] : write), discordApi(readOnly)];
