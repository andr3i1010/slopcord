import { alpha, createTheme } from '@mui/material';

declare module '@mui/material/Button' {
  interface ButtonPropsVariantOverrides { tonal: true }
}

/**
 * Material Design 3 dark scheme from seed #6750A4 (material-color-utilities, SchemeTonalSpot).
 * green and amber are #2E9E5B and #F2A100 harmonized to the seed, at tone 80 (30 for containers).
 */
export const m3 = {
  primary: '#cfbdfe', onPrimary: '#36275d', primaryContainer: '#4d3d75', onPrimaryContainer: '#e9ddff',
  secondary: '#cbc2db', onSecondary: '#332d41', secondaryContainer: '#4a4458', onSecondaryContainer: '#e8def8',
  tertiary: '#efb8c8', onTertiary: '#4a2532', tertiaryContainer: '#633b48', onTertiaryContainer: '#ffd9e3',
  error: '#ffb4ab', onError: '#690005', errorContainer: '#93000a', onErrorContainer: '#ffdad6',
  surface: '#141218', surfaceContainerLowest: '#0f0d13', surfaceContainerLow: '#1d1b20', surfaceContainer: '#211f24',
  surfaceContainerHigh: '#2b292f', surfaceContainerHighest: '#36343a',
  onSurface: '#e6e0e9', onSurfaceVariant: '#cac4cf', outline: '#948f99', outlineVariant: '#49454e',
  inverseSurface: '#e6e0e9', inverseOnSurface: '#322f35',
  // secondaryContainer under an 8% onSecondaryContainer state layer, M3's hover.
  secondaryContainerHover: '#544e62',
  green: '#61dcb0', greenContainer: '#00513c', amber: '#ffb77c', amberContainer: '#6d3900',
};

export const mono = '"Roboto Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: m3.primary, contrastText: m3.onPrimary },
    secondary: { main: m3.secondary, contrastText: m3.onSecondary },
    error: { main: m3.error, contrastText: m3.onError },
    success: { main: m3.green },
    warning: { main: m3.amber },
    info: { main: m3.primary },
    background: { default: m3.surface, paper: m3.surfaceContainer },
    text: { primary: m3.onSurface, secondary: m3.onSurfaceVariant, disabled: m3.outline },
    divider: m3.outlineVariant,
    action: { hover: alpha(m3.onSurface, 0.08), selected: alpha(m3.onSurface, 0.12) },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: '"Roboto Flex", Roboto, system-ui, sans-serif',
    button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0.1 },
    overline: { fontWeight: 500, letterSpacing: 0.5, lineHeight: 1.6 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { scrollbarColor: `${m3.outlineVariant} transparent`, scrollbarWidth: 'thin' },
        '.material-symbols-rounded': { fontVariationSettings: '"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24' },
        '@keyframes pulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.3 } },
      },
    },
    MuiIcon: { defaultProps: { baseClassName: 'material-symbols-rounded' } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 20, minHeight: 40, paddingInline: 16 } },
      variants: [{
        props: { variant: 'tonal' },
        style: {
          backgroundColor: m3.secondaryContainer, color: m3.onSecondaryContainer,
          '&:hover': { backgroundColor: m3.secondaryContainerHover },
        },
      }],
    },
    MuiTabs: { styleOverrides: { indicator: { height: 3, borderRadius: '3px 3px 0 0' } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 500, minHeight: 48, color: m3.onSurfaceVariant } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 28, backgroundColor: m3.surfaceContainerHigh, padding: 8 } } },
    MuiSnackbarContent: { styleOverrides: { root: { backgroundColor: m3.inverseSurface, color: m3.inverseOnSurface, borderRadius: 4 } } },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 4, borderRadius: 2, backgroundColor: m3.secondaryContainer }, bar: { borderRadius: 2 } },
    },
    MuiAccordion: {
      defaultProps: { disableGutters: true, elevation: 0 },
      styleOverrides: { root: { borderRadius: 12, backgroundColor: m3.surfaceContainer, '&::before': { display: 'none' }, '&:not(:last-of-type)': { marginBottom: 8 } } },
    },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 28, backgroundColor: m3.surfaceContainerHigh }, notchedOutline: { borderColor: 'transparent' } } },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 28, marginBottom: 2,
          '&.Mui-selected': { backgroundColor: m3.secondaryContainer, color: m3.onSecondaryContainer },
          '&.Mui-selected:hover': { backgroundColor: m3.secondaryContainerHover },
        },
      },
    },
  },
});
