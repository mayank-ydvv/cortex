import type { ReactNode } from 'react';

/**
 * Minimal markdown renderer for answers.
 *
 * The model replies in markdown, and rendering it literally shows raw
 * asterisks and backticks. A full markdown library is more than this needs:
 * answers only ever use bold, inline code, fenced code, and lists.
 *
 * Everything is built as React elements rather than injected HTML, so model
 * output — which is shaped partly by retrieved text from the corpus — can never
 * become markup.
 */

/** Inline: **bold**, `code`, and [1] citation markers. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // One pass over all three forms so they cannot nest incorrectly.
  const pattern = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\[\d+(?:,\s*\d+)*\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-i${i++}`;

    if (token.startsWith('**')) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      out.push(<code key={key} className="md-code">{token.slice(1, -1)}</code>);
    } else {
      out.push(<sup key={key} className="md-cite">{token}</sup>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block.
    if (line.trimStart().startsWith('```')) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trimStart().startsWith('```')) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push(<pre key={`b${key++}`} className="md-pre"><code>{body.join('\n')}</code></pre>);
      continue;
    }

    // List: consecutive bullet or numbered lines.
    const isBullet = /^\s*[-*]\s+/.test(line);
    const isNumber = /^\s*\d+\.\s+/.test(line);
    if (isBullet || isNumber) {
      const items: string[] = [];
      const ordered = isNumber;
      while (
        i < lines.length &&
        (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(lines[i]!)
      ) {
        items.push(lines[i]!.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
        i += 1;
      }
      const rendered = items.map((it, n) => (
        <li key={n}>{renderInline(it, `b${key}-l${n}`)}</li>
      ));
      blocks.push(
        ordered
          ? <ol key={`b${key++}`} className="md-list">{rendered}</ol>
          : <ul key={`b${key++}`} className="md-list">{rendered}</ul>,
      );
      continue;
    }

    // Blank lines separate paragraphs.
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Paragraph: gather until a blank line or a block-level construct.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^\s*[-*]\s+/.test(lines[i]!) &&
      !/^\s*\d+\.\s+/.test(lines[i]!) &&
      !lines[i]!.trimStart().startsWith('```')
    ) {
      para.push(lines[i]!);
      i += 1;
    }
    blocks.push(
      <p key={`b${key++}`} className="md-p">{renderInline(para.join(' '), `b${key}`)}</p>,
    );
  }

  return <>{blocks}</>;
}
