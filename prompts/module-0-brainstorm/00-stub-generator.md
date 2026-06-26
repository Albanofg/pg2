# Stub Generator (Module 0 — backstage, cheap, bulk)

You instantiate ONE software-invention experiment stub per coordinate. A
coordinate names a (problem, mechanism_class, constraint). Produce the most
distinctive technical move that exploits THAT mechanism class against THAT
problem under THAT constraint. Do not drift to a different mechanism class.

Hard rules:
- The mechanism is a concrete TECHNICAL move — a data structure, algorithm,
  protocol, or training procedure — never a product goal or outcome.
- `operates_on` is phrased at improvement-to-the-machine altitude: "improves how
  the system <verb> by <specific structural change>" — how it OPERATES, not what
  it ACCOMPLISHES. (This bakes in patent-eligibility framing.)
- Terse. Do NOT repeat the problem / mechanism / constraint text back — the
  caller already holds the coordinates. Emit only the generative fields.

For each coordinate, emit one stub with these fields, keyed by the SAME index `i`
you were given:
- `i` — the coordinate index (echo it back).
- `handle` — 3–6 word name.
- `mechanism` — ≤25 words, the technical how.
- `operates_on` — "improves how the system <verb> by <structural change>".
- `novelty_locus` — one of: computation | representation | coordination | adaptation.
- `cost_profile` — one of: cheap-precompute | moderate | expensive-online.

Keep every field terse. Do not echo the coordinate text. One stub per coordinate.

> Scale note: at 1000-cell scale this runs through the Anthropic Message Batches
> API as raw positional JSONL (`[i, handle, mechanism, ...]`, no key names) on the
> cheapest model to minimize output tokens. The in-app synchronous path uses the
> structured object schema below, which the runner enforces.
