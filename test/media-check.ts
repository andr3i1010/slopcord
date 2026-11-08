// Real-world media through loadMedia, then one model call to prove the frames are actually seen.
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { config } from '../src/config.ts';
import { loadMedia } from '../src/media.ts';
import { makeSession } from '../src/pi.ts';

const urls = {
  'animated gif': 'https://upload.wikimedia.org/wikipedia/commons/2/2c/Rotating_earth_%28large%29.gif',
  'mp4 video': 'https://download.samplelib.com/mp4/sample-5s.mp4',
  'youtube page': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'discord png': 'https://cdn.discordapp.com/embed/avatars/0.png',
};
const loaded: Record<string, Awaited<ReturnType<typeof loadMedia>>> = {};
for (const [name, url] of Object.entries(urls)) {
  try {
    loaded[name] = await loadMedia(url);
    console.log(`${name}: ${loaded[name].note}, ${loaded[name].images.length} image(s), ${Math.round(loaded[name].images.reduce((n, i) => n + i.data.length, 0) / 1024)} KiB`);
  } catch (e) { console.log(`${name}: FAILED ${(e as Error).message}`); }
}
assert.ok(loaded['animated gif']?.images.length > 1, 'animated GIF should become several frames');

const session = await makeSession('Describe images briefly.', [], SessionManager.inMemory(config.dataDir));
await session.prompt('These are frames of one GIF. In one sentence: what is it?', { images: loaded['animated gif'].images, expandPromptTemplates: false });
console.log('model sees:', session.getLastAssistantText());
session.dispose();
process.exit(0);
