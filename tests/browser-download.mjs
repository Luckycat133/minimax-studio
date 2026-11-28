import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/** Click the actual attachment without exempting blob fetches from page CSP. */
export async function downloadStudioAudio(page, expectedFilename) {
  const link = await page.$eval('.audio-download', a => ({ href: a.href, download: a.download }));
  assert.ok(link.href.startsWith('blob:'));
  assert.equal(link.download, expectedFilename);
  const directory = await mkdtemp(join(tmpdir(), 'minimax-browser-download-'));
  const client = await page.createCDPSession();
  try {
    await client.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: directory});
    await page.click('.audio-download');
    for (let i = 0; i < 100; i++) {
      try { return await readFile(join(directory, expectedFilename)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await sleep(50);
    }
    throw new Error('Browser WAV download did not complete');
  } finally {
    await client.detach();
    await rm(directory, {recursive:true,force:true});
  }
}
