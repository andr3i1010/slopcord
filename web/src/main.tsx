import { CssBaseline, ThemeProvider } from '@mui/material';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { connect } from './store.ts';
import { theme } from './theme.ts';

connect();
createRoot(document.getElementById('root')!).render(<ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider>);
