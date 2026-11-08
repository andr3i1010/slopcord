// Do the MCP servers from pi/mcp.json connect and expose their tools?
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { config } from '../src/config.ts';
import { makeSession } from '../src/pi.ts';

const session = await makeSession('test', [], SessionManager.inMemory(config.dataDir));
for (let s = 0; s <= 15; s++) {
  const mcp = session.getActiveToolNames().filter(t => t.startsWith('mcp__'));
  if (mcp.length || s === 15) { console.log(`${s}s:`, mcp.join(', ') || 'no MCP tools'); break; }
  await new Promise(r => setTimeout(r, 1000));
}
session.dispose();
process.exit(0);
