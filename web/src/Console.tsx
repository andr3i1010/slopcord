import { alpha, Box, CircularProgress, Icon, IconButton, TextField, Tooltip, Typography } from '@mui/material';
import { memo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { clock, describe, describeLive, thinkingOf, type Line } from './format.ts';
import { act, api, loadOlder, useStore, type Row } from './store.ts';
import { m3, mono } from './theme.ts';

const tones: Record<NonNullable<Line['tone']> | 'plain', string> = {
  plain: m3.amber, error: m3.error, dim: m3.outline, tool: m3.primary, say: m3.green, think: m3.tertiary,
};

function Text({ line, open, time, onClick }: { line: Line; open: boolean; time: string; onClick?: () => void }) {
  const color = tones[line.tone ?? 'plain'];
  return (
    <Box onClick={onClick} sx={{
      display: 'flex', gap: 1.5, alignItems: 'baseline', px: 2, py: 0.5, fontFamily: mono, fontSize: 12.5, lineHeight: 1.6,
      cursor: onClick && 'pointer', '&:hover': { bgcolor: 'action.hover' },
      ...(open ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word', bgcolor: m3.surfaceContainer } : { whiteSpace: 'nowrap', overflow: 'hidden' }),
    }}>
      <Box component="span" sx={{ color: 'text.disabled', flexShrink: 0 }}>{time}</Box>
      <Box component="span" sx={{
        color, bgcolor: alpha(color, 0.12), borderRadius: 1.5, px: 0.75, width: '10ch', flexShrink: 0, textAlign: 'center',
        overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11.5, fontWeight: 500,
      }}>{line.label}</Box>
      <Box component="span" sx={{
        minWidth: 0, ...(open ? {} : { overflow: 'hidden', textOverflow: 'ellipsis' }),
        ...(line.tone === 'think' && { color: 'text.secondary', fontStyle: 'italic' }),
      }}>{line.text}</Box>
    </Box>
  );
}

const Entry = memo(function Entry({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const said = describe(row.entry), think = row.entry.type === 'message' ? thinkingOf(row.entry.message) : undefined;
  // A turn that only reasoned (then stayed quiet) has nothing else to show.
  const lines = think && !said.text.trim() ? [think] : think ? [think, said] : [said];
  return <>{lines.map((line, i) => <Text key={i} line={line} open={open} time={clock(row.entry.timestamp)} onClick={() => setOpen(!open)} />)}</>;
});

/** What the session is writing right now, outside the list so it stays in view as it grows. */
function LiveLine({ tab }: { tab: string }) {
  const live = useStore(s => s.tabs[tab]?.live);
  const lines = live ? describeLive(live) : [];
  if (!lines.length) return null;
  return (
    <Box sx={{ mx: 1.5, mb: 1, borderRadius: 3, bgcolor: m3.surfaceContainerHigh, maxHeight: '12em', overflow: 'hidden', py: 0.5 }}>
      {lines.map((line, i) => (
        <Text key={i} line={{ ...line, text: `${line.text.slice(-600)}${i === lines.length - 1 ? '▍' : ''}` }} open
          time={i ? '      ' : '● live'} />
      ))}
    </Box>
  );
}

function Input({ tab, disabled }: { tab: string; disabled?: boolean }) {
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim()) return;
    void act(api.interject.$post({ json: { tab, text } }));
    setText('');
  };
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'end', p: 1.5, pt: 0.5 }}>
      <TextField fullWidth size="small" multiline maxRows={6} value={text} disabled={disabled}
        placeholder={disabled ? 'This session has finished' : `Message ${tab} as the owner`}
        helperText={disabled ? undefined : 'Enter sends · Shift+Enter for a new line'}
        slotProps={{ input: { sx: { px: 2.5, py: 1.25 } }, formHelperText: { sx: { mx: 2.5 } } }}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
      <Tooltip title="Send">
        <span>
          <IconButton onClick={send} disabled={disabled || !text.trim()} aria-label="Send"
            sx={{ width: 48, height: 48, mb: disabled ? 0 : 2.75, borderRadius: 4, bgcolor: m3.primaryContainer, color: m3.onPrimaryContainer, '&:hover': { bgcolor: m3.primaryContainer, filter: 'brightness(1.15)' } }}>
            <Icon>send</Icon>
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

function Empty({ icon, text, busy }: { icon: string; text: string; busy?: boolean }) {
  return (
    <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', color: 'text.secondary' }}>
      <Box sx={{ textAlign: 'center' }}>
        {busy ? <CircularProgress size={32} /> : <Icon sx={{ fontSize: 40, color: 'text.disabled' }}>{icon}</Icon>}
        <Typography sx={{ mt: 1 }}>{text}</Typography>
      </Box>
    </Box>
  );
}

export function Console({ tab }: { tab: string }) {
  const rows = useStore(s => s.tabs[tab]?.rows);
  const ended = useStore(s => s.tabs[tab]?.ended);
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {rows?.length ? (
        <Virtuoso style={{ flex: 1 }} data={rows} firstItemIndex={rows[0].index} initialTopMostItemIndex={rows.length - 1}
          computeItemKey={(_, r) => r.index} startReached={() => void loadOlder(tab)} followOutput={atBottom => atBottom && 'auto'}
          itemContent={(_, row) => <Entry row={row} />} />
      ) : rows ? <Empty icon="forum" text="Nothing here yet" /> : <Empty icon="" text="Waiting for the session to start…" busy />}
      <LiveLine tab={tab} />
      <Input tab={tab} disabled={ended || !rows} />
    </Box>
  );
}
