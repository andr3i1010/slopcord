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

const noteFiles = () => readdirSync(notesDir, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.md')).sort();
const RULES_CAP = 1500;

/** One line per note, like a skills listing: the model reads a full note only when its description fits. */
// shortcut: the whole index is re-sent whenever it changes; send diffs once notes pass ~200 files.
export function memoryIndex() {
  return noteFiles().map(f => {
    const description = /^description:\s*(.+)$/m.exec(readFileSync(join(notesDir, f), 'utf8').slice(0, 1000))?.[1];
    return `- notes/${f}: ${description ?? '(no description)'}`;
  }).join('\n') || '(no notes yet)';
}

/**
 * The `## Rules` of every note whose frontmatter `applies:` names a server, channel or person in these events,
 * so a rule is in view when it matters instead of only when the model remembers to read its note.
 */
// shortcut: reads every note per batch; keep an index of `applies` once notes pass ~200 files.
export function rulesFor(events: string) {
  const ids = new Set([...events.matchAll(/"(?:id|channelId|guildId)":"(\d+)"/g)].map(m => m[1]));
  const found = noteFiles().flatMap(f => {
    const lines = readFileSync(join(notesDir, f), 'utf8').split('\n');
    const applies = /^applies:\s*\[?([^\]\n]*)/m.exec(lines.slice(0, 20).join('\n'))?.[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
    const start = lines.findIndex(l => /^## Rules\b/.test(l));
    if (!applies?.some(id => ids.has(id)) || start < 0) return [];
    const end = lines.findIndex((l, i) => i > start && l.startsWith('#'));
    const rules = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
    return rules ? [`notes/${f}:\n${rules}`] : [];
  }).join('\n');
  return found.length > RULES_CAP ? `${found.slice(0, RULES_CAP)}… [cut off: read those notes, and shorten their rules]` : found;
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
