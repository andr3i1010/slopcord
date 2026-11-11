import { Box, Icon, IconButton, Popover, TextField, Tooltip } from '@mui/material';
import { parse } from 'discord-markdown-parser';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { edit, react, remove, useDiscord, type Wire } from './store.ts';

/** Discord's dark theme. */
export const d = {
  rail: '#1e1f22', side: '#2b2d31', chat: '#313338', input: '#383a40', hover: '#2e3035', selected: '#404249', sideHover: '#35373c',
  text: '#dbdee1', header: '#f2f3f5', muted: '#949ba4', icon: '#80848e', link: '#00a8fc', blurple: '#5865f2', divider: '#3f4147',
  mention: 'rgba(88, 101, 242, 0.3)', mentionText: '#c9cdfb', green: '#23a55a', red: '#f23f43', code: '#2b2d31',
  font: '"Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
};

const emojiUrl = (id: string, animated: boolean, size = 48) => `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'webp'}?size=${size}`;
const pill = { bgcolor: d.mention, color: d.mentionText, borderRadius: '3px', px: '2px', fontWeight: 500, cursor: 'default' };

function Timestamp({ ts, format }: { ts: string; format?: string }) {
  const date = new Date(Number(ts) * 1000);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat([], o).format(date);
  let text: string;
  if (format === 'R') {
    const s = (date.getTime() - Date.now()) / 1000, rtf = new Intl.RelativeTimeFormat([], { numeric: 'auto' });
    const [n, unit] = Math.abs(s) < 60 ? [s, 'second'] : Math.abs(s) < 3600 ? [s / 60, 'minute'] : Math.abs(s) < 86400 ? [s / 3600, 'hour'] : Math.abs(s) < 2_592_000 ? [s / 86400, 'day'] : Math.abs(s) < 31_536_000 ? [s / 2_592_000, 'month'] : [s / 31_536_000, 'year'];
    text = rtf.format(Math.round(n), unit as Intl.RelativeTimeFormatUnit);
  } else text = {
    t: f({ timeStyle: 'short' }), T: f({ timeStyle: 'medium' }), d: f({ dateStyle: 'short' }), D: f({ dateStyle: 'long' }),
    F: f({ dateStyle: 'full', timeStyle: 'short' }),
  }[format ?? ''] ?? f({ dateStyle: 'long', timeStyle: 'short' });
  return <Box component="span" title={date.toLocaleString()} sx={{ bgcolor: 'rgba(255,255,255,0.06)', borderRadius: '3px', px: '2px' }}>{text}</Box>;
}

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return <Box component="span" onClick={() => setShown(true)} sx={{
    borderRadius: '3px', px: '2px', cursor: shown ? 'text' : 'pointer',
    ...(shown ? { bgcolor: 'rgba(255,255,255,0.1)' } : { bgcolor: '#1e1f22', color: 'transparent', '& *': { visibility: 'hidden' } }),
  }}>{children}</Box>;
}

type Ctx = { mentions: Wire['mentions']; jumbo: boolean };

