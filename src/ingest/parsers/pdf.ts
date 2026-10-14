/**
 * PDF text extraction.
 *
 * unpdf wraps a serverless-safe pdf.js build: pure JavaScript, no native
 * binaries, so unlike the embedding model this survives a move to Vercel.
 *
 * A PDF stores positioned glyphs, not paragraphs, so extracted text is always
 * an approximation of reading order. Two consequences handled here:
 *
 *   - Page boundaries are the only structure that can be trusted, so pages are
 *     separated by a blank line. The chunker splits on those, which keeps a
 *     chunk from straddling two pages.
 *   - A scanned PDF contains images, not text, and extracts to nothing. That is
 *     reported rather than stored as an empty document, because a silently
 *     empty import is exactly the kind of invisible failure this project avoids.
 */
import { extractText, getDocumentProxy } from 'unpdf';

export interface PdfResult {
  text: string;
  pages: number;
  /** True when the file parsed but held no extractable text — usually a scan. */
  likelyScanned: boolean;
}

/**
 * Rejoin letter-spaced words.
 *
 * Some PDFs set headings with wide glyph spacing, and extraction then emits
 * "c h a p t e r" -- which no keyword search will ever match. Measured at 0.4%
 * of one real textbook, all of it headings.
 *
 * Requires four or more single letters in a row, so ordinary prose and short
 * lettered lists ("a b c") are left alone. Case is preserved, so "C H A P T E R"
 * stays uppercase rather than being normalised.
 */
function rejoinSpacedLetters(text: string): string {
  return text.replace(
    /(?<![\p{L}\p{N}])(\p{L}(?: \p{L}){3,})(?![\p{L}\p{N}])/gu,
    (run) => run.replace(/ /g, ''),
  );
}

/** Collapse the ragged whitespace that positioned-glyph extraction produces. */
function tidy(page: string): string {
  return rejoinSpacedLetters(page)
    .replace(/\r/g, '')
    // A hyphen at a line end is usually a word broken across lines.
    .replace(/(\w)-\n(\w)/g, '$1$2')
    // Single newlines inside a paragraph are line wraps, not breaks.
    .replace(/([^\n])\n(?![\n•\-\d])/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractPdf(data: Uint8Array): Promise<PdfResult> {
  const doc = await getDocumentProxy(data);
  const { text, totalPages } = await extractText(doc, { mergePages: false });

  const pages = (Array.isArray(text) ? text : [text]).map(tidy).filter((p) => p !== '');
  const joined = pages.join('\n\n');

  return {
    text: joined,
    pages: totalPages,
    likelyScanned: joined.trim() === '' && totalPages > 0,
  };
}

/** PDFs begin with %PDF-; checked so a mislabelled file fails clearly. */
export function looksLikePdf(data: Uint8Array): boolean {
  return (
    data.length > 4 &&
    data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46
  );
}
