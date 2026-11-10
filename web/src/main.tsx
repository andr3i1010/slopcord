import { createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { connect } from './store.ts';

const theme = createTheme({
  palette: { mode: 'dark', background: { default: '#0d1117', paper: '#161b22' } },
  typography: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13 },
});

connect();
createRoot(document.getElementById('root')!).render(<ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider>);
