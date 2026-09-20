import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import { parseTimeRange } from '../src/search/time.js';

const TZ = 'Asia/Calcutta';

/**
 * Sunday 2026-09-20, 14:15 IST. Frozen so these tests never drift.
 * Sunday matters: it is the day a strict Mon-Sun reading of "last week" would
 * silently exclude a decision made the previous Thursday.
 */
const NOW = new Date('2026-09-20T08:45:00.000Z');

/** Render a UTC instant as wall-clock in TZ, so assertions read as intent. */
const wall = (d: Date) => formatInTimeZone(d, TZ, 'yyyy-MM-dd HH:mm');

const parse = (q: string) => parseTimeRange(q, NOW, TZ);

describe('parseTimeRange — relative ranges are generous', () => {
  it('"last week" runs from the previous week start through now', () => {
    const { range } = parse('what did we decide about auth last week?');
    expect(range).not.toBeNull();
    expect(wall(range!.from)).toBe('2026-09-07 00:00');
    expect(wall(range!.to)).toBe('2026-09-20 14:15');
    expect(range!.expression).toBe('last week');
  });

  it('THE CORE REQUIREMENT: "last week" includes Thursday but excludes March', () => {
    const { range } = parse('what did we decide about auth last week?');
    const thursday = new Date('2026-09-17T06:00:00.000Z'); // a decision made this week
    const march = new Date('2026-03-12T06:00:00.000Z');    // the stale auth thread

    expect(thursday >= range!.from && thursday < range!.to).toBe(true);
    expect(march >= range!.from && march < range!.to).toBe(false);
  });

  it('"this week" starts Monday', () => {
    const { range } = parse('auth decisions this week');
    expect(wall(range!.from)).toBe('2026-09-14 00:00');
    expect(wall(range!.to)).toBe('2026-09-20 14:15');
  });

  it('"last month" runs from the start of last month through now', () => {
    const { range } = parse('what did we ship last month');
    expect(wall(range!.from)).toBe('2026-08-01 00:00');
    expect(wall(range!.to)).toBe('2026-09-20 14:15');
  });

  it('"this month" starts on the 1st', () => {
    const { range } = parse('notes from this month');
    expect(wall(range!.from)).toBe('2026-09-01 00:00');
  });

  it('"last year" starts on Jan 1 of last year', () => {
    const { range } = parse('decisions from last year');
    expect(wall(range!.from)).toBe('2025-01-01 00:00');
    expect(wall(range!.to)).toBe('2026-09-20 14:15');
  });
});

describe('parseTimeRange — day ranges', () => {
  it('"yesterday" is bounded to that single day', () => {
    const { range } = parse('what did I say yesterday');
    expect(wall(range!.from)).toBe('2026-09-19 00:00');
    expect(wall(range!.to)).toBe('2026-09-19 23:59');
  });

  it('"today" starts at midnight and ends now, not end of day', () => {
    const { range } = parse('anything about auth today');
    expect(wall(range!.from)).toBe('2026-09-20 00:00');
    expect(wall(range!.to)).toBe('2026-09-20 14:15');
  });
});

describe('parseTimeRange — counted ranges', () => {
  it.each([
    ['last 3 months', '2026-06-20 14:15'],
    ['past two weeks', '2026-09-06 14:15'],
    ['in the last 10 days', '2026-09-10 14:15'],
    ['previous 6 months', '2026-03-20 14:15'],
  ])('"%s" resolves to %s .. now', (phrase, expectedFrom) => {
    const { range } = parse(`auth ${phrase}`);
    expect(wall(range!.from)).toBe(expectedFrom);
    expect(wall(range!.to)).toBe('2026-09-20 14:15');
  });

  it('"recently" means the last 30 days', () => {
    const { range } = parse('what have I been working on recently');
    expect(wall(range!.from)).toBe('2026-08-21 14:15');
    expect(wall(range!.to)).toBe('2026-09-20 14:15');
  });
});

