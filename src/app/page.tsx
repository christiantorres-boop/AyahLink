import { ProcessorForm } from "@/components/ProcessorForm";

export default function Home() {
  return (
    <main className="page">
      <section className="hero">
        <header className="nav">
          <div className="brand">AyahLink</div>
          <a className="nav-cta" href="#start">
            Start here
          </a>
        </header>

        <div className="hero-stage">
          <div className="hero-copy">
            <p className="hero-arabic" dir="rtl" lang="ar">
              وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا
            </p>
            <h1>AyahLink</h1>
            <p>
              Upload your Qur’an recording. We add clear English after every
              verse, so you can listen and understand, one ayah at a time.
            </p>
            <div className="hero-actions">
              <a className="primary-btn" href="#start">
                Make my audio
              </a>
              <a className="ghost-btn" href="#simple-steps">
                Show me how (3 steps)
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="simple-steps" className="explain-band" aria-label="How it works">
        <h2>How it works</h2>
        <p className="explain-lead">
          You do not need any technical knowledge. Just follow these three steps.
        </p>
        <ol className="explain-steps">
          <li>
            <span className="step-num" aria-hidden="true">
              1
            </span>
            <div>
              <strong>Upload your recording</strong>
              <p>Pick an MP3 or MP4 of someone reciting the Qur’an.</p>
            </div>
          </li>
          <li>
            <span className="step-num" aria-hidden="true">
              2
            </span>
            <div>
              <strong>We detect the verses</strong>
              <p>
                AyahLink listens and figures out the Surah and ayahs for you.
              </p>
            </div>
          </li>
          <li>
            <span className="step-num" aria-hidden="true">
              3
            </span>
            <div>
              <strong>Download your new file</strong>
              <p>
                You get one audio: Arabic → English → Arabic → English…
              </p>
            </div>
          </li>
        </ol>
      </section>

      <ProcessorForm />

      <footer className="site-footer">
        <p>
          Tip: Use a clear recording of one Surah with short pauses between
          verses for the best result. Need help? Try Surah Al-Fatihah.
        </p>
      </footer>
    </main>
  );
}
