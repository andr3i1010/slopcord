import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ImageContent } from '@earendil-works/pi-ai';
import { StickerFormatType, type Message } from 'discord.js';

const run = promisify(execFile);
const FRAMES = 4;

/** Everything visual in a message, each with a URL view_media can open. */
export function media(m: Message) {
  return [
    ...m.attachments.map(a => ({ kind: 'attachment', name: a.name, type: a.contentType ?? undefined, url: a.url })),
    // GIF links (Tenor, Klipy, Giphy) put the real file in the embed; Discord's proxy copy works where the site blocks bots.
    ...m.embeds.flatMap(e => {
      const url = e.video?.proxyURL ?? e.video?.url ?? e.image?.proxyURL ?? e.image?.url ?? e.thumbnail?.proxyURL ?? e.thumbnail?.url;
      return url ? [{ kind: 'embed', name: e.title ?? e.provider?.name ?? undefined, url }] : [];
    }),
    ...m.stickers.filter(s => s.format !== StickerFormatType.Lottie).map(s => ({ kind: 'sticker', name: s.name, url: s.url })),
    ...[...m.content.matchAll(/<(a?):(\w+):(\d+)>/g)].map(([, animated, name, id]) =>
      ({ kind: 'emoji', name, url: `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}` })),
  ];
}

/** Images the model can see for a URL: the image itself, a few frames of a GIF or video, or the media behind a web page. */
export async function loadMedia(url: string, depth = 0): Promise<{ images: ImageContent[]; note: string }> {
  // GIF sites (Klipy) block ordinary clients but serve Discord's link unfurler, which is what we are doing here.
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const type = res.headers.get('content-type')?.split(';')[0].trim() ?? '';
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > 25 << 20) throw new Error('Media is over 25 MiB.');
  if (type === 'text/html' && depth === 0) {
    const meta = Object.fromEntries([...bytes.toString('utf8').matchAll(/<meta\s[^>]*>/gi)].flatMap(([tag]) => {
      const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(([, k, v]) => [k.toLowerCase(), v]));
      const key = attrs.property ?? attrs.name;
      return key && attrs.content ? [[key, attrs.content.replaceAll('&amp;', '&')]] : [];
    }));
    // Video first (GIF sites serve mp4), then the preview image (e.g. YouTube, whose og:video is another page).
    for (const key of ['og:video:secure_url', 'og:video:url', 'og:video', 'og:image', 'twitter:image']) {
      if (meta[key]) try { return await loadMedia(new URL(meta[key], url).href, 1); } catch {}
    }
  }
  if (type === 'image/gif' || type.startsWith('video/')) return frames(bytes, type);
  if (type.startsWith('image/')) return { images: [{ type: 'image', data: bytes.toString('base64'), mimeType: type }], note: type };
  throw new Error(`Not viewable media: ${type || 'unknown type'} at ${url}`);
}

// shortcut: frames only, the audio track is ignored; add transcription if voice messages or video audio matter.
async function frames(bytes: Buffer, type: string) {
  const dir = await mkdtemp(join(tmpdir(), 'slopcord-'));
  try {
    const input = join(dir, 'input');
    await writeFile(input, bytes);
    const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input]);
    const duration = Number.parseFloat(probe.stdout) || 0;
    await run('ffmpeg', [
      '-v', 'error', '-i', input,
      '-vf', `fps=${duration > 0 ? FRAMES / duration : 1},scale='trunc(min(768,iw)/2)*2':-2`,
      '-frames:v', String(FRAMES), join(dir, 'frame%d.jpg'),
    ], { timeout: 60_000 });
    const files = (await readdir(dir)).filter(f => f.endsWith('.jpg')).sort();
    const images = await Promise.all(files.map(async f => ({ type: 'image' as const, data: (await readFile(join(dir, f))).toString('base64'), mimeType: 'image/jpeg' })));
    return { images, note: `${type}${duration ? `, ${duration.toFixed(1)}s` : ''}: ${images.length} frame(s) spread over its length, no audio` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
