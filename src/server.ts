import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AgentSession, SessionEntry, SessionMessageEntry } from '@earendil-works/pi-coding-agent';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { container } from '@sapphire/framework';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import { validator } from 'hono/validator';
import * as brain from './brain.ts';
import { bus, type Reported } from './bus.ts';
import { config, redact, root } from './config.ts';
import { noteFiles, notesDir } from './memory.ts';
import { messageWorker, stopWorker } from './workers.ts';

// Orchard's service for slopcord-git points at this port.
const PORT = 8080;
const MAX_PAGE = 500;
// shortcut: no login of its own; Orchard's protection guards the domain, but the bot's own shell (curl localhost) and
// pods in the same namespace (chromium) reach it directly. Fine while that shell runs as root and can rewrite the bot anyway;
// add a login here once it doesn't.

type Message = SessionMessageEntry['message'];
type Live = { message?: Message; tool?: { name: string; args: unknown; output: unknown } };
/** Everything /api/events sends, by SSE event name. */
export type Events = {
  hello: ReturnType<typeof hello>;
  status: ReturnType<typeof brain.state>;
  entry: { tab: string; index: number; entry: SessionEntry };
  /** The message or tool output being written right now; neither means it just finished. */
  partial: { tab: string } & Live;
  reported: Reported;
  session: { tab: string; count: number };
  'session-end': { tab: string };
};

/** JSON for the browser: base64 images become a size note, and the bot's secrets are redacted. */
const scrub = (value: unknown) => redact(JSON.stringify(value, function (this: any, key, v) {
  return key === 'data' && this?.type === 'image' && typeof v === 'string' ? `[image · ${Math.round(v.length * 0.75 / 1024)} KB]` : v;
}));
const clean = <T>(value: T): T => JSON.parse(scrub(value));

const watching = new Map<string, { session: AgentSession; stop: () => void }>();
const clients = new Set<(event: string, data: string) => void>();
function broadcast<K extends keyof Events>(event: K, value: Events[K]) {
  if (!clients.size) return;
  const data = scrub(value);
  for (const send of clients) send(event, data);
}

const hello = () => ({
  status: brain.state(),
  errors: brain.errors,
  /** Entry count per tab; the client pages history below it and gets newer entries as `entry` events. */
  sessions: Object.fromEntries([...watching].map(([tab, w]) => [tab, w.session.sessionManager.getEntryCount()])),
});

/** Stream a session's new entries and, at most every 100 ms, what it's writing right now. */
function watch(tab: string, session: AgentSession) {
  const entries = session.sessionManager;
  let sent = entries.getEntryCount(), live: Live | undefined, timer: NodeJS.Timeout | undefined;
  const flushEntries = () => {
    if (entries.getEntryCount() === sent) return;
    const all = entries.getEntries();
    for (; sent < all.length; sent++) broadcast('entry', { tab, index: sent, entry: all[sent] });
  };
  const flushLive = () => { timer = undefined; broadcast('partial', { tab, ...live }); };
  const stop = session.subscribe(e => {
    try {
      if (e.type === 'message_update') live = { message: e.message };
      else if (e.type === 'tool_execution_update') live = { tool: { name: e.toolName, args: e.args, output: e.partialResult } };
      else {
        if (e.type === 'message_end' || e.type === 'tool_execution_end') {
          clearTimeout(timer);
          timer = live = undefined;
          broadcast('partial', { tab });
        }
        // Pi saves a message right after its message_end listeners run.
        return void setImmediate(flushEntries);
      }
      timer ??= setTimeout(flushLive, 100);
    } catch (error) { console.error('dashboard:', error); }
  });
  watching.set(tab, { session, stop });
  broadcast('session', { tab, count: sent });
}

function unwatch(tab: string) {
  watching.get(tab)?.stop();
  watching.delete(tab);
  broadcast('session-end', { tab });
}

const sessionOf = (tab: string) => {
  const session = watching.get(tab)?.session;
  if (!session) throw new HTTPException(404, { message: `no session ${tab}` });
  return session;
};

/** A JSON body check: `check` returns the parsed fields, or nothing for a 400. */
const body = <T>(check: (b: any) => T | undefined) =>
  validator('json', (b, c) => check(b ?? {}) ?? c.json({ error: 'bad request body' }, 400));