describe('parseTimeRange — "a few months ago" is distal, not recent', () => {
  it('excludes the recent past rather than running through now', () => {
    const { range } = parse('that database thing a few months ago');
    expect(wall(range!.from)).toBe('2026-03-20 14:15');
    expect(wall(range!.to)).toBe('2026-07-20 14:15');
    // The distinguishing property: it does NOT reach the present.
    expect(range!.to.getTime()).toBeLessThan(NOW.getTime());
  });

  it('works for weeks too', () => {
    const { range } = parse('a few weeks ago');
    expect(wall(range!.from)).toBe('2026-08-09 14:15');
    expect(wall(range!.to)).toBe('2026-09-06 14:15');
  });
});

describe('parseTimeRange — absolute months and years', () => {
  it('"in March" means the most recent past March', () => {
    const { range } = parse('the auth thread in March');
    expect(wall(range!.from)).toBe('2026-03-01 00:00');
    expect(wall(range!.to)).toBe('2026-03-31 23:59');
  });

  it('a month later in the year than now belongs to last year', () => {
    const { range } = parse('what happened in November');
    expect(wall(range!.from)).toBe('2025-11-01 00:00');
    expect(wall(range!.to)).toBe('2025-11-30 23:59');
  });

  it('an explicit year is respected', () => {
    const { range } = parse('the migration in March 2025');
    expect(wall(range!.from)).toBe('2025-03-01 00:00');
    expect(wall(range!.to)).toBe('2025-03-31 23:59');
  });

  it('"in 2024" covers the whole year', () => {
    const { range } = parse('decisions in 2024');
    expect(wall(range!.from)).toBe('2024-01-01 00:00');
    expect(wall(range!.to)).toBe('2024-12-31 23:59');
  });

  it('the current month is capped at now, never the future', () => {
    const { range } = parse('what did we do in September');
    expect(wall(range!.from)).toBe('2026-09-01 00:00');
    expect(wall(range!.to)).toBe('2026-09-20 14:15');
  });

  it('"since March" runs through now', () => {
    const { range } = parse('auth changes since March');
    expect(wall(range!.from)).toBe('2026-03-01 00:00');
    expect(wall(range!.to)).toBe('2026-09-20 14:15');
  });
});

describe('parseTimeRange — the time phrase is stripped before embedding', () => {
  it.each([
    ['what did we decide about auth last week?', 'what did we decide about auth?'],
    ['auth decisions this week', 'auth decisions'],
    ['what happened in March', 'what happened'],
    ['that database thing a few months ago', 'that database thing'],
    ['what did I say yesterday', 'what did I say'],
  ])('%s -> %s', (query, expected) => {
    expect(parse(query).cleanedText).toBe(expected);
  });

  it('falls back to the original when stripping would empty the query', () => {
    expect(parse('last week').cleanedText).toBe('last week');
  });
});

describe('parseTimeRange — no expression', () => {
  it.each([
    'how do I configure the JWT secret',
    'pgvector HNSW index',
    'what did we decide about auth',
  ])('"%s" yields no range and no date filter', (q) => {
    const { range, cleanedText } = parse(q);
    expect(range).toBeNull();
    expect(cleanedText).toBe(q);
  });
});

describe('parseTimeRange — timezone correctness', () => {
  it('week boundaries differ by zone for the same instant', () => {
    const ist = parseTimeRange('last week', NOW, 'Asia/Calcutta');
    const utc = parseTimeRange('last week', NOW, 'UTC');
    // Same wall-clock date, different UTC instants: IST midnight is 18:30 UTC.
    expect(ist.range!.from.toISOString()).toBe('2026-09-06T18:30:00.000Z');
    expect(utc.range!.from.toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });

  it('a zone west of UTC shifts the boundary the other way', () => {
    const ny = parseTimeRange('last week', NOW, 'America/New_York');
    expect(ny.range!.from.toISOString()).toBe('2026-09-07T04:00:00.000Z');
  });
});
