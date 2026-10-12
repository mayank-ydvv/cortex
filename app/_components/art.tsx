import { useId } from 'react';

/**
 * Illustrated objects.
 *
 * The reference is photography-forward, but there is no physical product here
 * to photograph. These are drawn instead, in the same flat 2px-outline language
 * the sticker and arrow components already specify — so the page still leads
 * with an object rather than with abstract UI chrome.
 */

/** The hero object: a notebook with a laminated name label on the cover. */
export function Notebook({
  cover = '#a97c50',
  spine = '#8a633d',
  label = 'mayank',
  meta = ['notes', '1,070'],
  tilt = -6,
}: {
  cover?: string; spine?: string; label?: string;
  meta?: [string, string] | string[]; tilt?: number;
}) {
  // Unique per instance: several notebooks share a page, and a fixed gradient
  // id would make every one of them inherit the first one's colour.
  const uid = useId().replace(/:/g, '');
  const faceId = `nbFace-${uid}`;
  const shadowId = `nbShadow-${uid}`;

  return (
    <svg viewBox="0 0 420 540" className="nb" style={{ ['--tilt' as string]: `${tilt}deg` }}
         role="img" aria-label="A notebook with a name label on the cover">
      <defs>
        <linearGradient id={faceId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={cover} />
          <stop offset="100%" stopColor={spine} />
        </linearGradient>
        <filter id={shadowId} x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="14" stdDeviation="18" floodColor="#2b1a07" floodOpacity="0.18" />
        </filter>
      </defs>

      <g filter={`url(#${shadowId})`}>
        {/* pages peeking out on the right edge */}
        <rect x="42" y="26" width="344" height="486" rx="16" fill="#efe7df" />
        <rect x="46" y="30" width="340" height="478" rx="15" fill="#f8f3ed" />
        {/* cover */}
        <rect x="30" y="18" width="346" height="494" rx="17" fill={`url(#${faceId})`} />
        {/* spine */}
        <path d="M30 35a17 17 0 0 1 17-17h26v494H47a17 17 0 0 1-17-17z" fill={spine} opacity="0.55" />
        {/* elastic band */}
        <rect x="330" y="18" width="13" height="494" fill="#00000018" />
      </g>

      {/* pencil tucked alongside, as in every reference frame */}
      <g transform="translate(372 150) rotate(4)">
        <rect x="0" y="0" width="22" height="300" rx="4" fill="#f5c542" />
        <rect x="0" y="0" width="7"  height="300" fill="#00000012" />
        <rect x="0" y="-26" width="22" height="26" rx="3" fill="#e8a0a8" />
        <rect x="0" y="-32" width="22" height="7" fill="#c9ccd1" />
        <path d="M0 300h22l-11 26z" fill="#e8c9a0" />
        <path d="M5.5 313l5.5 13 5.5-13z" fill="#2b1a07" />
      </g>

      {/* name label */}
      <g transform="translate(96 196)">
        <rect x="0" y="0" width="226" height="104" rx="8" fill="#fffdfb" stroke="#171717" strokeWidth="1.6" />
        <line x1="0" y1="64" x2="226" y2="64" stroke="#171717" strokeWidth="1.2" />
        <line x1="132" y1="64" x2="132" y2="104" stroke="#171717" strokeWidth="1.2" />
        <text x="12" y="20" className="nb-key">Name</text>
        <text x="20" y="52" className="nb-name">{label}</text>
        <text x="12" y="82" className="nb-key">{meta[0]}</text>
        <text x="144" y="82" className="nb-key">total</text>
        <text x="186" y="95" className="nb-val">{meta[1]}</text>
      </g>
    </svg>
  );
}

/** Flat sticker characters. Rotated by the caller, never grid-aligned. */
export function Sticker({ kind, rotate = 0, className = '' }: {
  kind: 'bolt' | 'blob' | 'heart' | 'ghost' | 'star' | 'spark';
  rotate?: number; className?: string;
}) {
  const s = { transform: `rotate(${rotate}deg)` };
  const stroke = { stroke: '#171717', strokeWidth: 2.4, strokeLinejoin: 'round' as const };

  if (kind === 'bolt')
    return (
      <svg viewBox="0 0 44 56" className={`sticker ${className}`} style={s} aria-hidden>
        <path d="M24 3 7 32h12l-3 21 20-30H24l4-20z" fill="#ff6f1e" {...stroke} />
      </svg>
    );
  if (kind === 'blob')
    return (
      <svg viewBox="0 0 52 50" className={`sticker ${className}`} style={s} aria-hidden>
        <path d="M26 3c7 0 9 5 14 6s9 4 9 11-5 9-6 14-4 13-11 13-9-4-14-5-13 1-15-7 3-11 2-16 4-16 11-16z"
              fill="#3b82f6" {...stroke} />
        <circle cx="19" cy="25" r="3.4" fill="#171717" />
        <circle cx="33" cy="25" r="3.4" fill="#171717" />
        <path d="M22 34c3 3 7 3 10 0" fill="none" stroke="#171717" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  if (kind === 'heart')
    return (
      <svg viewBox="0 0 50 46" className={`sticker ${className}`} style={s} aria-hidden>
        <path d="M25 42S4 29 4 16A11 11 0 0 1 25 11 11 11 0 0 1 46 16c0 13-21 26-21 26z"
              fill="#ff66cf" {...stroke} />
        <circle cx="18" cy="19" r="2.8" fill="#171717" />
        <circle cx="32" cy="19" r="2.8" fill="#171717" />
      </svg>
    );
  if (kind === 'ghost')
    return (
      <svg viewBox="0 0 44 52" className={`sticker ${className}`} style={s} aria-hidden>
        <path d="M22 3c10 0 17 8 17 18v28l-6-5-6 5-5-5-5 5-6-5V21C11 11 12 3 22 3z"
              fill="#171717" {...stroke} />
        <circle cx="16" cy="23" r="3.2" fill="#fdfbf9" />
        <circle cx="29" cy="23" r="3.2" fill="#fdfbf9" />
      </svg>
    );
  if (kind === 'star')
    return (
      <svg viewBox="0 0 46 46" className={`sticker ${className}`} style={s} aria-hidden>
        <path d="M23 3l6 13 14 2-10 10 2 14-12-7-12 7 2-14L3 18l14-2z" fill="#22c55e" {...stroke} />
      </svg>
    );
  return (
    <svg viewBox="0 0 34 34" className={`sticker ${className}`} style={s} aria-hidden>
      <path d="M17 2l3.4 11.6L32 17l-11.6 3.4L17 32l-3.4-11.6L2 17l11.6-3.4z"
            fill="#ff6f1e" {...stroke} />
    </svg>
  );
}

/** Thin curved connector from a caption to the thing it labels. */
export function Arrow({ d, flip = false, className = '' }: {
  d?: string; flip?: boolean; className?: string;
}) {
  return (
    <svg viewBox="0 0 90 70" className={`arrow ${className}`} aria-hidden
         style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d={d ?? 'M6 6c26 4 44 18 52 44'} fill="none" stroke="#171717"
            strokeWidth="1.6" strokeLinecap="round" />
      <path d="M50 44l8 8 10-4" fill="none" stroke="#171717"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Line doodles for the feature grid, drawn in one ink weight. */
export function Doodle({ kind }: {
  kind: 'stack' | 'page' | 'clock' | 'lock' | 'search' | 'quote';
}) {
  const p = { fill: 'none', stroke: '#171717', strokeWidth: 1.9,
              strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 64 64" className="doodle" aria-hidden>
      {kind === 'stack' && (
        <>
          <path d="M10 22l22-10 22 10-22 10z" {...p} />
          <path d="M10 34l22 10 22-10" {...p} />
          <path d="M10 44l22 10 22-10" {...p} />
        </>
      )}
      {kind === 'page' && (
        <>
          <path d="M16 8h22l12 12v36H16z" {...p} />
          <path d="M38 8v12h12" {...p} />
          <path d="M24 32h18M24 40h18M24 48h12" {...p} />
        </>
      )}
      {kind === 'clock' && (
        <>
          <circle cx="32" cy="32" r="22" {...p} />
          <path d="M32 18v15l10 6" {...p} />
        </>
      )}
      {kind === 'lock' && (
        <>
          <rect x="14" y="28" width="36" height="26" rx="5" {...p} />
          <path d="M22 28v-7a10 10 0 0 1 20 0v7" {...p} />
          <circle cx="32" cy="41" r="3" {...p} />
        </>
      )}
      {kind === 'search' && (
        <>
          <circle cx="28" cy="28" r="16" {...p} />
          <path d="M40 40l14 14" {...p} />
        </>
      )}
      {kind === 'quote' && (
        <>
          <path d="M12 44h40l-8 10z" {...p} />
          <rect x="12" y="12" width="40" height="32" rx="6" {...p} />
          <path d="M22 24h20M22 32h14" {...p} />
        </>
      )}
    </svg>
  );
}

/** The brand mark: a small pointing hand, no wordmark beside it. */
export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" className="brandmark" aria-hidden>
      <path d="M13 24V10a2.4 2.4 0 0 1 4.8 0v6M17.8 17v-2.6a2.4 2.4 0 0 1 4.8 0V18"
            fill="none" stroke="#171717" strokeWidth="2" strokeLinecap="round" />
      <path d="M22.6 18v-1.4a2.4 2.4 0 0 1 4.8 0V22c0 4.4-3.2 7.6-7.6 7.6h-2.2c-3 0-4.6-1.4-6.2-3.6l-4-5.6a2.3 2.3 0 0 1 3.6-2.8L13 20"
            fill="none" stroke="#171717" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


/**
 * The hero object, preferring a generated render when one exists.
 *
 * The drawn notebook stays as the fallback so the page is never broken while
 * artwork is being produced; the label is drawn on top either way, so it always
 * carries real numbers rather than being baked into the image.
 */
export function HeroObject({ src, label, meta }: {
  src: string; label: string; meta: [string, string];
}) {
  return (
    <span className="hero-object">
      {/* Drawn version underneath: visible until the image loads, and the only
          thing shown if the file is absent. */}
      <Notebook label={label} meta={meta} tilt={-6} />
      <img
        src={src}
        alt=""
        className="hero-photo"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    </span>
  );
}
