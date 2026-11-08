import type { ImageContent } from '@earendil-works/pi-ai';
import { Command, container, Listener, Precondition, SapphireClient, Events as SapphireEvents, type ChatInputCommandDeniedPayload, type UserError } from '@sapphire/framework';
import { Events, GatewayIntentBits, MessageFlags, Partials, type Message, type PartialMessage } from 'discord.js';
import * as brain from './brain.ts';
import { config } from './config.ts';
import { describe, fetchImage } from './tools.ts';

declare module '@sapphire/framework' {
  interface Preconditions { OwnerOnly: never }
}

type Batch = { lines: string[]; images: ImageContent[]; ids: string[]; first: number; timer?: NodeJS.Timeout };
const buffers = new Map<string, Batch>();

// Ambient chatter is batched per channel (4s of quiet, 15s at most) so a burst is one model call. Mentions flush at once.
function queue(channelId: string, line: string, urgent = false, images: ImageContent[] = [], id?: string) {
  const b = buffers.get(channelId) ?? { lines: [], images: [], ids: [], first: Date.now() };
  buffers.set(channelId, b);
  clearTimeout(b.timer);
  b.lines.push(line);
  b.images.push(...images);
  if (id) b.ids.push(id);
  const flush = () => { buffers.delete(channelId); brain.deliver(b.lines.join('\n'), b.images, urgent, b.ids, channelId); };
  if (urgent) flush();
  else b.timer = setTimeout(flush, Math.min(4000, b.first + 15_000 - Date.now()));
}

const CONVERSATION_MS = 3 * 60_000;
const spokeAt = new Map<string, number>();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Why a message is probably meant for the bot, if it is: pinged/replied/DM, named, or right after the bot spoke there. */
function addressed(m: Message) {
  const me = m.client.user;
  if (!m.inGuild() || m.mentions.users.has(me.id) || m.mentions.repliedUser?.id === me.id) return 'mention';
  const names = [me.username, me.globalName, m.guild.members.me?.displayName, 'slopcord'].filter(n => !!n).map(n => escape(n!));
  if (new RegExp(`(^|[^\\p{L}\\p{N}])(${names.join('|')})($|[^\\p{L}\\p{N}])`, 'iu').test(m.content)) return 'name';
  if (Date.now() - (spokeAt.get(m.channelId) ?? 0) < CONVERSATION_MS) return 'conversation';
}

async function onMessage(m: Message) {
  if (m.author.id === m.client.user.id) { spokeAt.set(m.channelId, Date.now()); return; }
  const toYou = m.author.bot ? undefined : addressed(m);
  if (!toYou) return queue(m.channelId, describe(m));
  brain.addPending(m.channelId, m.id);
  // People don't ack every ping; 👀 only shows up when an actual ping is answered slowly.
  if (toYou === 'mention') setTimeout(() => { if (brain.isPending(m.id)) m.react('👀').catch(() => {}); }, 5000);
  const images = await Promise.all(m.attachments.filter(a => !!a.contentType?.startsWith('image/')).map(a => fetchImage(a.url).catch(() => undefined)));
  // Follow-ups in a conversation are batched like chatter, so someone typing three lines gets one answer.
  queue(m.channelId, describe(m, 'message', toYou), toYou !== 'conversation', images.filter(i => i !== undefined), m.id);
}

async function onEdit(old: Message | PartialMessage, m: Message | PartialMessage) {
  const full = m.partial ? await m.fetch() : m;
  // Embed unfurls also fire updates; only real text edits matter.
  if (full.author.id === full.client.user.id || old.content === full.content) return;
  queue(full.channelId, describe(full, 'edit'));
}

function onDelete(m: Message | PartialMessage) {
  if (m.author?.id === m.client.user.id) return;
  queue(m.channelId, JSON.stringify({ kind: 'delete', id: m.id, channelId: m.channelId, author: m.author?.id }));
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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel, Partials.Message],
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
  ['listeners', 'commandDenied', listener(SapphireEvents.ChatInputCommandDenied, (error: UserError, { interaction }: ChatInputCommandDeniedPayload) =>
    interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral }))],
  ['commands', 'status', command('status', 'Is the bot alive, and what is it doing?', false, brain.status)],
  ['commands', 'abort', command('abort', 'Stop the current run.', true, brain.abort)],
  ['commands', 'compact', command('compact', 'Summarize older context now.', true, brain.compact)],
] as const;
for (const [store, name, piece] of pieces) await container.stores.loadPiece({ store, name, piece: piece as never });
