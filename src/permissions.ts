import { PermissionsBitField, type Guild } from 'discord.js';

/** The bot's permissions in one server, plus per channel what that channel's overwrites change about them (XOR). */
export type Snapshot = Map<string, bigint>;

export function snapshot(guild: Guild): Snapshot | undefined {
  const me = guild.members.me;
  if (!me) return;
  const base = me.permissions.bitfield, snap: Snapshot = new Map([[guild.id, base]]);
  for (const c of guild.channels.cache.values()) {
    if (!c.isThread()) snap.set(c.id, (c.permissionsFor(me)?.bitfield ?? base) ^ base);
  }
  return snap;
}

/** What the bot gained or lost between two snapshots, as events. Channel events leave out what the server-wide change already says. */
export function changes(guild: Guild, before: Snapshot, after: Snapshot) {
  const names = (bits: bigint) => new PermissionsBitField(bits).toArray();
  const baseWas = before.get(guild.id)!, baseNow = after.get(guild.id)!;
  const gainedEverywhere = baseNow & ~baseWas, lostEverywhere = baseWas & ~baseNow;
  const events: object[] = [];
  const add = (channelId: string | undefined, gained: bigint, lost: bigint) => {
    if (!gained && !lost) return;
    const where = channelId ? `#${guild.channels.cache.get(channelId)?.name} in ${guild.name}` : guild.name;
    events.push({ kind: 'permissions', guildId: guild.id, channelId, where, gained: names(gained), lost: names(lost) });
  };
  add(undefined, gainedEverywhere, lostEverywhere);
  for (const [id, delta] of after) {
    const was = before.get(id);
    // New channels aren't a change; deleted ones are simply gone from `after`.
    if (id === guild.id || was === undefined || was === delta) continue;
    const channelWas = baseWas ^ was, channelNow = baseNow ^ delta;
    add(id, channelNow & ~channelWas & ~gainedEverywhere, channelWas & ~channelNow & ~lostEverywhere);
  }
  return events;
}
