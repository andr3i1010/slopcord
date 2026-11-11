import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AgentSession, SessionEntry, SessionMessageEntry } from '@earendil-works/pi-coding-agent';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { container } from '@sapphire/framework';
import { ChannelType, Events as DiscordEvents, MessageType, PermissionFlagsBits as Can, type DMChannel, type Message as DiscordMessage, type PartialMessage } from 'discord.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import { validator } from 'hono/validator';
import * as brain from './brain.ts';
import { bus, type Reported } from './bus.ts';
import { config, redact, root } from './config.ts';
import { noteFiles, notesDir } from './memory.ts';
import { channel, fetchMessage, outgoing } from './tools.ts';
import { messageWorker, stopWorker } from './workers.ts';

// Orchard's service for slopcord-git points at this port.
const PORT = 8080;
const MAX_PAGE = 500;
// shortcut: no login of its own; Orchard's protection guards the domain, but the bot's own shell (curl localhost) and
// pods in the same namespace (chromium) reach it directly. Fine while that shell runs as root and can rewrite the bot anyway;
// add a login here once it doesn't.

type Message = SessionMessageEntry['message'];
type Live = { message?: Message; tool?: { name: string; args: unknown; output: unknown } };
/** Everything /api/events sends, by SSE event name. */
export type Events = {
  hello: ReturnType<typeof hello>;
  status: ReturnType<typeof brain.state>;
  entry: { tab: string; index: number; entry: SessionEntry };
  /** The message or tool output being written right now; neither means it just finished. */
  partial: { tab: string } & Live;
  reported: Reported;
  session: { tab: string; count: number };
  'session-end': { tab: string };
  /** Something changed in a Discord channel the bot can see. */
  discord: { kind: 'message'; message: Wire } | { kind: 'delete'; channelId: string; id: string };
};

/** JSON for the browser: base64 images become a size note, and the bot's secrets are redacted. */
const scrub = (value: unknown) => redact(JSON.stringify(value, function (this: any, key, v) {
  return key === 'data' && this?.type === 'image' && typeof v === 'string' ? `[image · ${Math.round(v.length * 0.75 / 1024)} KB]` : v;
}));
const clean = <T>(value: T): T => JSON.parse(scrub(value));

const watching = new Map<string, { session: AgentSession; stop: () => void }>();
const clients = new Set<(event: string, data: string) => void>();
function broadcast<K extends keyof Events>(event: K, value: Events[K]) {
  if (!clients.size) return;
  const data = scrub(value);
  for (const send of clients) send(event, data);
}

const hello = () => ({
  status: brain.state(),
  errors: brain.errors,
  /** Entry count per tab; the client pages history below it and gets newer entries as `entry` events. */
  sessions: Object.fromEntries([...watching].map(([tab, w]) => [tab, w.session.sessionManager.getEntryCount()])),
});

/** Stream a session's new entries and, at most every 100 ms, what it's writing right now. */
function watch(tab: string, session: AgentSession) {
  const entries = session.sessionManager;
  let sent = entries.getEntryCount(), live: Live | undefined, timer: NodeJS.Timeout | undefined;
  const flushEntries = () => {
    if (entries.getEntryCount() === sent) return;
    const all = entries.getEntries();
    for (; sent < all.length; sent++) broadcast('entry', { tab, index: sent, entry: all[sent] });
  };
  const flushLive = () => { timer = undefined; broadcast('partial', { tab, ...live }); };
  const stop = session.subscribe(e => {
    try {
      if (e.type === 'message_update') live = { message: e.message };
      else if (e.type === 'tool_execution_update') live = { tool: { name: e.toolName, args: e.args, output: e.partialResult } };
      else {
        if (e.type === 'message_end' || e.type === 'tool_execution_end') {
          clearTimeout(timer);
          timer = live = undefined;
          broadcast('partial', { tab });
        }
        // Pi saves a message right after its message_end listeners run.
        return void setImmediate(flushEntries);
      }
      timer ??= setTimeout(flushLive, 100);
    } catch (error) { console.error('dashboard:', error); }
  });
  watching.set(tab, { session, stop });
  broadcast('session', { tab, count: sent });
}

function unwatch(tab: string) {
  watching.get(tab)?.stop();
  watching.delete(tab);
  broadcast('session-end', { tab });
}

