import Link from 'next/link';
import { Arrow, BrandMark, Doodle, Notebook, Sticker } from './_components/art';
import { HeroObject } from './_components/hero-object';
import { ScrollEffects } from './_components/reveal';

export const metadata = {
  title: 'Cortex — you already said it',
  description: 'A notebook that remembers your conversations, so you do not have to.',
};

const STEPS = [
  {
    n: 'I',
    title: 'remembers what you said',
    body: 'Every conversation you have ever exported, chunked by turn and kept whole — not shredded into arbitrary windows.',
    accent: 'var(--sprout-sticker)',
    scene: 'scene-meadow',
  },
  {
    n: 'II',
    title: 'knows when you said it',
    body: 'Ask for last week and you get last week. Time is a date column with an index, never a guess made by an embedding.',
    accent: 'var(--sky-sticker)',
    scene: 'scene-desk',
  },
  {
    n: 'III',
    title: 'finds the exact words',
    body: 'Name a library, an error code, a person. Keyword search sits beside the vector search so precise terms are never approximated away.',
    accent: 'var(--marker-orange)',
    scene: 'scene-desk',
  },
  {
    n: 'IV',
    title: 'answers with receipts',
    body: 'Every answer carries the conversation it came from and the date you actually said it. An uncited answer is a bug.',
    accent: 'var(--bubblegum-sticker)',
    scene: 'scene-bed',
  },
  {
    n: 'V',
    title: 'never leaves your laptop',
    body: 'Your words are embedded on your own machine and stored in your own database. Nothing is uploaded to be indexed.',
    accent: 'var(--burnt-sienna)',
    scene: 'scene-paper',
  },
];

/* Scattered, not gridded: each cell gets its own offset and rotation so the
   row reads as hand-placed, the way the reference does. */
const DOODLES = [
  { kind: 'stack'  as const, caption: 'every chat in\none place',        dx: -14, dy: 8,   rot: -4 },
  { kind: 'clock'  as const, caption: '“last week”\nactually means it',  dx: 10,  dy: -16, rot: 3 },
  { kind: 'search' as const, caption: 'finds the exact\nword you typed', dx: -6,  dy: 14,  rot: -2 },
  { kind: 'page'   as const, caption: 'your notes live\nhere too',       dx: 16,  dy: -6,  rot: 5 },
  { kind: 'quote'  as const, caption: 'always shows\nits sources',       dx: -12, dy: -12, rot: -3 },
  { kind: 'lock'   as const, caption: 'runs on your\nown machine',       dx: 8,   dy: 10,  rot: 4 },
];

const NO_LIST = [
  'no ads', 'no tracking', 'no data-selling', 'no cloud indexing',
  'no account', 'no telemetry', 'no third-party embeds',
];

