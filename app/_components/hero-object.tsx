'use client';

import { useState } from 'react';
import { Notebook } from './art';

export interface ObjectProps {
  src: string;
  label: string;
  meta: [string, string];
  /** Fallback cover colours, used only when the image is missing. */
  cover?: string;
  spine?: string;
  tilt?: number;
  /** Where the label sits on the cover, as % of the image box. */
  labelX?: number;
  labelY?: number;
  labelRotate?: number;
  className?: string;
}

/**
 * A notebook object: generated render, with the name label drawn on top.
 *
 * The label is drawn rather than baked into the image so it can carry live
 * numbers, and so one render can be reused with different labels.
 *
 * The renders sit on white, and the page is cream. `mix-blend-mode: multiply`
 * drops the white to the page colour and keeps the drop shadow intact, which
 * cutting the background out would not -- a hard alpha cut leaves a halo where
 * the soft shadow was.
 */
export function NotebookObject({
  src, label, meta, cover, spine, tilt = -6,
  labelX = 41, labelY = 47, labelRotate = -1.5, className = '',
}: ObjectProps) {
  const [hasImage, setHasImage] = useState(true);

  if (!hasImage) {
    return (
      <span className={`nb-object ${className}`}>
        <Notebook label={label} meta={meta} cover={cover} spine={spine} tilt={tilt} />
      </span>
    );
  }

  return (
    <span className={`nb-object ${className}`}>
      <img src={src} alt="" className="nb-photo" onError={() => setHasImage(false)} />
      <span
        className="nb-label"
        style={{
          left: `${labelX}%`,
          top: `${labelY}%`,
          transform: `translate(-50%, -50%) rotate(${labelRotate}deg)`,
        }}
      >
        <span className="nb-label-row nb-label-top">
          <span className="nb-label-key">Name</span>
          <span className="nb-label-name">{label}</span>
        </span>
        <span className="nb-label-row">
          <span className="nb-label-cell">
            <span className="nb-label-key">{meta[0]}</span>
          </span>
          <span className="nb-label-cell nb-label-cell-r">
            <span className="nb-label-key">total</span>
            <span className="nb-label-val">{meta[1]}</span>
          </span>
        </span>
      </span>
    </span>
  );
}
