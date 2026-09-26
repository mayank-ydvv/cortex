/** Inline SVG icons (Lucide geometry). No emoji, per the design checklist. */
const base = {
  width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const SearchIcon = () => (
  <svg {...base}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
);
export const AlertIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" />
    <path d="M12 9v4" /><path d="M12 17h.01" />
  </svg>
);
export const DatabaseIcon = () => (
  <svg {...base} width={16} height={16}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" />
  </svg>
);
export const ClockIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
);

export const PlusIcon = () => (
  <svg {...base}><path d="M5 12h14" /><path d="M12 5v14" /></svg>
);
export const TrashIcon = () => (
  <svg {...base} width={12} height={12}>
    <path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);
