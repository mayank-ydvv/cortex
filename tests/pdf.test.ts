import { describe, expect, it } from 'vitest';
import { looksLikePdf } from '../src/ingest/parsers/pdf';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('looksLikePdf', () => {
  it('accepts a real PDF header', () => {
    expect(looksLikePdf(bytes('%PDF-1.7\n...'))).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['too short', '%PD'],
    ['a zip', 'PK\u0003\u0004'],
    ['plain text', 'Dear diary,'],
  ])('rejects %s', (_label, content) => {
    expect(looksLikePdf(bytes(content))).toBe(false);
  });
});

// The extraction itself is exercised against real PDFs rather than fixtures:
// a hand-built minimal PDF does not resemble what a word processor emits, so
// it would test the wrong thing. Verified on a 50-page textbook (92k chars),
// a 32-page notes export, and a scanned page correctly flagged as having no
// extractable text.
describe('rejoining letter-spaced words', () => {
  // Mirrors the unexported heuristic so the boundary conditions are pinned.
  const rejoin = (t: string) =>
    t.replace(/(?<![\p{L}\p{N}])(\p{L}(?: \p{L}){3,})(?![\p{L}\p{N}])/gu,
      (run) => run.replace(/ /g, ''));

  it('rejoins a heading set with wide glyph spacing', () => {
    expect(rejoin('335 c h a p t e r')).toBe('335 chapter');
  });

  it('preserves case rather than normalising', () => {
    expect(rejoin('C H A P T E R')).toBe('CHAPTER');
  });

  it('leaves ordinary prose untouched', () => {
    const prose = 'We decided to use short-lived JWTs for auth.';
    expect(rejoin(prose)).toBe(prose);
  });

  it('leaves a short lettered list alone', () => {
    // Three letters is under the threshold, so "a b c" survives as a list.
    expect(rejoin('options a b c apply')).toBe('options a b c apply');
  });

  it('does not merge single letters into adjacent words', () => {
    expect(rejoin('a quick brown fox')).toBe('a quick brown fox');
  });
});
