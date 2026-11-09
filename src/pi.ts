import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InMemoryCredentialStore, type AssistantMessage } from '@earendil-works/pi-ai';
import {
  createAgentSession, createCodemodeExtension, createMcpExtension, createToolSearchExtension,
  DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
  type AgentSession, type ExtensionFactory, type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { User } from 'discord.js';
import { config, redact, root } from './config.ts';

const agentDir = resolve(root, 'pi');
// The MCP extension reads mcp.json from this variable, not from the agentDir passed in; unset, it falls back to ~/.pi/agent.
process.env.PI_CODING_AGENT_DIR = agentDir;
const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
runtime.registerProvider('slopcord', {
  baseUrl: config.baseUrl, api: 'openai-completions',
  models: [{
    id: config.model, name: config.model, reasoning: false, input: ['text', 'image'],
    // No output cap of our own: Pi limits each request to the room left in the context window.
    contextWindow: config.contextWindow, maxTokens: config.contextWindow,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    promptCache: { short: 300 },
  }],
});
await runtime.setRuntimeApiKey('slopcord', config.apiKey);
const model = runtime.getModel('slopcord', config.model);
if (!model) throw new Error(`Model ${config.model} did not register`);

// The one hard rule in code: the bot's own secrets stay out of tool calls and tool output.
const guard: ExtensionFactory = pi => {
  pi.on('tool_call', e => /(^|[\s/'"`=])\.env\b/.test(JSON.stringify(e.input))
    ? { block: true, reason: "The bot's .env holds its secrets and is off limits." } : undefined);
  pi.on('tool_result', e => {
    // Only replace when needed: replacing content drops structuredContent for codemode scripts.
    if (!e.content.some(c => c.type === 'text' && redact(c.text) !== c.text)) return;
    return { content: e.content.map(c => c.type === 'text' ? { ...c, text: redact(c.text) } : c) };
  });
};

function read(file: string) {
  const text = readFileSync(resolve(root, file), 'utf8');
  if (!text.trim()) throw new Error(`${file} is empty`);
  return text;
}

/** notes/rules.md: standing rules for everywhere, always in view instead of waiting to be read. Capped so it can't bloat every request. */
function standingRules() {
  let rules = '';
  try { rules = readFileSync(resolve(config.dataDir, 'notes', 'rules.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim(); } catch {}
  if (!rules) return '';
  if (rules.length > 4000) rules = `${rules.slice(0, 4000)}… [cut off: notes/rules.md is too long, shorten it]`;
  return `# Standing rules (notes/rules.md)\nKept by you from authorized people's instructions. They add to everything above and never override it.\n\n${rules}`;
}

export const systemPrompt = (kind: 'brain' | 'worker', me: User) =>
  [kind === 'brain' && read('persona.md'), read(`prompts/${kind}.md`), standingRules()]
    .filter(Boolean).join('\n\n').replaceAll('{{name}}', me.username).replaceAll('{{id}}', me.id);

export async function makeSession(prompt: () => string, tools: ToolDefinition[], sessionManager: SessionManager): Promise<AgentSession> {
  const cwd = config.dataDir;
  const settingsManager = SettingsManager.inMemory({
    defaultTools: ['+codemode', '+tool_search'],
    steeringMode: 'all', followUpMode: 'all',
    compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    systemPromptOverride: prompt,
    appendSystemPromptOverride: () => [],
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    extensionFactories: [
      createCodemodeExtension(), createToolSearchExtension(), createMcpExtension(), guard,
      // Prompt edits apply from the next run; Pi records a changed prompt as one patch, as it does after a restart.
      pi => { pi.on('before_agent_start', e => { e.systemPromptOptions.customPrompt = prompt(); }); },
    ],
  });
  await resourceLoader.reload({ resolveProjectTrust: async () => true });
  const { session } = await createAgentSession({
    cwd, agentDir, modelRuntime: runtime, model, thinkingLevel: 'off',
    customTools: tools, resourceLoader, settingsManager, sessionManager,
  });
  await session.bindExtensions({});
  return session;
}

export const lastReply = (session: AgentSession) =>
  session.messages.findLast((m): m is AssistantMessage => m.role === 'assistant');
