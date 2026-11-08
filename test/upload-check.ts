// Multipart uploads must survive Pi's global Undici swap, and the secret scan must see through a .tgz of the repo.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { REST, Routes } from 'discord.js';
import { config, leaksSecret, root } from '../src/config.ts';
import '../src/pi.ts'; // installs Pi's dispatcher, as in the bot

const upload = (rest: REST) => rest.setToken(config.token)
  .post(Routes.channelMessages('1'), { body: { content: 'x' }, files: [{ name: 'a.txt', data: Buffer.from('x') }] })
  .then(() => 'sent?!', (e: Error) => e.message);

const broken = await upload(new REST());
const fixed = await upload(new REST({ makeRequest: fetch as never }));
console.log('default REST:', broken);
console.log('fetch REST:  ', fixed);
assert.doesNotMatch(fixed, /FormData/, 'upload still fails client-side');

const tgz = execFileSync('tar', ['czf', '-', '-C', root, '.env', 'src']);
assert.ok(!tgz.includes(config.token) && leaksSecret(gunzipSync(tgz)), 'secret scan misses a .tgz of the repo');
console.log('upload check OK');
