import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { extractDocx, looksLikeDocx, xmlToText } from '../src/ingest/parsers/docx';

const doc = (bodyXml: string) =>
  zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(
      `<?xml version="1.0"?><w:document><w:body>${bodyXml}</w:body></w:document>`,
    ),
  });

describe('xmlToText', () => {
  it('joins runs within a paragraph without inserting spaces', () => {
    // Word splits a sentence across runs at formatting boundaries; joining them
    // with spaces would corrupt words mid-token.
    expect(xmlToText('<w:p><w:r><w:t>short-</w:t></w:r><w:r><w:t>lived</w:t></w:r></w:p>'))
      .toBe('short-lived');
  });

  it('separates paragraphs with a blank line, which the chunker splits on', () => {
    expect(xmlToText('<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>'))
      .toBe('one\n\ntwo');
  });

  it('converts breaks and tabs to whitespace', () => {
    expect(xmlToText('<w:p><w:r><w:t>a</w:t><w:br/><w:t>b</w:t><w:tab/><w:t>c</w:t></w:r></w:p>'))
      .toBe('a\nb\tc');
  });

  it('decodes entities, resolving ampersand last', () => {
    expect(xmlToText('<w:p><w:r><w:t>Tom &amp;amp; Jerry &lt;3</w:t></w:r></w:p>'))
      .toBe('Tom &amp; Jerry <3');
  });

  it('drops tracked deletions so the text reads as the current version', () => {
    expect(xmlToText('<w:p><w:r><w:t>keep </w:t></w:r><w:del><w:r><w:delText>cut</w:delText></w:r></w:del><w:r><w:t>this</w:t></w:r></w:p>'))
      .toBe('keep this');
  });

  it('discards formatting tags entirely', () => {
    expect(xmlToText('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>'))
      .toBe('bold');
  });

  it('collapses runs of blank paragraphs', () => {
    expect(xmlToText('<w:p><w:r><w:t>a</w:t></w:r></w:p><w:p/><w:p/><w:p><w:r><w:t>b</w:t></w:r></w:p>'))
      .toBe('a\n\nb');
  });
});

describe('extractDocx', () => {
  it('reads the body of a real zip structure', () => {
    const r = extractDocx(doc('<w:p><w:r><w:t>We decided on JWTs.</w:t></w:r></w:p>'));
    expect(r.text).toBe('We decided on JWTs.');
    expect(r.parts).toContain('word/document.xml');
  });

  it('reports parts when there is no body, rather than throwing', () => {
    const r = extractDocx(zipSync({ 'other.xml': strToU8('<x/>') }));
    expect(r.text).toBe('');
    expect(r.parts).toEqual(['other.xml']);
  });
});

describe('looksLikeDocx', () => {
  it('recognises a docx by its required parts', () => {
    expect(looksLikeDocx(['[Content_Types].xml', 'word/document.xml'])).toBe(true);
  });

  it('does not mistake a chat export archive for one', () => {
    expect(looksLikeDocx(['conversations.json', 'users.json'])).toBe(false);
  });
});
