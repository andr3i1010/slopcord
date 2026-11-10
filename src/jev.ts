import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { config } from './config.ts';
import { noteFiles, notesDir } from './memory.ts';

const THRESHOLD = 0.5, TOP = 8, CAP = 1500, TIMEOUT_MS = 3000;

type Scorer = (state: unknown, questions: Record<string, object>) => Promise<Record<string, number>>;

/** Every `- ` bullet in the notes outside archive/ and `## History`, labelled `note › heading`. */
export function memories() {
  const out: string[] = [];
  for (const file of noteFiles().filter(f => f.split(/[\\/]/)[0] !== 'archive')) {
    let heading = '', history = false, frontmatter = false;
    readFileSync(join(notesDir, file), 'utf8').split('\n').forEach((line, i) => {
      if (line === '---' && (i === 0 || frontmatter)) return void (frontmatter = i === 0);
      if (frontmatter) return;
      const h = /^#{1,6}\s+(.+)/.exec(line);
      if (h) return void ([heading, history] = [h[1].trim(), /^history\b/i.test(h[1].trim())]);
      const bullet = /^\s*- (.+)/.exec(line);
      if (bullet && !history) out.push(`${file.replace(/\.md$/, '')}${heading ? ` › ${heading}` : ''}: ${bullet[1].trim()}`);
    });
  }
  return out;
}

/** Jev (TypeSafe's System One, through the AI proxy): one yes/no probability per question. */
// shortcut: assumes AI_BASE_URL is the Hack Club proxy, which serves Jev under /jev; give Jev its own URL if the chat provider changes.
const jev: Scorer = async (state, questions) => {
  const res = await fetch(`${config.baseUrl}/jev/systemone`, {
    method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions }),
  });
  if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { answers } = await res.json() as { answers: Record<string, { noul: number }> };
  return Object.fromEntries(Object.entries(answers).map(([id, a]) => [id, a.noul]));
};

/**
 * The memories Jev rates as useful for this draft in this conversation, best first, as lines for the model.
 * '' when none reach the threshold, and also when Jev fails or is slow: memory must never block the bot.
 */
export async function recall(conversation: string, draft: object, score: Scorer = jev) {
  try {
    const all = memories();
    if (!all.length) return '';
    const questions = Object.fromEntries(all.map((m, i) => [`m${i}`, {
      type: 'noul', instructions: `Is this memory useful for the bot when sending the draft message in this conversation? Memory: ${m}`,
    }]));
    const scores = await score({ conversation, draft }, questions);
    const picked = all.map((m, i) => ({ m, p: scores[`m${i}`] ?? 0 })).filter(x => x.p >= THRESHOLD).sort((a, b) => b.p - a.p).slice(0, TOP);
    let out = '';
    for (const { m } of picked) {
      if (out.length + m.length + 3 > CAP) break;
      out += `- ${m}\n`;
    }
    return out.trimEnd();
  } catch (error) {
    console.error('memory recall skipped:', error);
    return '';
  }
}

/** Holds back a run's first `send` while Jev picks the memories that may apply to it, and gives those to the model. */
export function memoryGate(conversation: () => string, score: Scorer = jev) {
  let gated = false;
  const extension: ExtensionFactory = pi => {
    pi.on('tool_call', async e => {
      if (e.toolName !== 'send' || gated) return;
      gated = true;
      const { channelId, replyTo, text } = e.input as { channelId?: string; replyTo?: string; text?: string };
      const found = await recall(conversation(), { channelId, replyTo, text }, score);
      if (found) return { block: true, reason: `Not sent yet. Before you send, these memories may apply:\n${found}\nSend again, adjusted if they change anything.` };
    });
  };
  return { extension, newRun: () => { gated = false; } };
}
