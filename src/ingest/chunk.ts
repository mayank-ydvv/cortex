/**
 * Chunking.
 *
 * Split by conversation turn, not by fixed character window. A turn is a coherent
 * unit with one author and one timestamp; a character window shreds that and
 * produces chunks whose timestamp and role are fictional.
 *
 * A turn longer than the model's input limit is split further, but every piece
 * keeps the SAME role and the SAME timestamp as the turn it came from. That is
 * what makes time filtering meaningful after splitting.
 *
 * Splitting prefers the most natural boundary available: paragraphs first, then
 * sentences, then a hard character cut as a last resort.
 */
import { MAX_INPUT_TOKENS, TARGET_CHUNK_TOKENS, estimateTokens } from './embed.js';
import type { ParsedMessage } from './parsers/types.js';

export interface ChunkDraft {
  content: string;
  role: 'user' | 'assistant';
  occurredAt: Date;
  /** Monotonic within a conversation, across all turns. */
  position: number;
}

/** Greedily pack pieces into groups no larger than `budget` tokens. */
function pack(pieces: string[], joiner: string, budget: number): string[] {
  const out: string[] = [];
  let current = '';

  for (const piece of pieces) {
    if (current === '') {
      current = piece;
      continue;
    }
    const candidate = current + joiner + piece;
    if (estimateTokens(candidate) <= budget) {
      current = candidate;
    } else {
      out.push(current);
      current = piece;
    }
  }
  if (current !== '') out.push(current);
  return out;
}

/** Hard cut, used only when a single sentence exceeds the model limit. */
function hardSplit(text: string, budget: number): string[] {
  const maxChars = budget * 3;
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    out.push(text.slice(i, i + maxChars));
  }
  return out;
}

/**
 * Split one turn's text into pieces that each fit the budget.
 * Returns [text] unchanged when it already fits.
 */
export function splitText(text: string, budget: number = TARGET_CHUNK_TOKENS): string[] {
  if (estimateTokens(text) <= budget) return [text];

  // Paragraphs.
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim() !== '');
  let pieces = pack(paragraphs, '\n\n', budget);

  // Any paragraph still too large gets broken into sentences.
  pieces = pieces.flatMap((piece) => {
    if (estimateTokens(piece) <= budget) return [piece];
    const sentences = piece.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== '');
    return pack(sentences, ' ', budget);
  });

  // A single sentence longer than the model limit is cut. Rare, but it must
  // never silently exceed the limit -- the model would truncate without error.
  return pieces.flatMap((piece) =>
    estimateTokens(piece) > MAX_INPUT_TOKENS ? hardSplit(piece, budget) : [piece],
  );
}

export interface ChunkResult {
  chunks: ChunkDraft[];
  /** How many chunks inherited the conversation start time. Reported by ingest. */
  inheritedTimestamps: number;
}

/**
 * Turn a conversation's messages into chunks.
 *
 * @param messages     the conversation's turns, in order
 * @param conversationStart fallback timestamp for messages the export left undated
 */
export function chunkMessages(
  messages: ParsedMessage[],
  conversationStart: Date,
  budget: number = TARGET_CHUNK_TOKENS,
): ChunkResult {
  const chunks: ChunkDraft[] = [];
  let position = 0;
  let inheritedTimestamps = 0;

  for (const message of messages) {
    const content = message.content.trim();
    if (content === '') continue;

    // Standing rule: never substitute import time. Fall back to the
    // conversation's own start, which is at least real.
    const occurredAt = message.occurredAt ?? conversationStart;
    const inherited = message.occurredAt === null;

    for (const piece of splitText(content, budget)) {
      chunks.push({ content: piece, role: message.role, occurredAt, position });
      position += 1;
      if (inherited) inheritedTimestamps += 1;
    }
  }

  return { chunks, inheritedTimestamps };
}
