import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { readArchive } from '../src/ingest/archive';
import { ExportFetchError, assertAllowedHost } from '../src/ingest/fetch-export';

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

describe('readArchive', () => {
  it('decodes JSON entries and leaves binary ones alone', () => {
    const a = readArchive(zip({ 'conversations.json': '[{"a":1}]', 'logo.png': 'notreallypng' }));
    expect(a.entries.find((e) => e.name === 'conversations.json')?.text).toBe('[{"a":1}]');
    expect(a.entries.find((e) => e.name === 'logo.png')?.text).toBeUndefined();
  });

  it('picks the entry named like conversations over a larger unrelated one', () => {
    const a = readArchive(zip({
      'users.json': JSON.stringify({ padding: 'x'.repeat(5000) }),
      'conversations.json': '[{"small":true}]',
    }));
    expect(a.conversations?.name).toBe('conversations.json');
  });

  it('falls back to the largest JSON when nothing is named conversations', () => {
    const a = readArchive(zip({
      'small.json': '{"a":1}',
      'big.json': JSON.stringify({ padding: 'y'.repeat(4000) }),
    }));
    expect(a.conversations?.name).toBe('big.json');
  });

  it('ignores macOS resource forks and dotfiles', () => {
    const a = readArchive(zip({
      '__MACOSX/._conversations.json': 'junk',
      '.DS_Store': 'junk',
      'conversations.json': '[]',
    }));
    expect(a.entries.map((e) => e.name)).toEqual(['conversations.json']);
  });

  it('reports no conversations when the archive holds no JSON', () => {
    const a = readArchive(zip({ 'readme.txt': 'hello' }));
    expect(a.conversations).toBeNull();
  });
});

describe('assertAllowedHost', () => {
  // The URL comes from an uploaded file, so this is the boundary that stops an
  // arbitrary upload pointing the server at an arbitrary host.
  it.each([
    'https://claude.ai/export/abc/download/def',
    'https://chatgpt.com/export/x',
  ])('allows a known export host: %s', (u) => {
    expect(() => assertAllowedHost(u)).not.toThrow();
  });

  it.each([
    ['https://evil.example.com/steal', 'arbitrary external host'],
    ['https://127.0.0.1/admin', 'loopback'],
    ['https://169.254.169.254/latest/meta-data/', 'cloud metadata endpoint'],
    ['https://claude.ai.evil.com/x', 'lookalike domain'],
  ])('refuses %s (%s)', (u) => {
    expect(() => assertAllowedHost(u)).toThrow(ExportFetchError);
  });

  it('refuses non-HTTPS even on an allowed host', () => {
    expect(() => assertAllowedHost('http://claude.ai/export/x')).toThrow(/HTTPS/i);
  });

  it('refuses a malformed URL', () => {
    expect(() => assertAllowedHost('not a url')).toThrow(ExportFetchError);
  });
});