const sessionOf = (tab: string) => {
  const session = watching.get(tab)?.session;
  if (!session) throw new HTTPException(404, { message: `no session ${tab}` });
  return session;
};

/** A JSON body check: `check` returns the parsed fields, or nothing for a 400. */
const body = <T>(check: (b: any) => T | undefined) =>
  validator('json', (b, c) => check(b ?? {}) ?? c.json({ error: 'bad request body' }, 400));
const tabBody = body(b => typeof b.tab === 'string' ? { tab: b.tab as string } : undefined);

/** One Discord message as the Discord tab draws it, with the names its mentions need. */
function wire(m: DiscordMessage) {
  const name = (u: { id: string; displayName: string }) => m.guild?.members.cache.get(u.id)?.displayName ?? u.displayName;
  const hex = (color: string | undefined) => color && color !== '#000000' ? color : undefined;
  const ref = m.type === MessageType.Reply && m.reference?.messageId ? m.channel.messages.cache.get(m.reference.messageId) : undefined;
  return {
    id: m.id, channelId: m.channelId, time: m.createdTimestamp, edited: m.editedTimestamp ?? undefined, system: m.system, type: m.type,
    author: { id: m.author.id, name: name(m.author), avatar: (m.member ?? m.author).displayAvatarURL({ size: 64 }), bot: m.author.bot, color: hex(m.member?.displayHexColor) },
    content: m.content,
    mentions: {
      users: Object.fromEntries(m.mentions.users.map(u => [u.id, name(u)])),
      roles: Object.fromEntries(m.mentions.roles.map(r => [r.id, { name: r.name, color: hex(r.hexColor) }])),
      channels: Object.fromEntries(m.mentions.channels.map(c => [c.id, 'name' in c && c.name ? c.name : c.id])),
    },
    reply: m.type === MessageType.Reply && m.reference?.messageId
      ? { id: m.reference.messageId, author: ref && name(ref.author), avatar: ref?.author.displayAvatarURL({ size: 32 }), content: ref?.content.slice(0, 200) }
      : undefined,
    attachments: m.attachments.map(a => ({ url: a.url, name: a.name, type: a.contentType ?? undefined, width: a.width ?? undefined, height: a.height ?? undefined, size: a.size })),
    embeds: m.embeds.map(e => ({
      type: e.data.type, title: e.title ?? undefined, description: e.description ?? undefined, url: e.url ?? undefined, color: e.hexColor ?? undefined,
      author: e.author?.name, provider: e.provider?.name, footer: e.footer?.text, fields: e.fields,
      image: e.image?.proxyURL ?? e.image?.url, thumbnail: e.thumbnail?.proxyURL ?? e.thumbnail?.url, video: e.video?.proxyURL ?? e.video?.url,
    })),
    stickers: m.stickers.map(s => ({ name: s.name, url: s.url })),
    reactions: m.reactions.cache.map(r => ({ id: r.emoji.id ?? undefined, name: r.emoji.name ?? '', animated: !!r.emoji.animated, count: r.count ?? 0, me: r.me })),
  };
}
export type Wire = ReturnType<typeof wire>;

/** The bot's servers (text channels it can read, with what it may do there) and the DMs it has open since it started. */
function overview() {
  const client = container.client, me = client.user!;
  const textTypes: ChannelType[] = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
  return {
    me: { id: me.id, name: me.displayName, avatar: me.displayAvatarURL({ size: 64 }) },
    guilds: client.guilds.cache.map(g => ({
      id: g.id, name: g.name, icon: g.iconURL({ size: 128 }) ?? undefined,
      emojis: g.emojis.cache.map(e => ({ id: e.id, name: e.name ?? '', animated: !!e.animated })),
      channels: g.channels.cache.filter(c => c.type === ChannelType.GuildCategory || textTypes.includes(c.type)).map(c => {
        const p = g.members.me ? c.permissionsFor(g.members.me) : null, has = (flag: bigint) => !!p?.has(flag);
        return {
          id: c.id, name: c.name, category: c.type === ChannelType.GuildCategory, parentId: c.parentId ?? undefined,
          position: 'rawPosition' in c ? c.rawPosition : 0, topic: 'topic' in c ? c.topic ?? undefined : undefined,
          can: { view: has(Can.ViewChannel) && has(Can.ReadMessageHistory), send: has(Can.SendMessages), attach: has(Can.AttachFiles), react: has(Can.AddReactions), manage: has(Can.ManageMessages) },
        };
      }).filter(c => c.category || c.can.view),
    })),
    dms: client.channels.cache.filter((c): c is DMChannel => c.type === ChannelType.DM).map(c => ({
      id: c.id, name: c.recipient?.displayName ?? 'Unknown', avatar: c.recipient?.displayAvatarURL({ size: 64 }), last: c.lastMessageId ?? undefined,
    })),
  };
}

