import { describe, expect, it } from 'vitest';
import { claudeParser, parseClaudeExport } from '../src/ingest/parsers/claude';

/** Mirrors the real export's shape, including its awkward parts. */
const conv = (over: Record<string, unknown> = {}) => ({
  uuid: 'c-1',
  name: 'Auth discussion',
  summary: '',
  created_at: '2026-09-18T10:00:00.000000Z',
  updated_at: '2026-09-18T10:05:00.000000Z',
  chat_messages: [
    {
      uuid: 'm1', sender: 'human', created_at: '2026-09-18T10:00:00.000000Z',
      text: 'Should we move auth to JWTs?',
      content: [{ type: 'text', text: 'Should we move auth to JWTs?' }],
    },
    {
      uuid: 'm2', sender: 'assistant', created_at: '2026-09-18T10:01:00.000000Z',
      text: 'Yes, short expiry.',
      content: [{ type: 'text', text: 'Yes, short expiry.' }],
    },
  ],
  ...over,
});

describe('claudeParser.detect', () => {
  it('recognises the export by structure, not filename', () => {
    expect(claudeParser.detect([conv()])).toBe(true);
  });

  it.each<[string, unknown]>([
    ['empty array', []],
    ['wrapped object', { conversations: [] }],
    ['a ChatGPT-shaped export', [{ mapping: {} }]],
    ['null', null],
  ])('rejects %s', (_label, input) => {
    expect(claudeParser.detect(input)).toBe(false);
  });
});

describe('parseClaudeExport — content selection', () => {
  it('prefers `text` over joined content blocks, since `text` is never shorter', () => {
    // Observed in the real export: `text` was longer in 105 messages, shorter in none.
    const out = parseClaudeExport([conv({
      chat_messages: [{
        uuid: 'm', sender: 'assistant', created_at: '2026-09-18T10:00:00Z',
        text: 'The full answer, including the tail that blocks omit.',
        content: [{ type: 'text', text: 'The full answer,' }],
      }],
    })]);
    expect(out[0]!.messages[0]!.content).toBe('The full answer, including the tail that blocks omit.');
  });

  it('falls back to text blocks when `text` is empty', () => {
    const out = parseClaudeExport([conv({
      chat_messages: [{
        uuid: 'm', sender: 'assistant', created_at: '2026-09-18T10:00:00Z',
        text: '',
        content: [{ type: 'text', text: 'from the block' }],
      }],
    })]);
    expect(out[0]!.messages[0]!.content).toBe('from the block');
  });

  it('never indexes tool_use, tool_result or thinking blocks', () => {
    // These outnumbered text blocks in the real export; indexing them would
    // bury real answers under JSON payloads.
    const out = parseClaudeExport([conv({
      chat_messages: [{
        uuid: 'm', sender: 'assistant', created_at: '2026-09-18T10:00:00Z',
        text: '',
        content: [
          { type: 'thinking', text: 'internal reasoning' },
          { type: 'tool_use', text: '{"cmd":"ls"}' },
          { type: 'tool_result', text: 'file listing' },
          { type: 'text', text: 'the actual answer' },
        ],
      }],
    })]);
    expect(out[0]!.messages[0]!.content).toBe('the actual answer');
  });

  it('skips messages with no text at all rather than storing empty chunks', () => {
    // 233 of 819 real messages were like this; 224 had an empty content array.
    const out = parseClaudeExport([conv({
      chat_messages: [
        { uuid: 'a', sender: 'human', created_at: '2026-09-18T10:00:00Z', text: '', content: [] },
        { uuid: 'b', sender: 'assistant', created_at: '2026-09-18T10:01:00Z', text: 'kept', content: [] },
      ],
    })]);
    expect(out[0]!.messages).toHaveLength(1);
    expect(out[0]!.messages[0]!.content).toBe('kept');
  });

  it('drops a conversation whose every message is empty', () => {
    expect(parseClaudeExport([conv({
      chat_messages: [{ uuid: 'a', sender: 'human', created_at: '2026-09-18T10:00:00Z', text: '', content: [] }],
    })])).toHaveLength(0);
  });
});

describe('parseClaudeExport — roles and timestamps', () => {
  it('maps "human" to user and everything else to assistant', () => {
    const out = parseClaudeExport([conv()]);
    expect(out[0]!.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('keeps each message’s own timestamp', () => {
    const out = parseClaudeExport([conv()]);
    expect(out[0]!.messages[0]!.occurredAt?.toISOString()).toBe('2026-09-18T10:00:00.000Z');
    expect(out[0]!.messages[1]!.occurredAt?.toISOString()).toBe('2026-09-18T10:01:00.000Z');
  });

  it('falls back to the earliest message when the conversation has no created_at', () => {
    const out = parseClaudeExport([conv({ created_at: undefined })]);
    expect(out[0]!.startedAt.toISOString()).toBe('2026-09-18T10:00:00.000Z');
  });

  it('drops a conversation with no usable date rather than inventing one', () => {
    expect(parseClaudeExport([conv({
      created_at: undefined,
      chat_messages: [{ uuid: 'a', sender: 'human', created_at: undefined, text: 'hi', content: [] }],
    })])).toHaveLength(0);
  });

  it('treats an unparseable date as absent, not as Invalid Date', () => {
    const out = parseClaudeExport([conv({
      chat_messages: [{ uuid: 'a', sender: 'human', created_at: 'garbage', text: 'hi', content: [] }],
    })]);
    expect(out[0]!.messages[0]!.occurredAt).toBeNull();
    expect(Number.isNaN(out[0]!.startedAt.getTime())).toBe(false);
  });
});

describe('parseClaudeExport — identity and titles', () => {
  it('uses the conversation uuid as external id, so re-import updates in place', () => {
    expect(parseClaudeExport([conv()])[0]!.externalId).toBe('c-1');
  });

  it('drops a conversation with no uuid, since it could not be re-imported idempotently', () => {
    expect(parseClaudeExport([conv({ uuid: undefined })])).toHaveLength(0);
  });

  it('falls back through summary to the first user message when unnamed', () => {
    // 37 of 110 real conversations had no name; an uncitable result is a failure.
    expect(parseClaudeExport([conv({ name: '', summary: 'Auth summary' })])[0]!.title)
      .toBe('Auth summary');
    expect(parseClaudeExport([conv({ name: '', summary: '' })])[0]!.title)
      .toBe('Should we move auth to JWTs?');
  });

  it('truncates an over-long derived title', () => {
    const long = 'x'.repeat(200);
    const out = parseClaudeExport([conv({
      name: '', summary: '',
      chat_messages: [{ uuid: 'a', sender: 'human', created_at: '2026-09-18T10:00:00Z', text: long, content: [] }],
    })]);
    expect(out[0]!.title!.length).toBeLessThanOrEqual(71);
    expect(out[0]!.title!.endsWith('…')).toBe(true);
  });
});
