/**
 * .docx text extraction.
 *
 * A .docx is a zip containing `word/document.xml`, so this needs no new
 * dependency -- fflate is already here for chat export archives.
 *
 * Deliberately extracts TEXT ONLY. Styling, numbering and revision history are
 * discarded; what matters for retrieval is what the document says. Paragraph
 * and line breaks are preserved because the chunker splits on them, and losing
 * them would collapse a document into one unsplittable block.
 */
import { unzipSync } from 'fflate';

/** The body text part. Headers, footers and footnotes live in separate parts. */
const BODY = 'word/document.xml';

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    // Ampersand last, or it would re-trigger the replacements above.
    .replace(/&amp;/g, '&');
}

/**
 * Turn WordprocessingML into plain text.
 *
 * Only four elements carry meaning here: `w:t` is a run of text, `w:tab` and
 * `w:br` are whitespace, and `</w:p>` ends a paragraph. Everything else is
 * formatting and is dropped.
 */
export function xmlToText(xml: string): string {
  let out = xml
    // Drop deleted text so tracked-changes documents read as the current version.
    .replace(/<w:delText[\s\S]*?<\/w:delText>/g, '')
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n\n');

  // Keep the contents of text runs, discard every other tag.
  const text = out
    .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_, inner: string) => inner)
    .replace(/<[^>]+>/g, '');

  return decodeEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface DocxResult {
  text: string;
  /** Other parts found, so a document whose body is empty can say why. */
  parts: string[];
}

export function extractDocx(data: Uint8Array): DocxResult {
  const files = unzipSync(data);
  const parts = Object.keys(files);

  const body = files[BODY];
  if (!body) return { text: '', parts };

  return { text: xmlToText(new TextDecoder().decode(body)), parts };
}

/** A .docx always contains these; used to tell one from an arbitrary zip. */
export function looksLikeDocx(names: string[]): boolean {
  return names.includes(BODY) || names.includes('[Content_Types].xml');
}
