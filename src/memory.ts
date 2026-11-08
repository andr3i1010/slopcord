import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { config } from './config.ts';
import { text } from './tools.ts';

export const notesDir = resolve(config.dataDir, 'notes');
export const sessionsDir = resolve(config.dataDir, 'sessions');
mkdirSync(notesDir, { recursive: true });
mkdirSync(sessionsDir, { recursive: true });

/** One line per note, like a skills listing: the model reads a full note only when its description fits. */
// shortcut: the whole index is re-sent whenever it changes; send diffs once notes pass ~200 files.
export function memoryIndex() {
  const files = readdirSync(notesDir, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.md')).sort();
  return files.map(f => {
    const description = /^description:\s*(.+)$/m.exec(readFileSync(join(notesDir, f), 'utf8').slice(0, 1000))?.[1];
    return `- notes/${f}: ${description ?? '(no description)'}`;
  }).join('\n') || '(no notes yet)';
}

/** Every string under `text` or `content` keys, skipping base64 image data. */
const texts = (v: unknown): string[] =>
  !v || typeof v !== 'object' ? [] : Array.isArray(v) ? v.flatMap(texts)
    : Object.entries(v).flatMap(([k, x]) => (k === 'text' || k === 'content') && typeof x === 'string' ? [x] : k === 'data' ? [] : texts(x));

export const searchHistory = defineTool({
  name: 'search_history', label: 'Search history',
  description: "Search the raw transcripts of everything you've seen, including what was summarized away. Newest first. Use when your notes don't cover it.",
  parameters: Type.Object({ query: Type.String(), limit: Type.Optional(Type.Number({ description: 'default 20' })) }),
  async execute(_id, p) {
    const q = p.query.toLowerCase(), hits: string[] = [];
    for (const file of readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl')).sort().reverse()) {
      for (const line of readFileSync(join(sessionsDir, file), 'utf8').split('\n').reverse()) {
        if (hits.length >= (p.limit ?? 20)) break;
        if (!line.toLowerCase().includes(q)) continue;
        const entry = JSON.parse(line);
        const all = texts(entry.message ?? entry).join('\n'), at = all.toLowerCase().indexOf(q);
        if (at >= 0) hits.push(`[${entry.timestamp ?? '?'} ${entry.message?.role ?? entry.type}] …${all.slice(Math.max(0, at - 300), at + 300)}…`);
      }
    }
    return text(hits.join('\n\n') || 'no matches');
  },
});