const tabBody = body(b => typeof b.tab === 'string' ? { tab: b.tab as string } : undefined);

async function restart() {
  // Kubernetes starts the pod again, which is also the way back after brain.ts shut the bot down.
  await container.client.destroy().catch(() => {});
  process.exit(0);
}

const api = new Hono().basePath('/api')
  // Same-origin only; JSON bodies already need a CORS preflight that nothing here answers.
  .use(csrf())
  .get('/events', c => streamSSE(c, async stream => {
    let queue = Promise.resolve();
    const send = (event: string, data: string) => { queue = queue.then(() => stream.writeSSE({ event, data })); };
    send('hello', scrub(hello()));
    clients.add(send);
    // Proxies close streams that stay quiet.
    const ping = setInterval(() => send('ping', ''), 20_000);
    await new Promise<void>(done => stream.onAbort(done));
    clearInterval(ping);
    clients.delete(send);
  }))
  .get('/sessions/:tab/entries', validator('query', (q, c) => {
    const from = Number(q.from), to = Number(q.to);
    return Number.isInteger(from) && Number.isInteger(to) && from >= 0 ? { from, to: Math.min(to, from + MAX_PAGE) } : c.json({ error: 'from and to are entry indices' }, 400);
  }), c => {
    const { from, to } = c.req.valid('query'), all = sessionOf(c.req.param('tab')).sessionManager.getEntries();
    // unknown[]: Hono's JSON typing of Pi's entry union is too deep for tsc; the client reads them as Events['entry'].
    const entries: unknown[] = clean(all.slice(from, to).map((entry, i) => ({ index: from + i, entry })));
    return c.json({ count: all.length, entries });
  })
  .get('/notes', c => c.json(noteFiles()))
  .get('/note', validator('query', (q, c) =>
    // Only files the listing shows, so no path can step out of notes/.
    typeof q.path === 'string' && noteFiles().includes(q.path) ? { path: q.path } : c.json({ error: 'no such note' }, 404)), c =>
    c.json({ text: redact(readFileSync(join(notesDir, c.req.valid('query').path), 'utf8')) }))
  .post('/interject', body(b => typeof b.tab === 'string' && typeof b.text === 'string' && b.text.trim() ? { tab: b.tab as string, text: b.text as string } : undefined), async c => {
    const { tab, text } = c.req.valid('json');
    if (tab === 'brain') brain.interject(text);
    else await messageWorker(tab, `[your owner, from the dashboard] ${text}`);
    return c.json({ result: 'sent' });
  })
  .post('/abort', tabBody, async c => {
    const { tab } = c.req.valid('json');
    return c.json({ result: tab === 'brain' ? await brain.abort() : (await stopWorker(tab), 'stopping') });
  })
  .post('/compact', async c => c.json({ result: await brain.compact() }))
  .post('/restart', c => { setTimeout(restart, 100); return c.json({ result: 'restarting' }); })
  .delete('/wakes/:at', c => { brain.deleteWake(Number(c.req.param('at'))); return c.json({ result: 'deleted' }); })
  .delete('/pending/:id', c => { brain.dropPending(c.req.param('id')); return c.json({ result: 'dropped' }); });

export type AppType = typeof api;

const dist = resolve(root, 'web/dist');
const app = new Hono()
  .route('/', api)
  .all('/api/*', c => c.json({ error: 'not found' }, 404))
  .use('*', serveStatic({ root: dist }))
  .get('*', serveStatic({ path: resolve(dist, 'index.html') }))
  .onError((err, c) => err instanceof HTTPException ? err.getResponse() : c.json({ error: redact(err.message) }, 500));

/** Listen before Discord logs in, so the dashboard (and its restart button) works even when the bot doesn't. */
export function start() {
  bus.on('session', watch);
  bus.on('session-end', unwatch);
  bus.on('reported', r => broadcast('reported', r));
  let last = '';
  setInterval(() => {
    if (!clients.size) return;
    const s = scrub(brain.state());
    if (s === last) return;
    last = s;
    for (const send of clients) send('status', s);
  }, 1000);
  serve({ fetch: app.fetch, port: PORT, hostname: config.dashboardHost }, () => console.info(`Dashboard on http://${config.dashboardHost}:${PORT}`))
    // A dashboard that can't listen must not take the bot down with it.
    .on('error', error => console.error('dashboard:', error));
}