const messageIn = (c: { req: { param(key: 'id' | 'mid'): string } }) => fetchMessage(c.req.param('id'), c.req.param('mid'));

async function restart() {
  // Kubernetes starts the pod again, which is also the way back after brain.ts shut the bot down.
  await container.client.destroy().catch(() => {});
  process.exit(0);
}

const api = new Hono().basePath('/api')
  // Same-origin only; JSON bodies already need a CORS preflight that nothing here answers.
  .use(csrf())
  .get('/events', c => streamSSE(c, async stream => {
    let queue = Promise.resolve();
    const send = (event: string, data: string) => { queue = queue.then(() => stream.writeSSE({ event, data })); };
    send('hello', scrub(hello()));
    clients.add(send);
    // Proxies close streams that stay quiet.
    const ping = setInterval(() => send('ping', ''), 20_000);
    await new Promise<void>(done => stream.onAbort(done));
    clearInterval(ping);
    clients.delete(send);
  }))
  .get('/sessions/:tab/entries', validator('query', (q, c) => {
    const from = Number(q.from), to = Number(q.to);
    return Number.isInteger(from) && Number.isInteger(to) && from >= 0 ? { from, to: Math.min(to, from + MAX_PAGE) } : c.json({ error: 'from and to are entry indices' }, 400);
  }), c => {
    const { from, to } = c.req.valid('query'), all = sessionOf(c.req.param('tab')).sessionManager.getEntries();
    // unknown[]: Hono's JSON typing of Pi's entry union is too deep for tsc; the client reads them as Events['entry'].
    const entries: unknown[] = clean(all.slice(from, to).map((entry, i) => ({ index: from + i, entry })));
    return c.json({ count: all.length, entries });
  })
  .get('/notes', c => c.json(noteFiles()))
  .get('/note', validator('query', (q, c) =>
    // Only files the listing shows, so no path can step out of notes/.
    typeof q.path === 'string' && noteFiles().includes(q.path) ? { path: q.path } : c.json({ error: 'no such note' }, 404)), c =>
    c.json({ text: redact(readFileSync(join(notesDir, c.req.valid('query').path), 'utf8')) }))
  .post('/interject', body(b => typeof b.tab === 'string' && typeof b.text === 'string' && b.text.trim() ? { tab: b.tab as string, text: b.text as string } : undefined), async c => {
    const { tab, text } = c.req.valid('json');
    if (tab === 'brain') brain.interject(text);
    else await messageWorker(tab, `[your owner, from the dashboard] ${text}`);
    return c.json({ result: 'sent' });
  })
  .post('/abort', tabBody, async c => {
    const { tab } = c.req.valid('json');
    return c.json({ result: tab === 'brain' ? await brain.abort() : (await stopWorker(tab), 'stopping') });
  })
  .post('/compact', async c => c.json({ result: await brain.compact() }))
  .post('/restart', c => { setTimeout(restart, 100); return c.json({ result: 'restarting' }); })
  .delete('/wakes/:at', c => { brain.deleteWake(Number(c.req.param('at'))); return c.json({ result: 'deleted' }); })
  .delete('/pending/:id', c => { brain.dropPending(c.req.param('id')); return c.json({ result: 'dropped' }); })
  // The Discord tab: the bot's own Discord, driven by the owner.
  .get('/discord', c => c.json(clean(overview())))
  .get('/discord/channels/:id/messages', validator('query', q => ({ before: typeof q.before === 'string' && q.before ? q.before : undefined })), async c => {
    const messages = await (await channel(c.req.param('id'))).messages.fetch({ limit: 50, before: c.req.valid('query').before });
    return c.json(clean([...messages.values()].reverse().map(wire)));
  })
  .post('/discord/channels/:id/messages', bodyLimit({ maxSize: 25 << 20 }), validator('form', (f, c) => {
    const files = [f.files ?? []].flat().filter((x): x is File => x instanceof File), text = typeof f.text === 'string' ? f.text : '';
    const replyTo = typeof f.replyTo === 'string' && f.replyTo ? f.replyTo : undefined;
    return text.trim() || files.length ? { text, files, replyTo } : c.json({ error: 'nothing to send' }, 400);
  }), async c => {
    const { text, files, replyTo } = c.req.valid('form'), id = c.req.param('id'), target = await channel(id);
    const attachments = await Promise.all(files.map(async f => ({ name: f.name, attachment: Buffer.from(await f.arrayBuffer()) })));
    const parts = text.trim() ? outgoing(redact(text)) : [{ content: '', files: undefined }];
    const ids: string[] = [];
    for (const [i, part] of parts.entries()) {
      const last = i === parts.length - 1;
      const m = await target.send({
        content: part.content || undefined, files: [...part.files ?? [], ...last ? attachments : []],
        reply: i === 0 && replyTo ? { messageReference: replyTo, failIfNotExists: false } : undefined,
      });
      ids.push(m.id);
    }
    brain.postedAsYou(id, ids, text, files.map(f => f.name));
    return c.json({ result: 'sent' });
  })
  .patch('/discord/channels/:id/messages/:mid', body(b => typeof b.text === 'string' && b.text.trim() ? { text: b.text as string } : undefined), async c => {
    await (await messageIn(c)).edit(redact(c.req.valid('json').text));
    return c.json({ result: 'edited' });
  })
  .delete('/discord/channels/:id/messages/:mid', async c => { await (await messageIn(c)).delete(); return c.json({ result: 'deleted' }); })
  .post('/discord/channels/:id/messages/:mid/reactions', body(b => typeof b.emoji === 'string' && b.emoji ? { emoji: b.emoji as string, on: b.on !== false } : undefined), async c => {
    const { emoji, on } = c.req.valid('json'), m = await messageIn(c);
    // Custom emoji come as name:id, and Discord keys their reactions by the id.
    if (on) await m.react(emoji);
    else await m.reactions.resolve(emoji.split(':').at(-1)!)?.users.remove(container.client.user!.id);
    return c.json({ result: on ? 'reacted' : 'removed' });
  });

