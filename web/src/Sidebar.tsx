import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Icon, IconButton, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
import { ago, clock } from './format.ts';
import { act, api, useStore, type Status } from './store.ts';
import { m3, mono } from './theme.ts';

function useTicker() {
  const [, setNow] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
}

/** The headline state as an M3-style pill: label plus the container colors that go with it. */
function pill(status: Status, connected: boolean): [string, string, string] {
  if (!connected) return ['Disconnected', m3.surfaceContainerHighest, m3.onSurfaceVariant];
  if (status.down) return ['Offline', m3.errorContainer, m3.onErrorContainer];
  if (!status.ready) return ['Starting', m3.amberContainer, m3.amber];
  if (status.working) return [`Working · ${ago(status.working.since)}`, m3.greenContainer, m3.green];
  return ['Idle', m3.secondaryContainer, m3.onSecondaryContainer];
}

const Row = ({ icon, label, children }: { icon: string; label: string; children: ReactNode }) => (
  <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'start' }}>
    <Icon sx={{ fontSize: 20, color: 'text.secondary', mt: 0.25 }}>{icon}</Icon>
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{children}</Typography>
    </Box>
  </Box>
);

const Card = ({ children }: { children: ReactNode }) => (
  <Box sx={{ bgcolor: m3.surfaceContainer, borderRadius: 4, p: 2 }}>{children}</Box>
);

function List<T>({ title, icon, items, label, onRemove, removeLabel = 'Remove' }: {
  title: string; icon: string; items: T[]; label: (item: T) => string; onRemove: (item: T) => void; removeLabel?: string;
}) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, mb: 0.5 }}>
        <Icon sx={{ fontSize: 18, color: 'text.secondary' }}>{icon}</Icon>
        <Typography variant="subtitle2" color="text.secondary" sx={{ flex: 1 }}>{title}</Typography>
        <Box sx={{ px: 1, borderRadius: 2, bgcolor: items.length ? m3.secondaryContainer : 'transparent', color: m3.onSecondaryContainer, fontSize: 12, fontWeight: 500 }}>{items.length}</Box>
      </Box>
      {items.length ? items.map((item, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'start', gap: 0.5, bgcolor: m3.surfaceContainer, borderRadius: 3, pl: 1.5, py: 0.75, pr: 0.5, mb: 0.5 }}>
          <Typography variant="body2" sx={{ flex: 1, wordBreak: 'break-word', pt: 0.5 }}>{label(item)}</Typography>
          <Tooltip title={removeLabel}>
            <IconButton size="small" aria-label={removeLabel} onClick={() => onRemove(item)}><Icon sx={{ fontSize: 18 }}>close</Icon></IconButton>
          </Tooltip>
        </Box>
      )) : <Typography variant="body2" color="text.disabled" sx={{ px: 1 }}>None</Typography>}
    </Box>
  );
}

export function Sidebar() {
  const status = useStore(s => s.status), connected = useStore(s => s.connected);
  const [confirm, setConfirm] = useState(false);
  useTicker();
  return (
    <Box component="nav" sx={{ width: 360, flexShrink: 0, bgcolor: m3.surfaceContainerLow, borderRadius: '0 16px 16px 0', p: 2, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 0.5 }}>
        <Box sx={{ width: 40, height: 40, borderRadius: 3, bgcolor: m3.primaryContainer, color: m3.onPrimaryContainer, display: 'grid', placeItems: 'center' }}>
          <Icon>smart_toy</Icon>
        </Box>
        <Box>
          <Typography variant="h6" sx={{ lineHeight: 1.2, fontWeight: 600 }}>Slopcord</Typography>
          <Typography variant="caption" color="text.secondary">Dashboard</Typography>
        </Box>
      </Box>
      {!status ? <Typography color="text.secondary" sx={{ px: 1 }}>Connecting…</Typography> : (() => {
        const [state, bg, fg] = pill(status, connected);
        return (
          <>
            <Card>
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.5, borderRadius: 2, bgcolor: bg, color: fg, fontWeight: 500, mb: 2 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: fg, ...(status.working && connected && { animation: 'pulse 1.6s ease-in-out infinite' }) }} />
                {state}
              </Box>
              <Stack spacing={1.5}>
                {status.working && <Row icon="tag" label="Channel">{status.working.where ?? 'None (wake, worker or dashboard)'}</Row>}
                <Row icon="build" label="Last tool"><Box component="span" sx={{ fontFamily: mono, fontSize: 12 }}>{status.lastTool || 'none'}</Box></Row>
                <Row icon="inbox" label="Queued">{status.queued}</Row>
                <Row icon="schedule" label="Up since">{clock(status.startedAt)}</Row>
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                    <Typography variant="caption" color="text.secondary">Context</Typography>
                    <Typography variant="caption">{status.context ? `${Math.round(status.context.percent ?? 0)}% of ${Math.round(status.context.window / 1024)}k` : '?'}</Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={status.context?.percent ?? 0} color={(status.context?.percent ?? 0) > 75 ? 'warning' : 'primary'} />
                </Box>
              </Stack>
            </Card>
            <Box sx={{ display: 'flex', gap: 1, '& > *': { flex: 1, px: 1.5 } }}>
              <Button variant="tonal" startIcon={<Icon>stop_circle</Icon>} onClick={() => act(api.abort.$post({ json: { tab: 'brain' } }))}>Abort</Button>
              <Button variant="tonal" startIcon={<Icon>compress</Icon>} onClick={() => act(api.compact.$post())}>Compact</Button>
              <Button variant="outlined" color="error" startIcon={<Icon>restart_alt</Icon>} onClick={() => setConfirm(true)}>Restart</Button>
            </Box>
            <List title="Workers" icon="engineering" items={status.workers} removeLabel="Stop" label={w => `${w.id} · ${ago(w.started)} · ${w.task}`}
              onRemove={w => act(api.abort.$post({ json: { tab: w.id } }))} />
            <List title="Wakes" icon="alarm" items={status.wakes} label={w => `${clock(w.at)} — ${w.why}`}
              onRemove={w => act(api.wakes[':at'].$delete({ param: { at: String(w.at) } }))} />
            <List title="Unanswered pings" icon="notifications" items={status.pending} removeLabel="Drop" label={p => `${p.where} · ${p.messageId}${p.delivered ? ' (in the current run)' : ''}`}
              onRemove={p => act(api.pending[':id'].$delete({ param: { id: p.messageId } }))} />
            {status.lastError && (
              <Box sx={{ bgcolor: m3.errorContainer, color: m3.onErrorContainer, borderRadius: 4, p: 2, display: 'flex', gap: 1.5 }}>
                <Icon sx={{ fontSize: 20 }}>error</Icon>
                <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{status.lastError}</Typography>
              </Box>
            )}
          </>
        );
      })()}
      <Dialog open={confirm} onClose={() => setConfirm(false)}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}><Icon color="error">restart_alt</Icon>Restart the bot?</DialogTitle>
        <DialogContent sx={{ color: 'text.secondary' }}>The current run is dropped. Kubernetes starts it again, and unanswered pings are re-queued.</DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={() => { setConfirm(false); void act(api.restart.$post()); }}>Restart</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
