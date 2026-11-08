// GIF site pages (what people paste, before Discord adds an embed) must load as frames.
import { loadMedia } from '../src/media.ts';
for (const url of ['https://klipy.com/gifs/drake-notebook-1', 'https://tenor.com/view/100-gif-26246178', 'https://giphy.com/gifs/cinema-absolute-absolutecinema-9EvnXdZaUZbCqScn67']) {
  try { const r = await loadMedia(url); console.log(`${new URL(url).host}: ${r.note}`); if (!r.images.length) process.exitCode = 1; }
  catch (e) { console.log(`${new URL(url).host}: FAILED ${(e as Error).message}`); process.exitCode = 1; }
}