export type AppType = typeof api;

const dist = resolve(root, 'web/dist');
const app = new Hono()
  .route('/', api)
  .all('/api/*', c => c.json({ error: 'not found' }, 404))
  // Vite hashes asset names, so those never change; the page itself must be re-checked or browsers keep an old build.
  .use('*', async (c, next) => { await next(); c.header('Cache-Control', c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'); })
  .use('*', serveStatic({ root: dist }))
  .get('*', serveStatic({ path: resolve(dist, 'index.html') }))
  .onError((err, c) => err instanceof HTTPException ? err.getResponse() : c.json({ error: redact(err.message) }, 500));

/** Listen before Discord logs in, so the dashboard (and its restart button) works even when the bot doesn't. */
export function start() {
  bus.on('session', watch);
  bus.on('session-end', unwatch);
  bus.on('reported', r => broadcast('reported', r));
  const client = container.client;
  const push = (m: DiscordMessage | PartialMessage) => {
    if (clients.size) void (m.partial ? m.fetch() : Promise.resolve(m)).then(full => broadcast('discord', { kind: 'message', message: wire(full) })).catch(() => {});
  };
  client.on(DiscordEvents.MessageCreate, push);
  client.on(DiscordEvents.MessageUpdate, (_old, m) => push(m));
  client.on(DiscordEvents.MessageDelete, m => broadcast('discord', { kind: 'delete', channelId: m.channelId, id: m.id }));
  client.on(DiscordEvents.MessageReactionAdd, r => push(r.message));
  client.on(DiscordEvents.MessageReactionRemove, r => push(r.message));
  client.on(DiscordEvents.MessageReactionRemoveAll, m => push(m));
  client.on(DiscordEvents.MessageReactionRemoveEmoji, r => push(r.message));
  let last = '';
  setInterval(() => {
    if (!clients.size) return;
    const s = scrub(brain.state());
    if (s === last) return;
    last = s;
    for (const send of clients) send('status', s);
  }, 1000);
  serve({ fetch: app.fetch, port: PORT, hostname: config.dashboardHost }, () => console.info(`Dashboard on http://${config.dashboardHost}:${PORT}`))
    // A dashboard that can't listen must not take the bot down with it.
    .on('error', error => console.error('dashboard:', error));
}
