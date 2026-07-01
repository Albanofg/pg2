import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="max-w-2xl text-center animate-fade-in">
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-action">
          Invention Concept Blueprint Mesh
        </p>
        <h1 className="font-sans text-5xl font-bold leading-tight tracking-tight text-ink">
          Patent Geyser <span className="text-accent">2.0</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl font-mono text-sm leading-relaxed text-ink-muted">
          The system does not write <span className="text-ink">for</span> you. It
          extracts the genius <span className="text-ink">from</span> you. A
          rigorous Socratic mesh that produces an Invention Concept Blueprint
          mathematically guaranteed to be 100% human-conceived — sealed with a
          cryptographic timestamp.
        </p>

        <div className="mt-10 flex items-center justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-accent px-5 py-3 font-sans text-sm font-medium text-brand transition-colors duration-150 ease-util hover:bg-accent/90"
          >
            Get started
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-border px-5 py-3 font-sans text-sm font-medium text-ink transition-colors duration-150 ease-util hover:border-accent/50"
          >
            Log in
          </Link>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-4 text-left sm:grid-cols-3">
          {[
            {
              t: "The AI never invents",
              d: "A two-agent verification loop rejects any mechanism not stated by you.",
            },
            {
              t: "The Disavowal Loop",
              d: "Highlight anything you disagree with. The mesh invalidates downstream and regenerates.",
            },
            {
              t: "Inventor's Notebook",
              d: "Every input sealed via RFC 3161 to prove the exact moment of conception.",
            },
          ].map((f) => (
            <div
              key={f.t}
              className="rounded-md border border-border bg-panel p-4"
            >
              <h3 className="font-sans text-sm font-semibold text-ink">{f.t}</h3>
              <p className="mt-2 font-mono text-xs leading-relaxed text-ink-muted">
                {f.d}
              </p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