export default function Landing() {
  return (
    <div className="land">
      <ScrollEffects />

      <header className="land-head">
        <Link href="/" aria-label="Cortex, home" className="land-brand">
          <BrandMark />
        </Link>
        <Link href="/ask" className="pill">open my notebook</Link>
      </header>

      {/* ---------------- hero ---------------- */}
      <section className="hero">
        <div className="hero-copy">
          <p className="caption-hand reveal">Dear forgetful me,</p>
          <h1 className="display reveal" data-delay="1">
            you already<br />said it
          </h1>
          <p className="lede reveal" data-delay="2">
            It&rsquo;s a notebook that <span className="marker">actually</span> remembers
            <br />what you talked about
          </p>
          <div className="reveal" data-delay="3">
            <Link href="/ask" className="pill hero-cta">ask it something</Link>
            <p className="fineprint hero-note">
              Runs on your machine. 1,070 pieces of your history, already indexed.
            </p>
          </div>
        </div>

        <div className="hero-art reveal" data-delay="2">
          <HeroObject src="/scenes/notebook-hero.png" label="mayank" meta={['chats', '73']} />
          <Sticker kind="bolt"  rotate={-14} className="st st-a" />
          <Sticker kind="blob"  rotate={11}  className="st st-b" />
          <Sticker kind="heart" rotate={-8}  className="st st-c" />
          <Sticker kind="spark" rotate={18}  className="st st-d" />
        </div>
      </section>

      {/* ---------------- typographic breath ---------------- */}
      <section className="breath">
        <h2 className="heading reveal">
          Everyyyything you said.<br />Nothing you have to remember.
        </h2>
      </section>

      {/* ---------------- pinned feature walk ---------------- */}
      <section className="walk" data-steps data-active="0">
        <div className="walk-scenes" aria-hidden>
          {STEPS.map((s, i) => (
            <div key={s.n} className={`walk-scene ${s.scene}`} data-i={i} />
          ))}
        </div>

        <div className="walk-body">
        <div className="walk-panel card">
          <h3 className="heading-sm walk-title">
            it&rsquo;s kinda like<br />
            <span className="walk-title-accent">a mind that keeps notes</span>
          </h3>
          <ol className="walk-list">
            {STEPS.map((s, i) => (
              <li key={s.n} data-i={i} style={{ ['--accent' as string]: s.accent }}>
                <span className="walk-item-title">{s.title}</span>
                <span className="walk-item-n">{s.n}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="walk-steps">
          {STEPS.map((s, i) => (
            <article className="walk-step" key={s.n} data-step={i}>
              <span className="walk-step-n" style={{ color: s.accent }}>{s.n}</span>
              <h4 className="heading walk-step-title">{s.title}</h4>
              <p className="lede walk-step-body">{s.body}</p>
            </article>
          ))}
        </div>
        </div>
      </section>

      {/* ---------------- scattered doodles ---------------- */}
      <section className="grid-sec">
        <div className="grid-head reveal">
          <p className="caption-hand grid-ann">soooo much</p>
          <h2 className="heading">And there&rsquo;s other<br />cool stuff too!</h2>
        </div>
        <div className="doodle-grid">
          {DOODLES.map((d, i) => (
            <figure
              className="doodle-cell reveal"
              key={d.kind}
              data-delay={String((i % 3) + 1)}
              style={{ transform: `translate(${d.dx}px, ${d.dy}px)` }}
            >
              <span className="doodle-wrap" style={{ transform: `rotate(${d.rot}deg)` }}>
                <Doodle kind={d.kind} />
              </span>
              <figcaption className="doodle-cap">{d.caption}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ---------------- the no-list ---------------- */}
      <section className="nolist">
        <div className="nolist-head reveal">
          <h2 className="heading">Safe &amp; quiet</h2>
          <p className="fineprint nolist-sub">We know the no-list matters more than the yes-list.</p>
        </div>

        <div className="nolist-body">
          <span className="nolist-side nolist-l1">
            <Sticker kind="star" rotate={-9} />
            <em>built for<br />remembering</em>
          </span>
          <span className="nolist-side nolist-l2">
            <Sticker kind="ghost" rotate={7} />
            <em>nothing<br />phones home</em>
          </span>

          <div className="notepaper reveal" data-delay="1">
            <ul>
              {NO_LIST.map((n) => (
                <li key={n}><span className="x" aria-hidden>✕</span>{n}</li>
              ))}
            </ul>
          </div>

          <span className="nolist-side nolist-r1">
            <Sticker kind="spark" rotate={12} />
            <em>local-first<br />by default</em>
          </span>
          <span className="nolist-side nolist-r2">
            <Sticker kind="heart" rotate={-6} />
            <em>designed<br />for care</em>
          </span>
        </div>
      </section>

      {/* ---------------- showcase ---------------- */}
      <section className="showcase">
        <div className="show-item show-left reveal">
          <div className="show-label">
            <p className="caption-hand">a whole year of chats</p>
            <Arrow className="show-arrow-l" />
          </div>
          <Notebook cover="#8fbce8" spine="#6f9ecd" label="claude" meta={['chats', '73']} tilt={-9} />
        </div>

        <div className="show-mid reveal" data-delay="1">
          <p className="caption-hand">Like keeping</p>
          <h2 className="heading">Your memory.<br />Your machine.</h2>
          <Sticker kind="star" rotate={-12} className="st st-mid" />
        </div>

        <div className="show-item show-right reveal" data-delay="2">
          <div className="show-label show-label-r">
            <Arrow flip className="show-arrow-r" />
            <p className="caption-hand">and your own notes</p>
          </div>
          <Notebook cover="#f0b3bd" spine="#d9929e" label="notes" meta={['files', '∞']} tilt={7} />
        </div>
      </section>

      {/* ---------------- footer band ---------------- */}
      <footer className="band">
        <div className="band-inner">
          <div>
            <p className="caption-hand band-cap">that&rsquo;s the whole idea</p>
            <h2 className="heading band-title">stop re-asking<br />what you already know</h2>
          </div>
          <div className="band-side">
            <Link href="/ask" className="pill band-cta">ask it something</Link>
            <p className="fineprint band-note">
              Embeddings run locally · your database · no tracking
            </p>
          </div>
        </div>
        <div className="band-foot">
          <span><BrandMark /></span>
          <span className="band-links">
            <Link href="/ask">ask</Link>
            <Link href="/browse">browse</Link>
            <Link href="/status">status</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
