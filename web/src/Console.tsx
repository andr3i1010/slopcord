import { Box, Button, TextField, Typography } from '@mui/material';
import { memo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { clock, describe, describeLive, type Line } from './format.ts';
import { act, api, loadOlder, useStore, type Row } from './store.ts';

const tones: Record<NonNullable<Line['tone']>, string> = { error: 'error.main', dim: 'text.disabled', tool: 'info.main', say: 'success.main' };

function Text({ line, open, time, onClick }: { line: Line; open: boolean; time: string; onClick?: () => void }) {
  return (
    <Box onClick={onClick} sx={{
      display: 'flex', gap: 1.5, px: 1.5, py: 0.25, cursor: onClick && 'pointer', '&:hover': { bgcolor: 'action.hover' },
      ...(open ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } : { whiteSpace: 'nowrap', overflow: 'hidden' }),
    }}>
      <Box component="span" sx={{ color: 'text.secondary', flexShrink: 0 }}>{time}</Box>
      <Box component="span" sx={{ color: line.tone ? tones[line.tone] : 'warning.main', width: '8ch', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{line.label}</Box>
      <Box component="span" sx={{ minWidth: 0, ...(open ? {} : { overflow: 'hidden', textOverflow: 'ellipsis' }) }}>{line.text}</Box>
    </Box>
  );
}

const Entry = memo(function Entry({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  return <Text line={describe(row.entry)} open={open} time={clock(row.entry.timestamp)} onClick={() => setOpen(!open)} />;
});

/** What the session is writing right now, outside the list so it stays in view as it grows. */
function LiveLine({ tab }: { tab: string }) {
  const live = useStore(s => s.tabs[tab]?.live);
  if (!live) return null;
  const line = describeLive(live);
  return (
    <Box sx={{ borderTop: 1, borderColor: 'divider', maxHeight: '10em', overflow: 'hidden' }}>
      <Text line={{ ...line, text: `${line.text.slice(-800)}▍` }} open time="  live  " />
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
    <Box sx={{ display: 'flex', gap: 1, p: 1, borderTop: 1, borderColor: 'divider' }}>
      <TextField fullWidth size="small" multiline maxRows={6} value={text} disabled={disabled}
        placeholder={disabled ? 'finished' : `say something to ${tab} as the owner (Enter sends, Shift+Enter for a new line)`}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
      <Button variant="contained" onClick={send} disabled={disabled}>Send</Button>
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
      ) : (
        <Typography sx={{ flex: 1, p: 2, color: 'text.secondary' }}>{rows ? 'nothing here yet' : 'waiting for the session to start…'}</Typography>
      )}
      <LiveLine tab={tab} />
      <Input tab={tab} disabled={ended || !rows} />
    </Box>
  );
}
