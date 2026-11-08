import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AssistantMessage, ImageContent } from '@earendil-works/pi-ai';
import { defineTool, SessionManager, type AgentSession, type AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { container } from '@sapphire/framework';
import { Type } from 'typebox';
import { chain, config, localTime, redact } from './config.ts';
import { memoryIndex, searchHistory, sessionsDir } from './memory.ts';
import { lastReply, makeSession, systemPrompt } from './pi.ts';
import { channel, describe, discordTools, fetchMessage, outgoing, text } from './tools.ts';
import { workerList, workerTools } from './workers.ts';

const STALL_MS = 3 * 60_000;
const IDLE_WAKE_MS = 4 * 3600_000;

type Pending = { channelId: string; messageId: string; delivered?: boolean };
type Wake = { at: number; why: string };

const file = (name: string) => resolve(config.dataDir, name);
function load<T>(name: string, fallback: T): T {
  try { return JSON.parse(readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
const save = (name: string, value: unknown) => writeFileSync(file(name), JSON.stringify(value));

let session: AgentSession;
/** Mentions and DMs that haven't been answered yet, persisted so a restart re-queues them. */
const pending = new Map<string, Pending>(load<Pending[]>('pending.json', []).map(p => [p.messageId, { ...p, delivered: false }]));
let wakes = load<Wake[]>('wakes.json', []);
let gate: Promise<unknown> = Promise.resolve();
let compacting: Promise<void> = Promise.resolve(), endCompaction = () => {}, compactingNow = false;
let lastActivity = Date.now(), runStarted = 0, lastTool = '', lastBatch = '', lastError = '', indexShown = '', nudged = false;
let failure: Error | undefined;
let sentTo = new Set<string>(), lastTarget: Pending | undefined;
const recentDms = new Map<string, number>();

const savePending = () => save('pending.json', [...pending.values()].map(({ channelId, messageId }) => ({ channelId, messageId })));

export function addPending(channelId: string, messageId: string) {
  pending.set(messageId, { channelId, messageId });
  savePending();
}

function take(ids: string[]) {
  const out = ids.flatMap(id => pending.get(id) ?? []);
  for (const p of out) pending.delete(p.messageId);
  savePending();
  return out;
}

function addWake(ms: number, why: string) {
  wakes.push({ at: Date.now() + ms, why });
  save('wakes.json', wakes);
}

/**
 * Hand events to the one brain. Pi's queue does the scheduling: idle starts a run, busy queues it
 * (`steer` lands after the current tool call, `followUp` after the run). The gate keeps two deliveries
 * from racing into two runs.
 */
export function deliver(lines: string, images: ImageContent[] = [], urgent = false, ids: string[] = [], target?: Pending) {
  gate = gate.then(async () => {
    await compacting;
    const index = memoryIndex();
    const memo = index === indexShown ? '' : `\n[memory index, read a note before relying on it]\n${index}`;
    indexShown = index;
    lastBatch = `[events · ${localTime()}]\n${lines}${memo}`;
    lastActivity = Date.now();
    await new Promise<void>(accepted => {
      session.prompt(lastBatch, {
        images, expandPromptTemplates: false, streamingBehavior: urgent ? 'steer' : 'followUp',
        preflightResult: () => {
          for (const id of ids) { const p = pending.get(id); if (p) p.delivered = true; }
          if (target) lastTarget = target;
          if (ids.length && target) typing(target.channelId);
          accepted();
        },
      }).catch(err => { void report(err, take(ids)); accepted(); });
    });
  }).catch(err => report(err));
}

function settle(aborted: boolean) {
  const last = lastReply(session);
  const errored = last && last.timestamp >= runStarted && last.stopReason === 'error';
  const err = failure ?? (errored ? new Error(last.errorMessage ?? 'model error') : aborted ? new Error('run aborted') : undefined);
  failure = undefined;
  const done = take([...pending.values()].filter(p => p.delivered).map(p => p.messageId));
  if (err) void report(err, done, errored ? last : undefined);
  else for (const p of done) void fetchMessage(p.channelId, p.messageId).then(m => m.reactions.resolve('👀')?.users.remove()).catch(() => {});
  // Final text is the answer: to a waiting ping, else in the channel of the latest messages. `-` means staying quiet.
  const said = !err && last && last.timestamp >= runStarted && last.stopReason === 'stop'
    ? last.content.flatMap(c => c.type === 'text' ? [c.text] : []).join('').trim() : '';
  const pinged = done.findLast(p => !sentTo.has(p.channelId));
  const target = pinged ?? (lastTarget && !sentTo.has(lastTarget.channelId) ? lastTarget : undefined);
  // Models narrate silence ("(stays quiet)", "*says nothing*") instead of returning nothing; a stage-direction line is never chat.
  const silent = /^[`'"]?-[`'"]?$/.test(said) || said.split('\n').some(line => /^[(*_[]+[^()*_[\]]{0,80}[)*_\]]+$/.test(line.trim()));
  if (said && !silent && target) void speak(said, target, !!pinged);
  lastTarget = undefined;
  sentTo = new Set();
  if (!wakes.some(w => w.at < Date.now() + IDLE_WAKE_MS)) addWake(IDLE_WAKE_MS, 'idle check-in: nothing else was scheduled');
  const usage = session.getContextUsage();
  if (!nudged && (usage?.percent ?? 0) > 75) {
    nudged = true;
    deliver(`[harness] Context is ${Math.round(usage!.percent!)}% full; older context will be summarized soon. Save anything worth keeping to notes/ now.`);
  }
}

function onEvent(e: AgentSessionEvent) {
  lastActivity = Date.now();
  if (e.type === 'agent_start') runStarted = lastActivity;
  else if (e.type === 'tool_execution_start') {
    lastTool = `${e.toolName} ${JSON.stringify(e.args)}`.slice(0, 4000);
    if (e.toolName === 'send') sentTo.add(e.args?.channelId);
  }
  else if (e.type === 'compaction_start') { compactingNow = true; compacting = new Promise(done => (endCompaction = done)); }
  else if (e.type === 'compaction_end') {
    endCompaction();
    compactingNow = false;
    indexShown = '';
    nudged = false;
    if (e.errorMessage && !e.willRetry) void report(new Error(`compaction failed: ${e.errorMessage}`));
  } else if (e.type === 'agent_settled') settle(e.aborted);
}

const typing = (channelId: string) => void channel(channelId).then(c => c.sendTyping()).catch(() => {});
export const isPending = (messageId: string) => pending.has(messageId);

/** Post the way a person would: separate thoughts as separate short messages, quoting only when the chat moved on. */
async function speak(said: string, target: Pending, pinged: boolean) {
  try {
    const c = await channel(target.channelId);
    said = redact(said);
    const thoughts = said.split(/\n\s*\n/);
    const chatty = thoughts.length <= 4 && !said.includes('```') && thoughts.every(t => t.length < 300);
    for (const [i, part] of (chatty ? thoughts.map(content => ({ content })) : outgoing(said)).entries()) {
      if (i) { await c.sendTyping(); await new Promise(r => setTimeout(r, Math.min(600 + part.content.length * 20, 3000))); }
      const quote = i === 0 && c.lastMessageId !== target.messageId;
      await c.send({ ...part, reply: quote ? { messageReference: target.messageId, failIfNotExists: false } : undefined });
    }
  } catch (error) { await report(error, pinged ? [target] : []); }
}

/** ⚠️ plus the full trace on the messages that were waiting; anything else goes to the owner's DMs. */
export async function report(err: unknown, targets: Pending[] = [], reply?: AssistantMessage) {
  const e = err instanceof Error ? err : new Error(String(err));
  lastError = `${localTime()}: ${e.message}`;
  console.error(e);
  const trace = redact([
    chain(e),
    reply && `provider response: ${JSON.stringify({ stopReason: reply.stopReason, rawStopReason: reply.rawStopReason, errorMessage: reply.errorMessage, usage: reply.usage })}`,
    `model: ${config.model} via ${config.baseUrl}`,
    `last tool call: ${lastTool || 'none'}`,
    `last events delivered:\n${lastBatch || 'none'}`,
  ].filter(Boolean).join('\n\n'));
  const message = { content: `⚠️ couldn't finish this: ${redact(e.message).slice(0, 300)}`, files: [{ attachment: Buffer.from(trace), name: 'error.txt' }] };
  try {
    if (!targets.length) {
      // An outage would otherwise DM the same error for every ambient batch.
      if (Date.now() - (recentDms.get(e.message) ?? 0) < 10 * 60_000) return;
      recentDms.set(e.message, Date.now());
      await (await container.client.users.fetch(config.ownerId)).send(message);
    }
    for (const p of targets) {
      const m = await fetchMessage(p.channelId, p.messageId);
      await m.reactions.resolve('👀')?.users.remove().catch(() => {});
      await m.react('⚠️').catch(() => {});
      await m.reply(message);
    }
  } catch (sendError) {
    console.error('Could not report the error on Discord:', sendError);
  }
}

function tick() {
  const now = Date.now();
  if (session.isStreaming) {
    const channels = new Set([...pending.values()].filter(p => p.delivered).map(p => p.channelId));
    for (const id of channels) typing(id);
    // Compaction is silent while it writes the summary, which can take minutes; that isn't a stall.
    if (now - lastActivity > STALL_MS && !failure && !compactingNow) {
      failure = new Error(`stalled: no model or tool activity for ${STALL_MS / 60_000} minutes`);
      void session.abort();
    }
  }
  const due = wakes.filter(w => w.at <= now);
  if (!due.length) return;
  wakes = wakes.filter(w => w.at > now);
  save('wakes.json', wakes);
  for (const w of due) deliver(JSON.stringify({ kind: 'wake', why: w.why }));
}

const wakeMe = defineTool({
  name: 'wake_me', label: 'Wake me',
  description: 'Schedule a wake-up for yourself: follow-ups, reminders, checking back on a channel. At that time you get a wake event with your note.',
  parameters: Type.Object({ minutes: Type.Number({ description: 'minutes from now, at least 1' }), why: Type.String({ description: 'note to your future self' }) }),
  async execute(_id, p) {
    addWake(Math.max(1, p.minutes) * 60_000, p.why);
    return text(`wake set for ${localTime(Date.now() + Math.max(1, p.minutes) * 60_000)}`);
  },
});

export async function start() {
  const me = container.client.user!;
  session = await makeSession(
    systemPrompt('brain', me),
    [...discordTools(false), wakeMe, searchHistory, ...workerTools(deliver)],
    SessionManager.continueRecent(config.dataDir, sessionsDir),
  );
  session.subscribe(onEvent);
  setInterval(tick, 8000);
  for (const p of [...pending.values()]) {
    const m = await fetchMessage(p.channelId, p.messageId).catch(() => undefined);
    if (m) deliver(describe(m, 'message', true), [], true, [m.id], p);
    else take([p.messageId]);
  }
}

export function status() {
  if (!session) return 'starting up';
  const usage = session.getContextUsage();
  return [
    `alive, up ${Math.round(process.uptime() / 60)} min`,
    session.isStreaming ? `working for ${Math.round((Date.now() - runStarted) / 1000)}s, last tool: ${lastTool.slice(0, 200) || 'none'}` : 'idle',
    `queued: ${session.pendingMessageCount} · unanswered mentions: ${pending.size}`,
    `workers: ${workerList().join('; ') || 'none'}`,
    `context: ${usage?.percent?.toFixed(0) ?? '?'}% of ${usage?.contextWindow ?? '?'} tokens`,
    `next wake: ${wakes.length ? localTime(Math.min(...wakes.map(w => w.at))) : 'none'}`,
    `last error: ${lastError || 'none'}`,
  ].join('\n');
}

export async function abort() {
  if (!session.isStreaming) return 'nothing is running';
  failure = new Error('aborted with /abort');
  await session.abort();
  return 'aborted';
}

export async function compact() {
  const result = await session.compact();
  return `compacted, summary is ${result.summary.length} chars`;
}
