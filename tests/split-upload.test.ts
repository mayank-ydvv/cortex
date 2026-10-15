import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { MAX_REQUEST_BYTES, batchBySize, prepareUploads } from '../app/_components/split-upload';

const conversations = (n: number, pad = 2000) =>
  Array.from({ length: n }, (_, i) => ({ uuid: `c${i}`, name: `chat ${i}`, body: 'x'.repeat(pad) }));

describe('prepareUploads', () => {
  it('passes small files through untouched', async () => {
    const f = new File(['hello'], 'note.md');
    expect(await prepareUploads([f])).toEqual([f]);
  });

  it('splits a large JSON array into valid arrays under the limit, losing nothing', async () => {
    const all = conversations(3000);
    const big = new File([JSON.stringify(all)], 'conversations.json');
    expect(big.size).toBeGreaterThan(MAX_REQUEST_BYTES);

    const parts = await prepareUploads([big]);
    expect(parts.length).toBeGreaterThan(1);
    const rejoined: unknown[] = [];
    for (const p of parts) {
      expect(p.size).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
      rejoined.push(...(JSON.parse(await p.text()) as unknown[]));
    }
    expect(rejoined).toEqual(all);
  });

  it('opens a large zip and splits the conversations inside it', async () => {
    const all = conversations(3000, 3000);
    const zip = zipSync({ 'export/conversations.json': strToU8(JSON.stringify(all)), 'export/users.json': strToU8('[]') }, { level: 0 });
    const parts = await prepareUploads([new File([zip as Uint8Array<ArrayBuffer>], 'data.zip')]);
    const rejoined: unknown[] = [];
    for (const p of parts) rejoined.push(...(JSON.parse(await p.text()) as unknown[]));
    expect(rejoined).toHaveLength(3000);
  });

  it('refuses a large file it cannot split, with a readable reason', async () => {
    const pdf = new File([new Uint8Array(MAX_REQUEST_BYTES + 10)], 'scan.pdf');
    await expect(prepareUploads([pdf])).rejects.toThrow(/scan\.pdf/);
  });
});

describe('batchBySize', () => {
  it('groups files so no request exceeds the limit', () => {
    const third = Math.floor(MAX_REQUEST_BYTES / 3);
    const files = Array.from({ length: 7 }, (_, i) => new File([new Uint8Array(third)], `${i}.md`));
    const batches = batchBySize(files);
    expect(batches.flat()).toHaveLength(7);
    for (const b of batches) expect(b.reduce((s, f) => s + f.size, 0)).toBeLessThanOrEqual(MAX_REQUEST_BYTES);
  });
});
