import type { Live, Row } from './store.ts';

type Entry = Row['entry'];
export type Line = { label: string; text: string; tone?: 'error' | 'dim' | 'tool' | 'say' };

const json = (v: unknown) => JSON.stringify(v, null, 2);

/** Text parts of message content as one string; images are already placeholders from the server. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content === undefined ? '' : json(content);
  // Tool calls are listed separately by describe(); thinking stays out of the console.
  return content.map((c: any) => c.type === 'text' ? c.text : c.type === 'image' ? c.data : c.type === 'thinking' || c.type === 'toolCall' ? '' : json(c)).filter(Boolean).join('\n');
}

/** One console line for a session entry: a short label and the full text (CSS cuts it to one line until expanded). */
export function describe(entry: Entry): Line {
  if (entry.type === 'compaction') return { label: 'compact', text: entry.summary, tone: 'dim' };
  if (entry.type !== 'message') return { label: entry.type, text: json({ ...entry, id: undefined, parentId: undefined, timestamp: undefined, type: undefined }), tone: 'dim' };
  const m = entry.message as any;
  if (m.role === 'assistant') {
    if (m.stopReason === 'error' || m.stopReason === 'aborted') return { label: m.stopReason, text: m.errorMessage ?? '', tone: 'error' };
    const calls = m.content.filter((c: any) => c.type === 'toolCall');
    const said = textOf(m.content);
    return calls.length && !said.trim()
      ? { label: 'call', text: calls.map((c: any) => `${c.name} ${json(c.arguments)}`).join('\n'), tone: 'tool' }
      : { label: 'out', text: [said, ...calls.map((c: any) => `→ ${c.name} ${json(c.arguments)}`)].join('\n'), tone: 'say' };
  }
  if (m.role === 'toolResult') return { label: m.toolName ?? 'result', text: textOf(m.content), tone: m.isError ? 'error' : undefined };
  if (m.role === 'user') return { label: 'in', text: textOf(m.content) };
  return { label: m.role ?? 'message', text: textOf(m.content ?? m), tone: 'dim' };
}

export function describeLive(live: Live): Line {
  if (live.tool) return { label: live.tool.name, text: textOf((live.tool.output as any)?.content ?? live.tool.output), tone: 'tool' };
  return describe({ type: 'message', message: live.message } as Entry);
}

export const clock = (ms: number | string) => new Date(ms).toLocaleTimeString([], { hour12: false });
export const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};
