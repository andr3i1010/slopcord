import { Box, Icon, IconButton, Tooltip } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { d, MessageRow } from './Message.tsx';
import { loadOlder, loadOverview, open, pickGuild, send, useDiscord, type Channel, type Guild } from './store.ts';

/** Messages from the same author within 7 minutes, without a reply, sit under one header. */
const GROUP_MS = 7 * 60_000;

function Rail() {
  const { overview, guild, unread } = useDiscord();
  const item = (id: string, label: string, content: React.ReactNode, hasUnread: boolean) => {
    const active = guild === id;
    return (
      <Tooltip key={id} title={label} placement="right">
        <Box onClick={() => pickGuild(id)} sx={{ position: 'relative', width: 72, display: 'grid', placeItems: 'center', mb: 1, cursor: 'pointer', '&:hover .icon': { borderRadius: '16px', bgcolor: id === '@me' ? d.blurple : undefined }, '&:hover .pill': { height: active ? 40 : 20 } }}>
          <Box className="pill" sx={{ position: 'absolute', left: 0, width: 4, borderRadius: '0 4px 4px 0', bgcolor: '#fff', height: active ? 40 : hasUnread ? 8 : 0, transition: 'height .15s' }} />
          <Box className="icon" sx={{
            width: 48, height: 48, borderRadius: active ? '16px' : '50%', overflow: 'hidden', display: 'grid', placeItems: 'center', transition: 'border-radius .15s, background-color .15s',
            bgcolor: active && id === '@me' ? d.blurple : d.chat, color: d.header, fontSize: 16, fontWeight: 500,
          }}>{content}</Box>
        </Box>
      </Tooltip>
    );
  };
  const initials = (name: string) => name.split(/\s+/).map(w => w[0]).join('').slice(0, 4);
  const guildUnread = (g: Guild) => g.channels.some(c => unread[c.id]);
  return (
    <Box sx={{ width: 72, flexShrink: 0, bgcolor: d.rail, pt: 1.5, overflowY: 'auto', scrollbarWidth: 'none' }}>
      {item('@me', 'Direct Messages', <Icon>forum</Icon>, !!overview?.dms.some(c => unread[c.id]))}
      <Box sx={{ width: 32, height: 2, bgcolor: d.side, mx: 'auto', mb: 1 }} />
      {overview?.guilds.map(g => item(g.id, g.name, g.icon ? <img src={g.icon} alt="" style={{ width: 48, height: 48 }} /> : initials(g.name), guildUnread(g)))}
    </Box>
  );
}

