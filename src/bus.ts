import { EventEmitter } from 'node:events';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

export type Reported = { time: number; message: string; trace: string };

/** What the dashboard watches: sessions coming and going (`brain`, worker ids) and errors report() handled. */
// Not 'error': an unlistened 'error' event throws.
export const bus = new EventEmitter<{
  session: [tab: string, session: AgentSession];
  'session-end': [tab: string];
  reported: [Reported];
}>();
