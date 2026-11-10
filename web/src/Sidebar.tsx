import { Box, Button, Dialog, DialogActions, DialogContent, Divider, IconButton, LinearProgress, Stack, Typography } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
import { ago, clock } from './format.ts';
import { act, api, useStore } from './store.ts';

function useTicker() {
  const [, setNow] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
}

const Field = ({ k, children }: { k: string; children: ReactNode }) => (
  <Box>
    <Typography variant="caption" color="text.secondary">{k}</Typography>
    <Typography variant="body2" sx={{ wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{children}</Typography>
  </Box>
);

function List<T>({ title, items, label, onRemove, removeLabel = 'remove' }: { title: string; items: T[]; label: (item: T) => string; onRemove: (item: T) => void; removeLabel?: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{title} · {items.length}</Typography>
      {items.map((item, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'start', gap: 0.5 }}>
          <Typography variant="body2" sx={{ flex: 1, wordBreak: 'break-word' }}>{label(item)}</Typography>
          <IconButton size="small" aria-label={removeLabel} title={removeLabel} onClick={() => onRemove(item)}>×</IconButton>
        </Box>
      ))}
    </Box>
  );
}

export function Sidebar() {
  const status = useStore(s => s.status), connected = useStore(s => s.connected);
  const [confirm, setConfirm] = useState(false);
  useTicker();
  if (!status) return <Box sx={{ width: 300, p: 2 }}>connecting…</Box>;
  const [state, color] = !connected ? ['disconnected', 'text.disabled'] : status.down ? ['offline', 'error.main'] : !status.ready ? ['starting', 'warning.main']
    : status.working ? [`working ${ago(status.working.since)}`, 'success.main'] : ['idle', 'info.main'];
  return (
    <Box sx={{ width: 300, flexShrink: 0, borderRight: 1, borderColor: 'divider', p: 2, overflow: 'auto' }}>
      <Stack spacing={1.5}>
        <Typography variant="h6"><Box component="span" sx={{ color }}>●</Box> {state}</Typography>
        {status.working && <Field k="channel">{status.working.where ?? 'none (wake, worker or dashboard)'}</Field>}
        <Field k="last tool">{status.lastTool || 'none'}</Field>
        <Box>
          <Field k="context">{status.context ? `${Math.round(status.context.percent ?? 0)}% of ${status.context.window} tokens` : '?'}</Field>
          <LinearProgress variant="determinate" value={status.context?.percent ?? 0} />
        </Box>
        <Field k="queued">{status.queued}</Field>
        <Field k="up since">{clock(status.startedAt)}</Field>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" onClick={() => act(api.abort.$post({ json: { tab: 'brain' } }))}>Abort</Button>
          <Button size="small" variant="outlined" onClick={() => act(api.compact.$post())}>Compact</Button>
          <Button size="small" variant="outlined" color="error" onClick={() => setConfirm(true)}>Restart</Button>
        </Stack>
        <Divider />
        <List title="Workers" items={status.workers} removeLabel="stop" label={w => `${w.id} · ${ago(w.started)} · ${w.task}`}
          onRemove={w => act(api.abort.$post({ json: { tab: w.id } }))} />
        <List title="Wakes" items={status.wakes} label={w => `${clock(w.at)} ${w.why}`}
          onRemove={w => act(api.wakes[':at'].$delete({ param: { at: String(w.at) } }))} />
        <List title="Unanswered pings" items={status.pending} removeLabel="drop" label={p => `${p.where} · ${p.messageId}${p.delivered ? ' (in the current run)' : ''}`}
          onRemove={p => act(api.pending[':id'].$delete({ param: { id: p.messageId } }))} />
        {status.lastError && <><Divider /><Field k="last error">{status.lastError}</Field></>}
      </Stack>
      <Dialog open={confirm} onClose={() => setConfirm(false)}>
        <DialogContent>Restart the bot? The current run is dropped; Kubernetes starts it again and unanswered pings are re-queued.</DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button color="error" onClick={() => { setConfirm(false); void act(api.restart.$post()); }}>Restart</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
