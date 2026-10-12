import Link from 'next/link';
import { Arrow, BrandMark, Doodle, Notebook, Sticker } from './_components/art';
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
    scene: 'scene-grass',
  },
  {
    n: 'II',
    title: 'knows when you said it',
    body: 'Ask for last week and you get last week. Time is a date column with an index, never a guess made by an embedding.',
    accent: 'var(--sky-sticker)',
    scene: 'scene-sky',
  },
  {
    n: 'III',
    title: 'finds the exact words',
    body: 'Name a library, an error code, a person. Keyword search sits beside the vector search so precise terms are never approximated away.',
    accent: 'var(--marker-orange)',
    scene: 'scene-dusk',
  },
  {
    n: 'IV',
    title: 'answers with receipts',
    body: 'Every answer carries the conversation it came from and the date you actually said it. An uncited answer is a bug.',
    accent: 'var(--bubblegum-sticker)',
    scene: 'scene-rose',
  },
  {
    n: 'V',
    title: 'never leaves your laptop',
    body: 'Your words are embedded on your own machine and stored in your own database. Nothing is uploaded to be indexed.',
    accent: 'var(--burnt-sienna)',
    scene: 'scene-paper',
  },
];

const DOODLES = [
  { kind: 'stack' as const, caption: 'every chat in\none place' },
  { kind: 'clock' as const, caption: '“last week”\nactually means it' },
  { kind: 'search' as const, caption: 'finds the exact\nword you typed' },
  { kind: 'quote' as const, caption: 'always shows\nits sources' },
  { kind: 'page' as const, caption: 'your notes live\nhere too' },
  { kind: 'lock' as const, caption: 'runs on your\nown machine' },
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
          <Notebook label="mayank" meta={['chats', '73']} tilt={-6} />
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

      {/* ---------------- doodle grid ---------------- */}
      <section className="grid-sec">
        <div className="doodle-grid">
          {DOODLES.map((d, i) => (
            <figure className="doodle-cell reveal" key={d.kind} data-delay={String((i % 3) + 1)}>
              <Doodle kind={d.kind} />
              <figcaption className="doodle-cap">{d.caption}</figcaption>
            </figure>
          ))}
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
