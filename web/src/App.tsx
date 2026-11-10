import { Accordion, AccordionDetails, AccordionSummary, Box, List, ListItemButton, ListItemText, Snackbar, Tab, Tabs } from '@mui/material';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Console } from './Console.tsx';
import { clock } from './format.ts';
import { Sidebar } from './Sidebar.tsx';
import { api, closeTab, toast, useStore } from './store.ts';

function Errors() {
  const errors = useStore(s => s.errors);
  if (!errors.length) return <Box sx={{ p: 2, color: 'text.secondary' }}>no errors since the bot started</Box>;
  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 1 }}>
      {errors.toReversed().map((e, i) => (
        <Accordion key={`${e.time}-${i}`} disableGutters>
          <AccordionSummary><Box component="span" sx={{ color: 'text.secondary', mr: 1.5 }}>{clock(e.time)}</Box>{e.message}</AccordionSummary>
          <AccordionDetails><Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.trace}</Box></AccordionDetails>
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
      <List dense sx={{ width: 280, flexShrink: 0, overflow: 'auto', borderRight: 1, borderColor: 'divider' }}>
        {files.map(f => <ListItemButton key={f} selected={f === open} onClick={() => setOpen(f)}><ListItemText primary={f} /></ListItemButton>)}
      </List>
      <Box component="pre" sx={{ flex: 1, m: 0, p: 2, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{open ? text : 'pick a note'}</Box>
    </Box>
  );
}

export function App() {
  // Names and finished flags only, so streaming text doesn't re-render the whole page.
  const sessions = useStore(useShallow(s => Object.keys(s.tabs).filter(k => k !== 'brain').map(k => `${k}${s.tabs[k].ended ? ' ✓' : ''}`)));
  const errorCount = useStore(s => s.errors.length), message = useStore(s => s.toast);
  const [current, setCurrent] = useState('brain');
  const view = ['brain', 'errors', 'notes'].includes(current) || sessions.some(s => s.split(' ')[0] === current) ? current : 'brain';
  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <Sidebar />
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Tabs value={view} onChange={(_, v) => setCurrent(v)} variant="scrollable" sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="brain" label="Brain" />
          {sessions.map(s => {
            const [id, done] = s.split(' ');
            return <Tab key={id} value={id} label={done
              ? <span>{id} ✓ <Box component="span" title="close" onClick={e => { e.stopPropagation(); closeTab(id); }}>×</Box></span>
              : id} />;
          })}
          <Tab value="errors" label={`Errors · ${errorCount}`} />
          <Tab value="notes" label="Notes" />
        </Tabs>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {view === 'errors' ? <Errors /> : view === 'notes' ? <Notes /> : <Console key={view} tab={view} />}
        </Box>
      </Box>
      <Snackbar open={!!message} message={message} autoHideDuration={4000} onClose={() => useStore.setState({ toast: undefined })} />
    </Box>
  );
}
