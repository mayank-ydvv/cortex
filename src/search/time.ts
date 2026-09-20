/**
 * Time expression parsing.
 *
 * Time is structured metadata, not text to embed. This module turns a natural
 * language phrase into a concrete { from, to } range that becomes a SQL WHERE
 * clause, and returns the query with the phrase removed so it never reaches the
 * embedding model.
 *
 * Two deliberate design choices:
 *
 * 1. `now` is injected rather than read from the clock, so tests and golden-set
 *    entries are deterministic. A golden entry that says "last week" must resolve
 *    to the same window every time it runs, or it reports regressions that aren't.
 *
 * 2. Relative recent ranges are GENEROUS: "last week" runs from the start of the
 *    previous calendar week through *now*, not a strict Mon-Sun window. On a Sunday,
 *    a strict window silently excludes a decision made the previous Thursday. Over-
 *    including is recoverable because the dates are visible in the results;
 *    under-including is invisible, which is the failure this system exists to avoid.
 */
import {
  endOfDay,
  endOfMonth,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export interface TimeRange {
  /** Inclusive lower bound, as a UTC instant. */
  from: Date;
  /** Exclusive upper bound, as a UTC instant. */
  to: Date;
  /** The phrase as it appeared in the query, for display in the explain panel. */
  expression: string;
}

export interface ParsedQuery {
  /** null when no time expression was found — no date filter is then applied. */
  range: TimeRange | null;
  /** The query with the time expression removed, for embedding and tsquery. */
  cleanedText: string;
}

/** Weeks start Monday. */
const WEEK_OPTS = { weekStartsOn: 1 } as const;

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, couple: 2, few: 3, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const MONTH_NAMES = Object.keys(MONTHS).join('|');

type Unit = 'day' | 'week' | 'month' | 'year';

function subUnits(d: Date, n: number, unit: Unit): Date {
  switch (unit) {
    case 'day': return subDays(d, n);
    case 'week': return subWeeks(d, n);
    case 'month': return subMonths(d, n);
    case 'year': return subYears(d, n);
  }
}

function parseCount(raw: string): number {
  const digits = Number.parseInt(raw, 10);
  if (!Number.isNaN(digits)) return digits;
  return NUMBER_WORDS[raw.toLowerCase()] ?? 1;
}

function normaliseUnit(raw: string): Unit {
  const u = raw.toLowerCase().replace(/s$/, '');
  return (u === 'day' || u === 'week' || u === 'month' || u === 'year') ? u : 'day';
}

/**
 * Resolve a month name to the most recent occurrence at or before `wall`.
 * In September 2026, "March" means March 2026; "November" means November 2025.
 */
function mostRecentMonth(wall: Date, monthIdx: number): Date {
  const year = monthIdx <= wall.getMonth() ? wall.getFullYear() : wall.getFullYear() - 1;
  return new Date(year, monthIdx, 1, 0, 0, 0, 0);
}

interface Matcher {
  re: RegExp;
  /** Returns wall-clock boundaries; conversion to UTC happens in the caller. */
  build: (m: RegExpMatchArray, wall: Date) => { from: Date; to: Date };
}

/**
 * Ordered most-specific first. The first match wins, so "a few months ago" must
 * precede anything that would also match "months".
 */
const MATCHERS: Matcher[] = [
  // "a few months ago" — explicitly distal, so it is a bounded window that
  // EXCLUDES the recent past. This is the one exception to the generous rule.
  {
    re: /\b(?:a\s+)?(couple|few)\s+(?:of\s+)?(day|days|week|weeks|month|months|year|years)\s+(?:ago|back)\b/i,
    build: (m, wall) => {
      const unit = normaliseUnit(m[2]!);
      return { from: subUnits(wall, 6, unit), to: subUnits(wall, 2, unit) };
    },
  },

  // "last 3 months", "past two weeks", "in the last 10 days", "previous 6 months"
  {
    re: /\b(?:in\s+the\s+)?(?:last|past|previous)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few)\s+(days?|weeks?|months?|years?)\b/i,
    build: (m, wall) => ({
      from: subUnits(wall, parseCount(m[1]!), normaliseUnit(m[2]!)),
      to: wall,
    }),
  },

  { re: /\byesterday\b/i, build: (_m, wall) => ({ from: startOfDay(subDays(wall, 1)), to: endOfDay(subDays(wall, 1)) }) },
  { re: /\btoday\b/i,     build: (_m, wall) => ({ from: startOfDay(wall), to: wall }) },

  // Generous relative ranges: previous period start -> now.
  { re: /\blast\s+week\b/i,  build: (_m, wall) => ({ from: startOfWeek(subWeeks(wall, 1), WEEK_OPTS), to: wall }) },
  { re: /\bthis\s+week\b/i,  build: (_m, wall) => ({ from: startOfWeek(wall, WEEK_OPTS), to: wall }) },
  { re: /\blast\s+month\b/i, build: (_m, wall) => ({ from: startOfMonth(subMonths(wall, 1)), to: wall }) },
  { re: /\bthis\s+month\b/i, build: (_m, wall) => ({ from: startOfMonth(wall), to: wall }) },
  { re: /\blast\s+year\b/i,  build: (_m, wall) => ({ from: startOfYear(subYears(wall, 1)), to: wall }) },
  { re: /\bthis\s+year\b/i,  build: (_m, wall) => ({ from: startOfYear(wall), to: wall }) },

  { re: /\b(?:recently|lately|of\s+late)\b/i, build: (_m, wall) => ({ from: subDays(wall, 30), to: wall }) },

  // "since March", "since last March" -> that month's start through now.
  {
    re: new RegExp(String.raw`\bsince\s+(?:last\s+)?(${MONTH_NAMES})\b`, 'i'),
    build: (m, wall) => ({ from: mostRecentMonth(wall, MONTHS[m[1]!.toLowerCase()]!), to: wall }),
  },

  // "in March 2025", "during September 2024" — explicit year.
  {
    re: new RegExp(String.raw`\b(?:in|during)\s+(${MONTH_NAMES})\s+(\d{4})\b`, 'i'),
    build: (m) => {
      const start = new Date(Number.parseInt(m[2]!, 10), MONTHS[m[1]!.toLowerCase()]!, 1);
      return { from: startOfMonth(start), to: endOfMonth(start) };
    },
  },

  // "in March" — most recent past March.
  {
    re: new RegExp(String.raw`\b(?:in|during)\s+(${MONTH_NAMES})\b`, 'i'),
    build: (m, wall) => {
      const start = mostRecentMonth(wall, MONTHS[m[1]!.toLowerCase()]!);
      return { from: start, to: endOfMonth(start) };
    },
  },

  // "in 2024"
  {
    re: /\b(?:in|during)\s+(\d{4})\b/i,
    build: (m) => {
      const start = new Date(Number.parseInt(m[1]!, 10), 0, 1);
      return { from: startOfYear(start), to: endOfYear(start) };
    },
  },
];

