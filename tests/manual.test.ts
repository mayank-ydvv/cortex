import { describe, expect, it } from 'vitest';
import { manualProject, parseManual } from '../src/ingest/parsers/manual.js';

const MTIME = new Date('2026-09-19T12:00:00.000Z');
const parse = (text: string, path = '/notes/auth-notes.md') =>
  parseManual({ text, path, mtime: MTIME });

describe('parseManual — frontmatter', () => {
  it('reads title, date and project', () => {
    const c = parse(`---
title: Auth notes
date: 2026-09-17
project: api
---
We settled on short-lived JWTs.`);

    expect(c.title).toBe('Auth notes');
    expect(c.startedAt.toISOString()).toBe('2026-09-17T00:00:00.000Z');
    expect(c.messages[0]!.content).toBe('We settled on short-lived JWTs.');
  });

  it('extracts the project separately', () => {
    expect(manualProject('---\nproject: api\n---\nbody')).toBe('api');
    expect(manualProject('no frontmatter')).toBeNull();
  });

  it('strips surrounding quotes from values', () => {
    expect(parse('---\ntitle: "Quoted Title"\n---\nbody').title).toBe('Quoted Title');
  });
});

describe('parseManual — title derivation', () => {
  it('falls back to the first markdown heading', () => {
    expect(parse('# Auth decisions\n\nbody').title).toBe('Auth decisions');
  });

  it('falls back to the filename when there is no heading', () => {
    expect(parse('just body text').title).toBe('auth-notes');
  });

  it('prefers frontmatter title over a heading', () => {
    expect(parse('---\ntitle: From frontmatter\n---\n# From heading\nbody').title)
      .toBe('From frontmatter');
  });
});

describe('parseManual — timestamps are sacred', () => {
  it('uses the frontmatter date as the message timestamp', () => {
    const c = parse('---\ndate: 2026-09-17\n---\nbody');
    expect(c.messages[0]!.occurredAt?.toISOString()).toBe('2026-09-17T00:00:00.000Z');
  });

  it('marks the message undated when frontmatter has no date, so it is counted as inherited', () => {
    const c = parse('no frontmatter at all');
    expect(c.messages[0]!.occurredAt).toBeNull();
    // startedAt still falls back to a REAL timestamp (mtime), never now().
    expect(c.startedAt).toEqual(MTIME);
  });

  it('treats an unparseable date as undated rather than as Invalid Date', () => {
    const c = parse('---\ndate: not-a-date\n---\nbody');
    expect(c.messages[0]!.occurredAt).toBeNull();
    expect(Number.isNaN(c.startedAt.getTime())).toBe(false);
  });

  it('never falls back to the current time', () => {
    const before = Date.now();
    const c = parse('---\ndate: garbage\n---\nbody');
    expect(c.startedAt.getTime()).toBeLessThan(before);
  });

  it('accepts `created` and `occurred_at` as aliases for `date`', () => {
    expect(parse('---\ncreated: 2026-01-05\n---\nb').messages[0]!.occurredAt).not.toBeNull();
    expect(parse('---\noccurred_at: 2026-01-05\n---\nb').messages[0]!.occurredAt).not.toBeNull();
  });
});

describe('parseManual — identity', () => {
  it('uses the file path as the external id, so re-importing updates in place', () => {
    expect(parse('body', '/notes/x.md').externalId).toBe('/notes/x.md');
  });
});