/** One node of discord-markdown-parser's tree. */
function node(n: any, ctx: Ctx, key: number): ReactNode {
  const kids = () => Array.isArray(n.content) ? n.content.map((c: any, i: number) => node(c, ctx, i)) : n.content;
  switch (n.type) {
    case 'text': return n.content;
    case 'br': return <br key={key} />;
    case 'strong': return <strong key={key}>{kids()}</strong>;
    case 'em': return <em key={key}>{kids()}</em>;
    case 'underline': return <u key={key}>{kids()}</u>;
    case 'strikethrough': return <s key={key}>{kids()}</s>;
    case 'spoiler': return <Spoiler key={key}>{kids()}</Spoiler>;
    case 'inlineCode': return <Box key={key} component="code" sx={{ bgcolor: d.code, border: `1px solid ${d.rail}`, borderRadius: '4px', px: '3px', fontSize: '85%', fontFamily: 'Consolas, "Roboto Mono", monospace' }}>{n.content}</Box>;
    case 'codeBlock': return <Box key={key} component="pre" sx={{ bgcolor: d.code, border: `1px solid ${d.rail}`, borderRadius: '4px', p: 1, my: 0.5, overflowX: 'auto', fontSize: 13.5, fontFamily: 'Consolas, "Roboto Mono", monospace', whiteSpace: 'pre-wrap', maxWidth: '90%' }}>{n.content}</Box>;
    case 'blockQuote': return <Box key={key} sx={{ borderLeft: `4px solid #4e5058`, pl: 1.5, my: 0.25 }}>{kids()}</Box>;
    case 'url': case 'autolink': case 'link':
      // Links come from other people's messages: only web links become clickable.
      return /^https?:\/\//i.test(n.target) ? <Box key={key} component="a" href={n.target} target="_blank" rel="noreferrer noopener" sx={{ color: d.link, textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>{kids()}</Box> : <span key={key}>{kids()}</span>;
    case 'user': return <Box key={key} component="span" sx={pill}>@{ctx.mentions.users[n.id] ?? 'unknown-user'}</Box>;
    case 'role': {
      const role = ctx.mentions.roles[n.id];
      return <Box key={key} component="span" sx={{ ...pill, ...(role?.color && { color: role.color, bgcolor: `${role.color}1f` }) }}>@{role?.name ?? 'deleted-role'}</Box>;
    }
    case 'channel': return <Box key={key} component="span" sx={pill}>#{ctx.mentions.channels[n.id] ?? 'unknown'}</Box>;
    case 'everyone': return <Box key={key} component="span" sx={pill}>@everyone</Box>;
    case 'here': return <Box key={key} component="span" sx={pill}>@here</Box>;
    case 'emoji': return <Box key={key} component="img" src={emojiUrl(n.id, n.animated)} alt={`:${n.name}:`} title={`:${n.name}:`} sx={{ height: ctx.jumbo ? 48 : 22, width: 'auto', verticalAlign: 'bottom', mx: '1px' }} />;
    case 'timestamp': return <Timestamp key={key} ts={n.timestamp} format={n.format} />;
    case 'heading': return <Box key={key} sx={{ fontSize: [0, 24, 20, 16][n.level] ?? 16, fontWeight: 700, color: d.header, my: 0.5, lineHeight: 1.375 }}>{kids()}</Box>;
    case 'subtext': return <Box key={key} sx={{ fontSize: 12, color: d.muted }}>{kids()}</Box>;
    default: return typeof n.content === 'string' ? n.content : Array.isArray(n.content) ? <span key={key}>{kids()}</span> : null;
  }
}

/** A message of only emoji (up to 30) shows them big, like Discord. */
const onlyEmoji = (text: string) => text.length < 300 && /^(\s|<a?:\w+:\d+>|\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️)+$/u.test(text);

