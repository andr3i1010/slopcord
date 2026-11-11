import { Accordion, AccordionDetails, AccordionSummary, Box, Icon, List, ListItemButton, ListItemIcon, ListItemText, Snackbar, Tab, Tabs, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Console } from './Console.tsx';
import { Discord } from './discord/Discord.tsx';
import { clock } from './format.ts';
import { Sidebar } from './Sidebar.tsx';
import { api, closeTab, toast, useStore } from './store.ts';
import { m3, mono } from './theme.ts';

function Errors() {
  const errors = useStore(s => s.errors);
  if (!errors.length) return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', color: 'text.secondary', textAlign: 'center' }}>
      <Box><Icon sx={{ fontSize: 40, color: m3.green }}>task_alt</Icon><Typography sx={{ mt: 1 }}>No errors since the bot started</Typography></Box>
    </Box>
  );
  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2 }}>
      {errors.toReversed().map((e, i) => (
        <Accordion key={`${e.time}-${i}`}>
          <AccordionSummary expandIcon={<Icon>expand_more</Icon>}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', minWidth: 0 }}>
              <Icon sx={{ color: m3.error, fontSize: 20 }}>error</Icon>
              <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>{clock(e.time)}</Typography>
              <Typography variant="body2" noWrap>{e.message}</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box component="pre" sx={{ m: 0, p: 2, borderRadius: 3, bgcolor: m3.surfaceContainerLowest, fontFamily: mono, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.trace}</Box>
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
}

function Notes() {
  const [files, setFiles] = useState<string[]>([]), [open, setOpen] = useState<string>(), [text, setText] = useState('');
  useEffect(() => { api.notes.$get().then(r => r.json()).then(setFiles).catch(toast); }, []);
  useEffect(() => {
    if (!open) return;
    (async () => {
      const b = await (await api.note.$get({ query: { path: open } })).json();
      if ('text' in b) setText(b.text);
      else toast(b.error);
    })().catch(toast);
  }, [open]);
  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      <List dense sx={{ width: 300, flexShrink: 0, overflow: 'auto', p: 1.5 }}>
        {files.map(f => (
          <ListItemButton key={f} selected={f === open} onClick={() => setOpen(f)}>
            <ListItemIcon sx={{ minWidth: 36 }}><Icon sx={{ fontSize: 20 }}>{f.includes('/') ? 'folder_open' : 'description'}</Icon></ListItemIcon>
            <ListItemText primary={f.replace(/\.md$/, '')} slotProps={{ primary: { noWrap: true } }} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ flex: 1, minWidth: 0, m: 1.5, ml: 0, borderRadius: 4, bgcolor: m3.surfaceContainer, overflow: 'auto' }}>
        {open
          ? <Box component="pre" sx={{ m: 0, p: 3, fontFamily: mono, fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</Box>
          : <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', color: 'text.secondary' }}>Pick a note</Box>}
      </Box>
    </Box>
  );
}

function Connection() {
  const connected = useStore(s => s.connected);
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.5, borderRadius: 2, fontSize: 13, fontWeight: 500,
      bgcolor: connected ? m3.greenContainer : m3.surfaceContainerHighest, color: connected ? m3.green : m3.onSurfaceVariant,
    }}>
      <Icon sx={{ fontSize: 16 }}>{connected ? 'wifi' : 'wifi_off'}</Icon>{connected ? 'Live' : 'Reconnecting…'}
    </Box>
  );
}

export function App() {
  // Names and finished flags only, so streaming text doesn't re-render the whole page.
  const sessions = useStore(useShallow(s => Object.keys(s.tabs).filter(k => k !== 'brain').map(k => `${k}${s.tabs[k].ended ? ' ✓' : ''}`)));
  const errorCount = useStore(s => s.errors.length), message = useStore(s => s.toast);
  const [current, setCurrent] = useState('brain');
  const view = ['brain', 'discord', 'errors', 'notes'].includes(current) || sessions.some(s => s.split(' ')[0] === current) ? current : 'brain';
  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: m3.surface }}>
      <Sidebar />
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', p: 2, gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Tabs value={view} onChange={(_, v) => setCurrent(v)} variant="scrollable" sx={{ flex: 1, minHeight: 48 }}>
            <Tab value="brain" label="Brain" icon={<Icon>psychology</Icon>} iconPosition="start" />
            {sessions.map(s => {
              const [id, done] = s.split(' ');
              return <Tab key={id} value={id} icon={<Icon>{done ? 'check_circle' : 'engineering'}</Icon>} iconPosition="start" label={done
                ? <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>{id}
                    <Icon aria-label="Close" sx={{ fontSize: 16, borderRadius: '50%', '&:hover': { bgcolor: 'action.hover' } }} onClick={e => { e.stopPropagation(); closeTab(id); }}>close</Icon>
                  </Box>
                : id} />;
            })}
            <Tab value="discord" label="Discord" icon={<Icon>forum</Icon>} iconPosition="start" />
            <Tab value="errors" icon={<Icon>report</Icon>} iconPosition="start" label={
              <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>Errors
                {errorCount > 0 && <Box component="span" sx={{ px: 0.75, borderRadius: 2, bgcolor: m3.error, color: m3.onError, fontSize: 11, lineHeight: '16px' }}>{errorCount}</Box>}
              </Box>} />
            <Tab value="notes" label="Notes" icon={<Icon>sticky_note_2</Icon>} iconPosition="start" />
          </Tabs>
          <Connection />
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, borderRadius: 4, bgcolor: m3.surfaceContainerLowest, overflow: 'hidden' }}>
          {view === 'errors' ? <Errors /> : view === 'notes' ? <Notes /> : view === 'discord' ? <Discord /> : <Console key={view} tab={view} />}
        </Box>
      </Box>
      <Snackbar open={!!message} message={message} autoHideDuration={4000} onClose={() => useStore.setState({ toast: undefined })} />
    </Box>
  );
}
