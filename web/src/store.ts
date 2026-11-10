import { hc } from 'hono/client';
import { create } from 'zustand';
import type { AppType, Events } from '../../src/server.ts';

export const api = hc<AppType>(location.origin).api;

export type Status = Events['status'];
export type Row = Omit<Events['entry'], 'tab'>;
export type Live = Omit<Events['partial'], 'tab'>;
export type Reported = Events['reported'];
type Tab = { count: number; rows: Row[]; live?: Live; ended?: boolean; loading?: boolean };

export const useStore = create<{ connected: boolean; status?: Status; errors: Reported[]; tabs: Record<string, Tab>; toast?: string }>(
  () => ({ connected: false, errors: [], tabs: {} }));
const set = useStore.setState, get = useStore.getState;

const PAGE = 200, MAX_GAP = 500;

export const toast = (e: unknown) => set({ toast: e instanceof Error ? e.message : String(e) });

/** Run a dashboard action and show its result or error. */
export async function act(res: Promise<{ ok: boolean; statusText: string; json(): Promise<unknown> }>) {
  try {
    const r = await res, body = await r.json().catch(() => ({})) as { result?: string; error?: string };
    toast((r.ok ? body.result : body.error) ?? r.statusText);
  } catch (e) { toast(e); }
}

function patch(tab: string, change: (t: Tab) => Partial<Tab>) {
  set(s => {
    const t = s.tabs[tab] ?? { count: 0, rows: [] };
    return { tabs: { ...s.tabs, [tab]: { ...t, ...change(t) } } };
  });
}

export const closeTab = (tab: string) => set(s => ({ tabs: Object.fromEntries(Object.entries(s.tabs).filter(([k]) => k !== tab)) }));

/** Sorted by index, one row per index. */
function merge(rows: Row[], more: Row[]) {
  if (more.length === 1 && more[0].index === (rows.at(-1)?.index ?? -1) + 1) return [...rows, more[0]];
  const byIndex = new Map(rows.map(r => [r.index, r]));
  for (const r of more) byIndex.set(r.index, r);
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

async function load(tab: string, from: number, to: number) {
  const res = await api.sessions[':tab'].entries.$get({ param: { tab }, query: { from: String(from), to: String(to) } });
  const body = await res.json();
  if ('error' in body) throw new Error(body.error);
  patch(tab, t => ({ rows: merge(t.rows, body.entries as Row[]), count: Math.max(t.count, body.count) }));
}

/** The page above what's loaded; with nothing loaded yet, the newest page. */
export async function loadOlder(tab: string) {
  const t = get().tabs[tab];
  const first = t?.rows[0]?.index ?? t?.count ?? 0;
  if (!t || t.loading || first === 0) return;
  patch(tab, () => ({ loading: true }));
  try { await load(tab, Math.max(0, first - PAGE), first); } catch (e) { toast(e); } finally { patch(tab, () => ({ loading: false })); }
}

/** On every (re)connect: fresh status, and each tab caught up with what happened while the stream was down. */
function hello(h: Events['hello']) {
  set(s => ({
    connected: true, status: h.status, errors: h.errors,
    tabs: Object.fromEntries(Object.entries(s.tabs).map(([k, t]) => [k, k in h.sessions ? t : { ...t, ended: true, live: undefined }])),
  }));
  for (const [tab, count] of Object.entries(h.sessions)) {
    const last = get().tabs[tab]?.rows.at(-1)?.index;
    if (last === undefined || count - last > MAX_GAP) {
      patch(tab, () => ({ count, rows: [], ended: false }));
      void loadOlder(tab);
    } else {
      patch(tab, () => ({ count, ended: false }));
      if (count > last + 1) load(tab, last + 1, count).catch(toast);
    }
  }
}

export function connect() {
  const es = new EventSource('/api/events');
  const on = <K extends keyof Events>(event: K, handle: (data: Events[K]) => void) =>
    es.addEventListener(event, e => handle(JSON.parse((e as MessageEvent).data)));
  on('hello', hello);
  on('status', status => set({ status }));
  on('entry', ({ tab, ...row }) => patch(tab, t => ({ rows: merge(t.rows, [row]), count: Math.max(t.count, row.index + 1) })));
  on('partial', ({ tab, ...live }) => patch(tab, () => ({ live: live.message || live.tool ? live : undefined })));
  on('reported', r => set(s => ({ errors: [...s.errors, r].slice(-50) })));
  on('session', ({ tab, count }) => {
    patch(tab, () => ({ count, ended: false }));
    if (!get().tabs[tab].rows.length) void loadOlder(tab);
  });
  on('session-end', ({ tab }) => patch(tab, () => ({ ended: true, live: undefined })));
  // EventSource reconnects by itself; the next hello fills the gap.
  es.onerror = () => set({ connected: false });
}