export function Markdown({ text, mentions }: { text: string; mentions: Wire['mentions'] }) {
  const tree = useMemo(() => parse(text, 'normal'), [text]);
  const jumbo = onlyEmoji(text);
  return <Box sx={{ ...(jumbo && { fontSize: 44, lineHeight: 1.2 }), whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{tree.map((n, i) => node(n, { mentions, jumbo }, i))}</Box>;
}

const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1 << 20 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1 << 20)).toFixed(1)} MB`;
const isImage = (type?: string, url?: string) => type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url ?? '');
const media = { maxWidth: 400, maxHeight: 300, borderRadius: '8px', display: 'block', mt: 0.5, cursor: 'pointer' };

function Attachments({ m }: { m: Wire }) {
  return <>{m.attachments.map(a => isImage(a.type, a.url)
    ? <Box key={a.url} component="img" src={a.url} alt={a.name} onClick={() => window.open(a.url, '_blank', 'noopener')} sx={media} />
    : a.type?.startsWith('video/')
      ? <Box key={a.url} component="video" src={a.url} controls sx={{ ...media, cursor: 'auto' }} />
      : (
        <Box key={a.url} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: d.side, border: `1px solid ${d.rail}`, borderRadius: '8px', p: 1.5, mt: 0.5, maxWidth: 432 }}>
          <Icon sx={{ color: d.blurple, fontSize: 32 }}>description</Icon>
          <Box sx={{ minWidth: 0 }}>
            <Box component="a" href={a.url} target="_blank" rel="noreferrer noopener" sx={{ color: d.link, textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</Box>
            <Box sx={{ fontSize: 12, color: d.muted }}>{size(a.size)}</Box>
          </Box>
        </Box>
      ))}</>;
}

function Embeds({ m }: { m: Wire }) {
  return <>{m.embeds.map((e, i) => {
    // GIF links (Tenor, Giphy) show as just the looping video, like in Discord.
    if (e.type === 'gifv' && e.video) return <Box key={i} component="video" src={e.video} autoPlay loop muted playsInline sx={media} />;
    if (e.type === 'image' && (e.image ?? e.thumbnail)) return <Box key={i} component="img" src={e.image ?? e.thumbnail} sx={media} />;
    return (
      <Box key={i} sx={{ bgcolor: d.side, borderLeft: `4px solid ${e.color ?? d.rail}`, borderRadius: '4px', p: '8px 16px 16px 12px', mt: 0.5, maxWidth: 432, display: 'grid', gap: 0.5 }}>
        {e.provider && <Box sx={{ fontSize: 12, color: d.muted }}>{e.provider}</Box>}
        {e.author && <Box sx={{ fontSize: 14, fontWeight: 600, color: d.header }}>{e.author}</Box>}
        {e.title && (e.url ? <Box component="a" href={e.url} target="_blank" rel="noreferrer noopener" sx={{ color: d.link, fontWeight: 600, textDecoration: 'none' }}>{e.title}</Box> : <Box sx={{ fontWeight: 600, color: d.header }}>{e.title}</Box>)}
        {e.description && <Box sx={{ fontSize: 14 }}><Markdown text={e.description} mentions={m.mentions} /></Box>}
        {!!e.fields?.length && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
            {e.fields.map((f, j) => <Box key={j} sx={{ gridColumn: f.inline ? undefined : '1 / -1', fontSize: 14 }}><Box sx={{ fontWeight: 600, color: d.header }}>{f.name}</Box><Markdown text={f.value} mentions={m.mentions} /></Box>)}
          </Box>
        )}
        {e.video && !e.image ? <Box component="video" src={e.video} controls sx={{ ...media, cursor: 'auto' }} />
          : (e.image ?? e.thumbnail) && <Box component="img" src={e.image ?? e.thumbnail} sx={{ ...media, maxWidth: 400 }} />}
        {e.footer && <Box sx={{ fontSize: 12, color: d.muted }}>{e.footer}</Box>}
      </Box>
    );
  })}</>;
}

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👀', '💀', '🎉', '✅', '❌', '🤔', '😭', '🙏', '💯', '🗿'];

/** A small picker: common emoji, the server's own, and a field for anything else. */
function EmojiPicker({ anchor, onClose, onPick }: { anchor: HTMLElement | null; onClose: () => void; onPick: (emoji: string) => void }) {
  const { overview, guild } = useDiscord();
  const custom = overview?.guilds.find(g => g.id === guild)?.emojis ?? [];
  const [other, setOther] = useState('');
  const pick = (e: string) => { onPick(e); onClose(); };
  const cell = { fontSize: 22, width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: '4px', cursor: 'pointer', '&:hover': { bgcolor: d.selected } };
  return (
    <Popover open={!!anchor} anchorEl={anchor} onClose={onClose} anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      slotProps={{ paper: { sx: { bgcolor: d.side, color: d.text, p: 1, width: 340, borderRadius: '8px', fontFamily: d.font } } }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>{QUICK.map(e => <Box key={e} sx={cell} onClick={() => pick(e)}>{e}</Box>)}</Box>
      {!!custom.length && <>
        <Box sx={{ fontSize: 12, fontWeight: 600, color: d.muted, textTransform: 'uppercase', mt: 1, mb: 0.5 }}>This server</Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', maxHeight: 180, overflow: 'auto' }}>
          {custom.map(e => <Box key={e.id} sx={cell} title={`:${e.name}:`} onClick={() => pick(`${e.name}:${e.id}`)}><img src={emojiUrl(e.id, e.animated, 48)} alt={e.name} style={{ width: 26, height: 26, objectFit: 'contain' }} /></Box>)}
        </Box>
      </>}
      <TextField size="small" fullWidth placeholder="Any emoji, then Enter" value={other} onChange={e => setOther(e.target.value)} sx={{ mt: 1 }}
        onKeyDown={e => { if (e.key === 'Enter' && other.trim()) pick(other.trim()); }} />
    </Popover>
  );
}

function Reactions({ m }: { m: Wire }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
      {m.reactions.map(r => {
        const key = r.id ? `${r.name}:${r.id}` : r.name;
        return (
          <Box key={key} onClick={() => react(m.channelId, m.id, key, !r.me)} sx={{
            display: 'flex', alignItems: 'center', gap: 0.75, px: 0.75, height: 24, borderRadius: '8px', cursor: 'pointer', fontSize: 14, fontWeight: 600,
            bgcolor: r.me ? 'rgba(88,101,242,0.15)' : d.side, border: `1px solid ${r.me ? d.blurple : 'transparent'}`, color: r.me ? d.mentionText : d.muted,
            '&:hover': { borderColor: r.me ? d.blurple : '#4e5058' },
          }}>
            {r.id ? <img src={emojiUrl(r.id, r.animated, 32)} alt={r.name} style={{ width: 16, height: 16 }} /> : <span style={{ fontSize: 16 }}>{r.name}</span>}
            {r.count}
          </Box>
        );
      })}
    </Box>
  );
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const stamp = (ms: number) => {
  const date = new Date(ms), today = new Date().toDateString() === date.toDateString();
  return today ? `Today at ${clock(ms)}` : `${date.toLocaleDateString()} ${clock(ms)}`;
};

function Editor({ m }: { m: Wire }) {
  const [text, setText] = useState(m.content);
  const done = () => useDiscord.setState({ editing: undefined });
  return (
    <Box>
      <Box component="textarea" autoFocus value={text} onChange={e => setText((e.target as HTMLTextAreaElement).value)}
        onKeyDown={e => {
          if (e.key === 'Escape') done();
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim() && text !== m.content) void edit(m.channelId, m.id, text); done(); }
        }}
        sx={{ width: '100%', bgcolor: d.input, color: d.text, border: 'none', outline: 'none', borderRadius: '8px', p: 1.25, font: 'inherit', resize: 'vertical', minHeight: 44 }} />
      <Box sx={{ fontSize: 12, color: d.muted }}>escape to cancel · enter to save</Box>
    </Box>
  );
}

/** A Discord message row. `grouped` hides the avatar and name for a follow-up from the same author. */
export const MessageRow = memo(function MessageRow({ m, grouped, me, canManage, canReact }: { m: Wire; grouped: boolean; me: string; canManage: boolean; canReact: boolean }) {
  const editing = useDiscord(s => s.editing === m.id);
  const [picker, setPicker] = useState<HTMLElement | null>(null), [confirm, setConfirm] = useState(false);
  const mine = m.author.id === me;
  const tool = (title: string, icon: string, onClick: (e: React.MouseEvent<HTMLElement>) => void, danger = false) => (
    <Tooltip title={title} placement="top"><IconButton size="small" onClick={onClick} sx={{ borderRadius: '4px', color: danger ? d.red : d.muted, '&:hover': { bgcolor: d.selected, color: danger ? d.red : d.text } }}><Icon sx={{ fontSize: 20 }}>{icon}</Icon></IconButton></Tooltip>
  );
  if (m.system) return <Box sx={{ pl: '72px', py: 0.5, color: d.muted, fontSize: 14 }}><Icon sx={{ fontSize: 16, verticalAlign: 'middle', mr: 1, color: d.green }}>arrow_forward</Icon>{m.author.name} {m.content || 'did something'}</Box>;
  return (
    <Box sx={{ position: 'relative', pl: '72px', pr: 6, py: grouped ? 0.125 : 0.25, mt: grouped ? 0 : 2, color: d.text, fontSize: 15.5, lineHeight: 1.375, '&:hover': { bgcolor: d.hover }, '&:hover .tools, &:hover .time': { opacity: 1 } }}>
      {m.reply && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 13.5, color: d.muted, mb: 0.25, position: 'relative', '&::before': { content: '""', position: 'absolute', left: -36, top: 9, width: 30, height: 10, borderLeft: `2px solid ${d.icon}`, borderTop: `2px solid ${d.icon}`, borderTopLeftRadius: 6 } }}>
          {m.reply.avatar && <img src={m.reply.avatar} alt="" style={{ width: 16, height: 16, borderRadius: '50%' }} />}
          <Box component="span" sx={{ fontWeight: 600, color: d.text, opacity: 0.8 }}>{m.reply.author ? `@${m.reply.author}` : 'Original message'}</Box>
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.reply.content ?? 'was deleted or is too old to show'}</Box>
        </Box>
      )}
      {grouped
        ? <Box className="time" sx={{ position: 'absolute', left: 0, width: 72, textAlign: 'center', fontSize: 11, color: d.muted, opacity: 0, top: 6 }}>{clock(m.time)}</Box>
        : <>
          <Box component="img" src={m.author.avatar} alt="" sx={{ position: 'absolute', left: 16, top: m.reply ? 26 : 4, width: 40, height: 40, borderRadius: '50%' }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box component="span" sx={{ fontWeight: 500, color: m.author.color ?? d.header }}>{m.author.name}</Box>
            {m.author.bot && <Box component="span" sx={{ bgcolor: d.blurple, color: '#fff', fontSize: 10, fontWeight: 600, px: 0.5, borderRadius: '3px', lineHeight: '15px' }}>APP</Box>}
            <Box component="span" sx={{ fontSize: 12, color: d.muted }}>{stamp(m.time)}</Box>
          </Box>
        </>}
      {editing ? <Editor m={m} /> : m.content && (
        <Box>
          <Markdown text={m.content} mentions={m.mentions} />
          {m.edited && <Box component="span" title={new Date(m.edited).toLocaleString()} sx={{ fontSize: 10, color: d.muted, ml: 0.5 }}>(edited)</Box>}
        </Box>
      )}
      <Attachments m={m} />
      <Embeds m={m} />
      {m.stickers.map(s => <Box key={s.url} component="img" src={s.url} alt={s.name} title={s.name} sx={{ width: 160, height: 160, mt: 0.5 }} />)}
      {!!m.reactions.length && <Reactions m={m} />}
      <Box className="tools" sx={{ position: 'absolute', right: 16, top: -16, opacity: 0, display: 'flex', bgcolor: d.chat, border: `1px solid ${d.rail}`, borderRadius: '8px', p: '2px', boxShadow: '0 0 0 1px rgba(0,0,0,.08)', zIndex: 1 }}>
        {canReact && tool('Add Reaction', 'add_reaction', e => setPicker(e.currentTarget))}
        {tool('Reply', 'reply', () => useDiscord.setState({ replyTo: m }))}
        {mine && tool('Edit', 'edit', () => useDiscord.setState({ editing: m.id }))}
        {(mine || canManage) && tool('Delete', 'delete', e => e.shiftKey ? void remove(m.channelId, m.id) : setConfirm(true), true)}
      </Box>
      <EmojiPicker anchor={picker} onClose={() => setPicker(null)} onPick={e => react(m.channelId, m.id, e, true)} />
      {confirm && (
        <Box sx={{ position: 'absolute', right: 16, top: 20, zIndex: 2, bgcolor: d.side, border: `1px solid ${d.rail}`, borderRadius: '8px', p: 1.5, display: 'flex', gap: 1, alignItems: 'center', fontSize: 14 }}>
          Delete this message?
          <Box component="button" onClick={() => setConfirm(false)} sx={{ bgcolor: 'transparent', color: d.text, border: 'none', cursor: 'pointer', font: 'inherit' }}>Cancel</Box>
          <Box component="button" onClick={() => { setConfirm(false); void remove(m.channelId, m.id); }} sx={{ bgcolor: d.red, color: '#fff', border: 'none', borderRadius: '4px', px: 1.5, py: 0.5, cursor: 'pointer', font: 'inherit' }}>Delete</Box>
        </Box>
      )}
    </Box>
  );
});