/** Remove the matched phrase and tidy what's left. */
function clean(query: string, matched: string): string {
  let out = query.replace(matched, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  // Strip a preposition left dangling by the removal ("what happened in" -> "what happened").
  out = out.replace(/\s+\b(in|on|at|from|during|since|about|for|of)\b\s*$/i, '');
  // Tidy punctuation stranded by the removal.
  out = out.replace(/\s+([?.!,])/g, '$1').replace(/\s*,\s*([?.!])/g, '$1').trim();
  return out.length > 0 ? out : query.trim();
}

/**
 * Parse a time expression out of `query`.
 *
 * @param query the raw user query
 * @param now   the instant to resolve relative expressions against (injected for determinism)
 * @param tz    IANA timezone the expression is interpreted in; defaults to the system zone
 */
export function parseTimeRange(
  query: string,
  now: Date,
  tz: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): ParsedQuery {
  // Work in wall-clock time for the target zone, so week and month boundaries
  // land where the user expects, then convert back to UTC instants.
  const wall = toZonedTime(now, tz);

  for (const { re, build } of MATCHERS) {
    const m = query.match(re);
    if (!m) continue;

    const { from, to } = build(m, wall);
    // Nothing can occur in the future, so never let `to` run past now.
    const cappedTo = to > wall ? wall : to;

    return {
      range: {
        from: fromZonedTime(from, tz),
        to: fromZonedTime(cappedTo, tz),
        expression: m[0],
      },
      cleanedText: clean(query, m[0]),
    };
  }

  return { range: null, cleanedText: query.trim() };
}
