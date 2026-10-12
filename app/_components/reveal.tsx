'use client';

import { useEffect } from 'react';

/**
 * Reveal-on-scroll, and the active-step tracking for the pinned section.
 *
 * IntersectionObserver rather than a scroll listener or an animation library:
 * it fires off the main thread, needs no dependency, and the pinned panel is
 * plain `position: sticky`, which is what the reference is doing anyway.
 */
export function ScrollEffects() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const items = document.querySelectorAll<HTMLElement>('.reveal');
    if (reduced) {
      items.forEach((el) => el.classList.add('in'));
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add('in');
              io.unobserve(e.target); // reveal once; re-animating on scroll-up is noise
            }
          }
        },
        { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
      );
      items.forEach((el) => io.observe(el));
      var revealObserver = io;
    }

    // Pinned feature section: the step whose panel is crossing the middle of
    // the viewport is the active one, which drives both the list and the scene.
    const steps = Array.from(document.querySelectorAll<HTMLElement>('[data-step]'));
    const stepObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          const group = el.closest('[data-steps]');
          if (!group) continue;
          const index = el.dataset.step!;
          group.setAttribute('data-active', index);
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );
    steps.forEach((el) => stepObserver.observe(el));

    // Hero object: scales up and drifts as the copy scrolls past it, which is
    // what the reference does. rAF-throttled so the scroll handler never does
    // layout work more than once a frame.
    const art = document.querySelector<HTMLElement>('.hero-art');
    let ticking = false;
    function onScroll() {
      if (ticking || !art || reduced) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const span = window.innerHeight;
        const t = Math.min(1, Math.max(0, y / span));
        art!.style.setProperty('--scroll-scale', String(1 + t * 0.28));
        art!.style.setProperty('--scroll-rise', `${t * -42}px`);
        ticking = false;
      });
    }
    if (!reduced) {
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    return () => {
      revealObserver?.disconnect();
      stepObserver.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return null;
}
