import { resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..');

// Loaded at runtime rather than with --env-file, so the secrets never appear in /proc/<pid>/environ.
try { process.loadEnvFile(resolve(root, '.env')); } catch {}

function env(key: string, fallback?: string) {
  const value = process.env[key]?.trim() || fallback;
  if (value === undefined) throw new Error(`Set ${key} in .env`);
  return value;
}

const ownerId = env('DISCORD_OWNER_ID');
export const config = {
  token: env('DISCORD_TOKEN'),
  ownerId,
  authorized: new Set([ownerId, ...env('DISCORD_ALLOWED_USER_IDS', '').split(',').map(id => id.trim()).filter(Boolean)]),
  baseUrl: env('AI_BASE_URL').replace(/\/+$/, ''),
  model: env('AI_MODEL'),
  apiKey: env('AI_API_KEY'),
  contextWindow: Number(env('AI_CONTEXT_WINDOW', '131072')),
  dataDir: resolve(root, env('DATA_DIR', 'data')),
  timeZone: env('TZ', 'Europe/Amsterdam'),
};
// Child processes (the model's shell) inherit process.env; keep the secrets out of it.
delete process.env.DISCORD_TOKEN;
delete process.env.AI_API_KEY;

const secrets = [config.token, config.apiKey];
export const leaksSecret = (bytes: Buffer) => secrets.some(secret => bytes.includes(secret));
export const redact = (text: string) => secrets.reduce((out, secret) => out.replaceAll(secret, '[redacted]'), text);

/** Full stack trace including the `cause` chain. */
export function chain(error: unknown) {
  const parts: string[] = [];
  for (let e: any = error; e; e = e.cause) parts.push(e.stack ?? String(e));
  return parts.join('\n--- caused by ---\n');
}

export const localTime = (ms = Date.now()) => new Intl.DateTimeFormat('en-GB', {
  timeZone: config.timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
}).format(ms);
