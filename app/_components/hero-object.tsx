'use client';

import { useState } from 'react';
import { Notebook } from './art';

/**
 * The hero object, preferring a generated render when one exists.
 *
 * Client-side because detecting a missing image needs an onError handler, which
 * a server component cannot pass. The drawn notebook stays underneath as the
 * fallback, so the page is never broken while artwork is being produced, and
 * the label is drawn on top either way -- it carries live numbers rather than
 * being baked into the image.
 */
export function HeroObject({ src, label, meta }: {
  src: string; label: string; meta: [string, string];
}) {
  const [hasImage, setHasImage] = useState(true);

  return (
    <span className="hero-object">
      <Notebook label={label} meta={meta} tilt={-6} />
      {hasImage && (
        <img
          src={src}
          alt=""
          className="hero-photo"
          onError={() => setHasImage(false)}
        />
      )}
    </span>
  );
}
