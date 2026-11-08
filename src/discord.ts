import type { ImageContent } from '@earendil-works/pi-ai';
import { Command, container, Listener, Precondition, SapphireClient, Events as SapphireEvents, type ChatInputCommandDeniedPayload, type UserError } from '@sapphire/framework';
import { Events, GatewayIntentBits, MessageFlags, Partials, type Message, type MessageReaction, type PartialMessage, type PartialMessageReaction, type PartialUser, type User } from 'discord.js';
import * as brain from './brain.ts';
import { config } from './config.ts';
import { loadMedia, media } from './media.ts';
import { describe, where } from './tools.ts';

declare module '@sapphire/framework' {
  interface Preconditions { OwnerOnly: never }
}

type Batch = { lines: (string | (() => string))[]; images: ImageContent[]; pending: string[]; last: string; first: number; timer?: NodeJS.Timeout };
const buffers = new Map<string, Batch>();

// Chatter is batched per channel (4s of quiet, 15s at most) so a burst is one model call. Pings flush at once.
function queue(m: { id: string; channelId: string }, line: string | (() => string), opts: { urgent?: boolean; images?: ImageContent[]; pending?: boolean } = {}) {
  const b = buffers.get(m.channelId) ?? { lines: [], images: [], pending: [], last: m.id, first: Date.now() };
  buffers.set(m.channelId, b);
  clearTimeout(b.timer);
  b.lines.push(line);
  b.images.push(...opts.images ?? []);
  if (opts.pending) b.pending.push(m.id);
  b.last = m.id;
  const flush = () => { buffers.delete(m.channelId); brain.deliver(b.lines.map(l => typeof l === 'string' ? l : l()).join('\n'), b.images, !!opts.urgent, b.pending, { channelId: m.channelId, messageId: b.last }); };
  if (opts.urgent) flush();
  else b.timer = setTimeout(flush, Math.min(4000, b.first + 15_000 - Date.now()));
}

async function onMessage(m: Message, kind = 'message') {
  const me = m.client.user.id;
  if (m.author.id === me) return;
  // Every message reaches the model, which decides whether to answer. Pings only get liveness and priority.
  const ping = !m.author.bot && (!m.inGuild() || m.mentions.users.has(me) || m.mentions.repliedUser?.id === me);
  // Described at flush time: Discord adds link embeds (GIFs) a moment after the message, as an update.
  if (!ping) return queue(m, () => describe(m, kind));
  brain.addPending(m.channelId, m.id);
  // People don't ack every ping; 👀 only shows up when the answer is slow.
  setTimeout(() => { if (brain.isPending(m.id)) m.react('👀').catch(() => {}); }, 5000);
  if (/https?:\/\//.test(m.content) && !m.embeds.length) await new Promise(r => setTimeout(r, 1500));
  // Media sent to the bot is seen right away (emojis aside, they're cheap to open on demand).
  const seen = await Promise.all(media(m).filter(x => x.kind !== 'emoji').map(x => loadMedia(x.url).catch(() => undefined)));
  queue(m, describe(m, kind, true), { urgent: true, images: seen.flatMap(s => s?.images ?? []).slice(0, 8), pending: true });
}

async function onEdit(old: Message | PartialMessage, m: Message | PartialMessage) {
  const full = m.partial ? await m.fetch() : m;
  // Pins, embed unfurls and old uncached messages also fire updates; only fresh text edits matter.
  const fresh = Date.now() - (full.editedTimestamp ?? 0) < 60_000;
  if (!fresh || old.content === full.content) return;
  await onMessage(full, 'edit');
}

async function onReaction(reaction: MessageReaction | PartialMessageReaction, reactor: User | PartialUser) {
  if (reactor.id === reaction.client.user.id) return;
  const m = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  const user = reactor.partial ? await reactor.fetch() : reactor;
  queue(m, JSON.stringify({
    kind: 'reaction', emoji: reaction.emoji.toString(), messageId: m.id, channelId: m.channelId, where: where(m), time: new Date().toISOString(),
    by: { id: user.id, name: user.displayName, authorized: config.authorized.has(user.id), bot: user.bot || undefined },
    on: { author: m.author.id, yours: m.author.id === m.client.user.id || undefined, text: m.content.slice(0, 200) },
  }));
}

function onDelete(m: Message | PartialMessage) {
  if (m.author?.id === m.client.user.id) return;
  queue(m, JSON.stringify({ kind: 'delete', id: m.id, channelId: m.channelId, author: m.author?.id }));
}

function listener(event: string, run: (...args: any[]) => unknown) {
  return class extends Listener {
    constructor(context: Listener.LoaderContext, options: Listener.Options) { super(context, { ...options, event }); }
    override async run(...args: unknown[]) {
      try { await run(...args); } catch (error) { await brain.report(error); }
    }
  };
}

function command(name: string, description: string, ownerOnly: boolean, run: () => string | Promise<string>) {
  return class extends Command {
    constructor(context: Command.LoaderContext, options: Command.Options) {
      super(context, { ...options, name, description, preconditions: ownerOnly ? ['OwnerOnly'] : [] });
    }
    override registerApplicationCommands(registry: Command.Registry) {
      registry.registerChatInputCommand(b => b.setName(name).setDescription(description));
    }
    override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply(await run());
    }
  };
}

class OwnerOnly extends Precondition {
  override chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    return config.authorized.has(interaction.user.id) ? this.ok() : this.error({ message: 'Only the owner can do that.' });
  }
}

export const client = new SapphireClient({
  baseUserDirectory: null,
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
  loadMessageCommandListeners: false,
  // Pi swaps in a newer Undici globally; discord.js's bundled one then rejects multipart uploads ("FormData from other sources").
  rest: { makeRequest: fetch as never },
});

// Node runs our .ts files natively, which Sapphire's directory scan doesn't detect, so pieces are registered by hand.
const pieces = [
  ['preconditions', 'OwnerOnly', OwnerOnly],
  ['listeners', 'ready', listener(Events.ClientReady, async () => { await brain.start(); console.info(`Online as ${client.user!.tag}`); })],
  ['listeners', 'messageCreate', listener(Events.MessageCreate, onMessage)],
  ['listeners', 'messageUpdate', listener(Events.MessageUpdate, onEdit)],
  ['listeners', 'messageDelete', listener(Events.MessageDelete, onDelete)],
  ['listeners', 'reactionAdd', listener(Events.MessageReactionAdd, onReaction)],
  ['listeners', 'commandDenied', listener(SapphireEvents.ChatInputCommandDenied, (error: UserError, { interaction }: ChatInputCommandDeniedPayload) =>
    interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral }))],
  ['commands', 'status', command('status', 'Is the bot alive, and what is it doing?', false, brain.status)],
  ['commands', 'abort', command('abort', 'Stop the current run.', true, brain.abort)],
  ['commands', 'compact', command('compact', 'Summarize older context now.', true, brain.compact)],
] as const;
for (const [store, name, piece] of pieces) await container.stores.loadPiece({ store, name, piece: piece as never });
