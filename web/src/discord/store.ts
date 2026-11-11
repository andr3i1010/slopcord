import type { InferResponseType } from 'hono/client';
import { create } from 'zustand';
import type { Events, Wire } from '../../../src/server.ts';
import { act, api, toast } from '../store.ts';

export type Overview = InferResponseType<typeof api.discord.$get>;
export type Guild = Overview['guilds'][number];
export type Channel = Guild['channels'][number];
export type { Wire };

/** Messages of one channel, oldest first. `first` only goes down, so the list knows when older ones were put on top. */
type Loaded = { messages: Wire[]; first: number; done?: boolean; loading?: boolean };

export const useDiscord = create<{
  overview?: Overview;
  /** '@me' for DMs. */
  guild?: string;
  channel?: string;
  channels: Record<string, Loaded>;
  unread: Record<string, true>;
  replyTo?: Wire;
  editing?: string;
}>(() => ({ channels: {}, unread: {} }));
const set = useDiscord.setState, get = useDiscord.getState;

const PAGE = 50;
const newer = (a: string, b: string) => BigInt(a) > BigInt(b);

export async function loadOverview() {
  try {
    const res = await api.discord.$get();
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
    const overview = await res.json();
    set(s => ({ overview, guild: s.guild ?? overview.guilds[0]?.id ?? '@me' }));
    if (!get().channel) {
      const first = overview.guilds[0]?.channels.filter(c => !c.category).sort((a, b) => a.position - b.position)[0];
      if (first) open(first.id);
    }
  } catch (e) { toast(e); }
}

export function pickGuild(guild: string) {
  set({ guild });
  const { overview } = get();
  const channels = guild === '@me' ? overview?.dms : overview?.guilds.find(g => g.id === guild)?.channels.filter(c => !c.category).sort((a, b) => a.position - b.position);
  if (channels?.[0]) open(channels[0].id);
}

export function open(channel: string) {
  set(s => ({ channel, replyTo: undefined, editing: undefined, unread: Object.fromEntries(Object.entries(s.unread).filter(([k]) => k !== channel)) }));
  if (!get().channels[channel]) void loadOlder(channel);
}

function patch(channel: string, change: (l: Loaded) => Partial<Loaded>) {
  set(s => {
    const l = s.channels[channel] ?? { messages: [], first: 1e9 };
    return { channels: { ...s.channels, [channel]: { ...l, ...change(l) } } };
  });
}

export async function loadOlder(channel: string) {
  const l = get().channels[channel];
  if (l?.loading || l?.done) return;
  patch(channel, () => ({ loading: true }));
  try {
    const res = await api.discord.channels[':id'].messages.$get({ param: { id: channel }, query: { before: l?.messages[0]?.id ?? '' } });
    const page = await res.json();
    if ('error' in page) throw new Error(String(page.error));
    patch(channel, l => ({ messages: [...page, ...l.messages], first: l.first - page.length, done: page.length < PAGE }));
  } catch (e) { toast(e); } finally { patch(channel, () => ({ loading: false })); }
}

/** Live Discord events from the dashboard's event stream. */
export function onDiscord(e: Events['discord']) {
  if (e.kind === 'delete') return patch(e.channelId, l => ({ messages: l.messages.filter(m => m.id !== e.id) }));
  const m = e.message, { channels, channel, overview } = get(), loaded = channels[m.channelId];
  const known = loaded?.messages.some(x => x.id === m.id);
  if (loaded) patch(m.channelId, l => ({
    messages: known ? l.messages.map(x => x.id === m.id ? m : x)
      // Edits and reactions on messages above what's loaded don't belong in the list.
      : !l.messages.length || newer(m.id, l.messages.at(-1)!.id) ? [...l.messages, m] : l.messages,
  }));
  const fresh = !known && Date.now() - m.time < 60_000;
  if (fresh && m.channelId !== channel && m.author.id !== overview?.me.id) set(s => ({ unread: { ...s.unread, [m.channelId]: true } }));
  // A DM or channel the overview doesn't know yet (a first DM, a new channel).
  const listed = overview?.dms.some(d => d.id === m.channelId) || overview?.guilds.some(g => g.channels.some(c => c.id === m.channelId));
  if (fresh && !listed) void loadOverview();
}

export async function send(channel: string, text: string, files: File[], replyTo?: string) {
  const res = await api.discord.channels[':id'].messages.$post({ param: { id: channel }, form: { text, files, replyTo: replyTo ?? '' } });
  if (!res.ok) await act(Promise.resolve(res));
  return res.ok;
}

export const edit = (channel: string, message: string, text: string) =>
  act(api.discord.channels[':id'].messages[':mid'].$patch({ param: { id: channel, mid: message }, json: { text } }));

export const remove = (channel: string, message: string) =>
  act(api.discord.channels[':id'].messages[':mid'].$delete({ param: { id: channel, mid: message } }));

/** Toggle the bot's reaction. `emoji` is the character, or name:id for a custom one. */
export const react = (channel: string, message: string, emoji: string, on: boolean) =>
  act(api.discord.channels[':id'].messages[':mid'].reactions.$post({ param: { id: channel, mid: message }, json: { emoji, on } }));
