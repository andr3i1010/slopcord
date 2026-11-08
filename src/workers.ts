import type { ImageContent } from '@earendil-works/pi-ai';
import { defineTool, SessionManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import { container } from '@sapphire/framework';
import { Type } from 'typebox';
import { chain, config, redact } from './config.ts';
import { lastReply, makeSession, systemPrompt } from './pi.ts';
import { discordTools, text } from './tools.ts';

type Worker = { task: string; started: number; session?: AgentSession; answer?: (reply: string) => void };
type Deliver = (lines: string, images?: ImageContent[], urgent?: boolean) => void;

const workers = new Map<string, Worker>();
let seq = 0;

export const workerList = () =>
  [...workers].map(([id, w]) => `${id} (${Math.round((Date.now() - w.started) / 1000)}s): ${w.task.slice(0, 80)}`);

function get(id: string) {
  const w = workers.get(id);
  if (!w) throw new Error(`No running worker ${id}.`);
  return w;
}

/** Tools for the brain; each worker gets its own ask_brain/tell_brain bound to its id. */
export function workerTools(deliver: Deliver) {
  const tell = (event: object, urgent = false) => deliver(JSON.stringify(event), [], urgent);

  const workerSide = (id: string) => [
    defineTool({
      name: 'ask_brain', label: 'Ask brain', description: 'Ask the bot that gave you this task a question and wait for the answer. Use when blocked on a decision.',
      parameters: Type.Object({ question: Type.String() }),
      async execute(_id, p, signal) {
        const w = get(id);
        tell({ kind: 'worker_question', worker: id, question: p.question }, true);
        const reply = await new Promise<string>(done => {
          const timer = setTimeout(() => done('(no answer after 10 minutes; use your best judgment)'), 600_000);
          w.answer = r => { clearTimeout(timer); done(r); };
          signal?.addEventListener('abort', () => w.answer?.('(aborted)'));
        });
        w.answer = undefined;
        return text(reply);
      },
    }),
    defineTool({
      name: 'tell_brain', label: 'Tell brain', description: 'Send the bot a progress note or finding without waiting.',
      parameters: Type.Object({ note: Type.String() }),
      async execute(_id, p) { tell({ kind: 'worker_note', worker: id, note: p.note }); return text('sent'); },
    }),
  ];

  return [
    defineTool({
      name: 'delegate', label: 'Delegate',
      description: 'Hand a longer task to a background worker so you stay responsive. It has your tools except posting to Discord. Write a self-contained brief; its report arrives as a worker_done event.',
      parameters: Type.Object({ task: Type.String() }),
      async execute(_id, p) {
        const id = `w${++seq}`, w: Worker = { task: p.task, started: Date.now() };
        workers.set(id, w);
        void (async () => {
          try {
            w.session = await makeSession(systemPrompt('worker', container.client.user!), [...discordTools(true), ...workerSide(id)], SessionManager.inMemory(config.dataDir));
            await w.session.prompt(p.task, { expandPromptTemplates: false });
            const last = lastReply(w.session);
            if (last?.stopReason === 'error' || last?.stopReason === 'aborted') throw new Error(last.errorMessage ?? last.stopReason);
            tell({ kind: 'worker_done', worker: id, report: w.session.getLastAssistantText() ?? '(no report)' });
          } catch (e) {
            tell({ kind: 'worker_failed', worker: id, error: redact(chain(e)) });
          } finally {
            workers.delete(id);
            w.session?.dispose();
          }
        })();
        return text(`started worker ${id}`);
      },
    }),
    defineTool({
      name: 'message_worker', label: 'Message worker', description: "Answer a worker's question, or steer a running worker with new instructions.",
      parameters: Type.Object({ worker: Type.String(), text: Type.String() }),
      async execute(_id, p) {
        const w = get(p.worker);
        if (w.answer) w.answer(p.text);
        else if (w.session) await w.session.steer(p.text);
        else throw new Error(`Worker ${p.worker} is still starting.`);
        return text('delivered');
      },
    }),
    defineTool({
      name: 'stop_worker', label: 'Stop worker', description: 'Abort a running worker.',
      parameters: Type.Object({ worker: Type.String() }),
      async execute(_id, p) { await get(p.worker).session?.abort(); return text('stopping'); },
    }),
  ];
}
