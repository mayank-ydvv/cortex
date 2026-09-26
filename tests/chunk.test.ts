import { describe, expect, it } from 'vitest';
import { chunkMessages, splitText } from '../src/ingest/chunk';
import { MAX_INPUT_TOKENS, estimateTokens } from '../src/ingest/embed';
import type { ParsedMessage } from '../src/ingest/parsers/types';

const START = new Date('2026-09-01T10:00:00.000Z');
const LATER = new Date('2026-09-01T10:05:00.000Z');

const msg = (
  role: 'user' | 'assistant',
  content: string,
  occurredAt: Date | null = LATER,
): ParsedMessage => ({ role, content, occurredAt });

describe('splitText', () => {
  it('leaves text that already fits untouched', () => {
    expect(splitText('short enough', 400)).toEqual(['short enough']);
  });

  it('splits on paragraph boundaries first', () => {
    const para = 'x'.repeat(900); // ~300 tokens
    const pieces = splitText(`${para}\n\n${para}`, 400);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toBe(para);
  });

  it('packs several small paragraphs together rather than one chunk each', () => {
    const p = 'y'.repeat(300); // ~100 tokens
    const pieces = splitText([p, p, p, p, p, p].join('\n\n'), 400);
    expect(pieces.length).toBeLessThan(6);
    for (const piece of pieces) expect(estimateTokens(piece)).toBeLessThanOrEqual(400);
  });

  it('falls back to sentence boundaries inside an oversized paragraph', () => {
    const sentence = `${'z'.repeat(500)}. `; // ~167 tokens each
    const pieces = splitText(sentence.repeat(5), 400);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(estimateTokens(piece)).toBeLessThanOrEqual(400);
  });

  it('never emits a piece over the model input limit', () => {
    // One unbroken "sentence" far longer than the limit, with no boundaries at all.
    const monster = 'q'.repeat(20_000);
    for (const piece of splitText(monster, 400)) {
      expect(estimateTokens(piece)).toBeLessThanOrEqual(MAX_INPUT_TOKENS);
    }
  });

  it('loses no content when splitting', () => {
    const text = ['alpha'.repeat(200), 'beta'.repeat(200), 'gamma'.repeat(200)].join('\n\n');
    expect(splitText(text, 400).join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  });
});

describe('chunkMessages — one chunk per turn', () => {
  it('produces one chunk per turn when turns fit', () => {
    const { chunks } = chunkMessages(
      [msg('user', 'How should we do auth?'), msg('assistant', 'Use short-lived JWTs.')],
      START,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.role)).toEqual(['user', 'assistant']);
  });

  it('assigns monotonic positions across turns and splits', () => {
    const big = 'w'.repeat(3000); // splits into several
    const { chunks } = chunkMessages([msg('user', 'hi'), msg('assistant', big)], START);
    expect(chunks.map((c) => c.position)).toEqual([...chunks.keys()]);
  });

  it('skips empty turns', () => {
    const { chunks } = chunkMessages([msg('user', '   '), msg('assistant', 'real')], START);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('real');
  });
});

describe('chunkMessages — timestamps are sacred', () => {
  it('carries the turn’s own timestamp to every piece of a split turn', () => {
    const big = 'v'.repeat(3000);
    const { chunks } = chunkMessages([msg('assistant', big, LATER)], START);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.occurredAt).toEqual(LATER);
  });

  it('carries the role to every piece of a split turn', () => {
    const big = 'v'.repeat(3000);
    const { chunks } = chunkMessages([msg('assistant', big)], START);
    for (const c of chunks) expect(c.role).toBe('assistant');
  });

  it('inherits the conversation start when a message has no timestamp', () => {
    const { chunks, inheritedTimestamps } = chunkMessages([msg('user', 'undated', null)], START);
    expect(chunks[0]!.occurredAt).toEqual(START);
    expect(inheritedTimestamps).toBe(1);
  });

  it('counts every inherited piece, so ingest can report the real number', () => {
    const big = 'u'.repeat(3000);
    const { chunks, inheritedTimestamps } = chunkMessages([msg('assistant', big, null)], START);
    expect(inheritedTimestamps).toBe(chunks.length);
  });

  it('reports zero inherited when every message is dated', () => {
    const { inheritedTimestamps } = chunkMessages(
      [msg('user', 'a'), msg('assistant', 'b')],
      START,
    );
    expect(inheritedTimestamps).toBe(0);
  });

  it('never uses the current time as a fallback', () => {
    const before = Date.now();
    const { chunks } = chunkMessages([msg('user', 'undated', null)], START);
    expect(chunks[0]!.occurredAt.getTime()).toBeLessThan(before);
  });
});