function Channels() {
  const { overview, guild, channel, unread } = useDiscord();
  const g = overview?.guilds.find(x => x.id === guild);
  const row = (id: string, label: React.ReactNode, icon: React.ReactNode, title?: string) => {
    const active = channel === id;
    return (
      <Box key={id} title={title} onClick={() => open(id)} sx={{
        display: 'flex', alignItems: 'center', gap: 0.75, mx: 1, px: 1, py: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: 15.5, fontWeight: 500,
        color: active || unread[id] ? d.header : d.icon, bgcolor: active ? d.selected : 'transparent', '&:hover': { bgcolor: active ? d.selected : d.sideHover, color: d.text },
      }}>
        {icon}
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: unread[id] ? 600 : 500 }}>{label}</Box>
      </Box>
    );
  };
  const hash = <Box component="span" sx={{ fontSize: 22, color: d.icon, width: 20, textAlign: 'center', lineHeight: 1, fontWeight: 400 }}>#</Box>;
  const byPosition = (a: Channel, b: Channel) => a.position - b.position;
  const textIn = (parent?: string) => (g?.channels ?? []).filter(c => !c.category && c.parentId === parent).sort(byPosition);
  return (
    <Box sx={{ width: 240, flexShrink: 0, bgcolor: d.side, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ height: 48, px: 2, display: 'flex', alignItems: 'center', fontWeight: 600, color: d.header, boxShadow: '0 1px 0 rgba(0,0,0,.2)', flexShrink: 0 }}>
        {guild === '@me' ? 'Direct Messages' : g?.name}
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', py: 1, scrollbarWidth: 'thin', scrollbarColor: `${d.rail} transparent` }}>
        {guild === '@me'
          ? (overview?.dms.length ? [...overview.dms].sort((a, b) => (b.last ?? '0').localeCompare(a.last ?? '0')).map(dm =>
            row(dm.id, dm.name, <img src={dm.avatar} alt="" style={{ width: 32, height: 32, borderRadius: '50%' }} />))
            : <Box sx={{ px: 2, color: d.muted, fontSize: 14 }}>No DMs since the bot started. They show up here when someone messages it.</Box>)
          : <>
            {textIn(undefined).map(c => row(c.id, c.name, hash, c.topic))}
            {(g?.channels ?? []).filter(c => c.category).sort(byPosition).map(cat => textIn(cat.id).length ? (
              <Box key={cat.id} sx={{ mt: 2 }}>
                <Box sx={{ px: 1, ml: 1, mb: 0.5, fontSize: 12, fontWeight: 600, letterSpacing: '0.02em', textTransform: 'uppercase', color: d.muted, display: 'flex', alignItems: 'center' }}>
                  <Icon sx={{ fontSize: 14 }}>expand_more</Icon>{cat.name}
                </Box>
                {textIn(cat.id).map(c => row(c.id, c.name, hash, c.topic))}
              </Box>
            ) : null)}
          </>}
      </Box>
      {overview && (
        <Box sx={{ height: 52, bgcolor: '#232428', px: 1, display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          <Box sx={{ position: 'relative' }}>
            <img src={overview.me.avatar} alt="" style={{ width: 32, height: 32, borderRadius: '50%', display: 'block' }} />
            <Box sx={{ position: 'absolute', right: -2, bottom: -2, width: 14, height: 14, borderRadius: '50%', bgcolor: d.green, border: '3px solid #232428' }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ color: d.header, fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{overview.me.name}</Box>
            <Box sx={{ color: d.muted, fontSize: 12 }}>Online · as the bot</Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function Composer({ channel, name, canSend, canAttach }: { channel: string; name: string; canSend: boolean; canAttach: boolean }) {
  const replyTo = useDiscord(s => s.replyTo);
  const [text, setText] = useState(''), [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null), box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setText(''); setFiles([]); }, [channel]);
  useEffect(() => { if (replyTo) box.current?.focus(); }, [replyTo]);
  const submit = async () => {
    if (busy || (!text.trim() && !files.length)) return;
    setBusy(true);
    if (await send(channel, text, files, replyTo?.id)) { setText(''); setFiles([]); useDiscord.setState({ replyTo: undefined }); }
    setBusy(false);
  };
  if (!canSend) return <Box sx={{ mx: 2, mb: 3, p: 1.5, borderRadius: '8px', bgcolor: d.input, color: d.muted, fontSize: 15 }}>The bot doesn't have permission to send messages in this channel.</Box>;
  return (
    <Box sx={{ mx: 2, mb: 3 }}>
      {replyTo && (
        <Box sx={{ bgcolor: d.side, borderRadius: '8px 8px 0 0', px: 2, py: 1, fontSize: 14, color: d.muted, display: 'flex', alignItems: 'center' }}>
          <Box sx={{ flex: 1 }}>Replying to <Box component="span" sx={{ color: d.text, fontWeight: 600 }}>{replyTo.author.name}</Box></Box>
          <IconButton size="small" onClick={() => useDiscord.setState({ replyTo: undefined })} sx={{ color: d.muted }}><Icon sx={{ fontSize: 18 }}>cancel</Icon></IconButton>
        </Box>
      )}
      <Box sx={{ bgcolor: d.input, borderRadius: replyTo ? '0 0 8px 8px' : '8px' }}>
        {!!files.length && (
          <Box sx={{ display: 'flex', gap: 1.5, p: 1.5, pb: 0, overflowX: 'auto' }}>
            {files.map((f, i) => (
              <Box key={i} sx={{ position: 'relative', bgcolor: d.side, borderRadius: '4px', p: 1, width: 160, flexShrink: 0 }}>
                {f.type.startsWith('image/')
                  ? <img src={URL.createObjectURL(f)} alt="" style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 4 }} />
                  : <Box sx={{ height: 100, display: 'grid', placeItems: 'center' }}><Icon sx={{ fontSize: 48, color: d.blurple }}>description</Icon></Box>}
                <Box sx={{ fontSize: 12, mt: 0.5, color: d.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</Box>
                <IconButton size="small" onClick={() => setFiles(files.filter((_, j) => j !== i))} sx={{ position: 'absolute', top: -8, right: -8, bgcolor: d.chat, color: d.red, '&:hover': { bgcolor: d.selected } }}><Icon sx={{ fontSize: 18 }}>delete</Icon></IconButton>
              </Box>
            ))}
          </Box>
        )}
        <Box sx={{ display: 'flex', alignItems: 'start', px: 0.5 }}>
          {canAttach && (
            <IconButton onClick={() => picker.current?.click()} sx={{ color: d.muted, mt: '6px', '&:hover': { color: d.text } }}><Icon>add_circle</Icon></IconButton>
          )}
          <input ref={picker} type="file" multiple hidden onChange={e => { setFiles([...files, ...e.target.files ?? []]); e.target.value = ''; }} />
          <Box component="textarea" ref={box} rows={1} value={text} placeholder={`Message ${name}`} disabled={busy}
            onChange={e => { const t = e.target as HTMLTextAreaElement; setText(t.value); t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 300)}px`; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } if (e.key === 'Escape') useDiscord.setState({ replyTo: undefined }); }}
            onPaste={e => { const pasted = [...e.clipboardData.files]; if (pasted.length && canAttach) { e.preventDefault(); setFiles([...files, ...pasted]); } }}
            sx={{ flex: 1, bgcolor: 'transparent', color: d.text, border: 'none', outline: 'none', resize: 'none', font: 'inherit', fontSize: 15.5, lineHeight: 1.375, py: '11px', px: 1, maxHeight: 300, '&::placeholder': { color: d.icon } }} />
        </Box>
      </Box>
    </Box>
  );
}

function Chat() {
  const { overview, guild, channel } = useDiscord();
  const loaded = useDiscord(s => channel ? s.channels[channel] : undefined);
  const g = overview?.guilds.find(x => x.id === guild);
  const c = g?.channels.find(x => x.id === channel), dm = overview?.dms.find(x => x.id === channel);
  if (!channel || (!c && !dm)) return <Box sx={{ flex: 1, bgcolor: d.chat, display: 'grid', placeItems: 'center', color: d.muted }}>Pick a channel</Box>;
  const name = c ? `#${c.name}` : `@${dm!.name}`, me = overview!.me.id;
  const messages = loaded?.messages ?? [];
  const can = c?.can ?? { send: true, attach: true, react: true, manage: false };
  return (
    <Box sx={{ flex: 1, minWidth: 0, bgcolor: d.chat, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ height: 48, px: 2, display: 'flex', alignItems: 'center', gap: 1, boxShadow: '0 1px 0 rgba(0,0,0,.2)', flexShrink: 0, zIndex: 1 }}>
        {c ? <Box component="span" sx={{ fontSize: 24, color: d.icon, lineHeight: 1 }}>#</Box> : <Icon sx={{ color: d.icon }}>alternate_email</Icon>}
        <Box sx={{ fontWeight: 600, color: d.header }}>{c?.name ?? dm!.name}</Box>
        {c?.topic && <><Box sx={{ width: '1px', height: 24, bgcolor: d.divider, mx: 1 }} /><Box sx={{ color: d.muted, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.topic}</Box></>}
      </Box>
      {loaded && messages.length ? (
        <Virtuoso key={channel} style={{ flex: 1 }} data={messages} firstItemIndex={loaded.first} initialTopMostItemIndex={messages.length - 1}
          computeItemKey={(_, m) => m.id} startReached={() => void loadOlder(channel)} followOutput={atBottom => atBottom && 'smooth'}
          components={{
            Header: () => loaded.done ? (
              <Box sx={{ px: 2, pt: 6, pb: 2 }}>
                <Box sx={{ width: 68, height: 68, borderRadius: '50%', bgcolor: d.selected, display: 'grid', placeItems: 'center', fontSize: 40, color: d.header }}>{c ? '#' : <Icon sx={{ fontSize: 40 }}>person</Icon>}</Box>
                <Box sx={{ fontSize: 32, fontWeight: 700, color: d.header, mt: 1 }}>{c ? `Welcome to #${c.name}!` : dm!.name}</Box>
                <Box sx={{ color: d.muted }}>This is the start of {c ? `the #${c.name} channel` : 'your direct message history'}.</Box>
              </Box>
            ) : <Box sx={{ height: 24 }} />,
            Footer: () => <Box sx={{ height: 16 }} />,
          }}
          itemContent={(i, m) => {
            const prev = messages[i - loaded.first - 1];
            const grouped = !!prev && !m.reply && !prev.system && prev.author.id === m.author.id && m.time - prev.time < GROUP_MS;
            return <MessageRow m={m} grouped={grouped} me={me} canManage={can.manage} canReact={can.react} />;
          }} />
      ) : <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', color: d.muted }}>{loaded?.loading || !loaded ? 'Loading…' : 'No messages yet'}</Box>}
      <Composer channel={channel} name={name} canSend={can.send} canAttach={can.attach} />
    </Box>
  );
}

/** The bot's Discord, looking like Discord: servers, channels and DMs, acting as the bot. */
export function Discord() {
  useEffect(() => { void loadOverview(); }, []);
  return (
    <Box sx={{ display: 'flex', height: '100%', fontFamily: d.font, bgcolor: d.chat, '& *::-webkit-scrollbar': { width: 8 }, '& *::-webkit-scrollbar-thumb': { bgcolor: d.rail, borderRadius: 4 } }}>
      <Rail />
      <Channels />
      <Chat />
    </Box>
  );
}
