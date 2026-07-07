# Diagram Service — "Plan Mode" (accept a ready-made plan, skip the planner)

**Audience:** the maintainer of the PatentGeyser diagram service (the FastAPI +
Matplotlib repo behind `https://patentgeyser-api.onrender.com`).
**Author:** the consuming app ("app 2" / PatentGeyser front end).
**Status:** requested change. Nothing in your repo has been edited — this is a spec.

---

## 1. Why

Today `POST /api/v1/generate` takes raw `text` and runs the **whole** brain:
`planner → drafter → layout → render`. The consuming app then has no reliable way
to describe the drawings (the planner's `briefDescription`, the numeral ledger, and
the per-figure graph are computed and then discarded at the API boundary).

We're **inverting the pipeline**. The consuming app already holds the full
disclosure and its own LLM stack, so **it will run the planner itself** and hand
you a finished plan. Your service should **skip its planner** and run only
`drafter → layout → render` from the plan we send.

Wins for you:

- **Less work per request** — you drop the planner call entirely (the big LLM pass
  over the whole disclosure). One fewer model round-trip.
- **Bounded input** — you receive a compact structured plan, never a giant spec
  blob. Input size no longer scales with the disclosure.
- **No new brain to build** — your **drafter already consumes this exact input**
  (`FIGURE_ASSIGNMENT` + `NUMERAL_LEDGER`, see `drafter.leap.md`). Plan mode just
  supplies those from the request body instead of from an internal planner call.

What this does **not** change: the drafter, layout engine, and Matplotlib renderer
stay exactly as they are. This is not a rendering-performance change.

---

## 2. What to add

1. A **new endpoint** `POST /api/v1/draw` that accepts a plan and returns figures.
   (Keep `POST /api/v1/generate` exactly as-is for backward compatibility.)
2. Internally: **do not call the planner.** For each figure in the plan, call your
   existing drafter with that figure as its `FIGURE_ASSIGNMENT` and the plan's
   `numerals` as the `NUMERAL_LEDGER`, then layout + render as you do now.
3. In the response, per figure, also return **`figNumber`** and the **`numerals`
   actually drawn** (after the drafter's legibility budget), so the caller can
   match each rendered figure to its plan entry and reconcile its description.

Auth (`X-API-Key`), `GET /health`, `MAX_FIGURES` cap, timeouts, and error shapes
are all **unchanged** and apply to `/api/v1/draw` identically.

---

## 3. `POST /api/v1/draw` — request

Headers: same as `/generate` — `Content-Type: application/json`, `X-API-Key: <key>`.

```jsonc
{
  "plan": {
    "figures": [
      {
        "figNumber": 1,
        "figType": "system",          // system|module|flowchart|dataflow|sequence|state|hardware|record
        "title": "System Architecture Overview",
        "outline": "Draw DEVICE (100) as a container. Inside it: LOCAL ACTIVITY CAPTURE INTERFACE (102) coupled to COMMIT TRIGGER DETECTOR (104); (104) sends CURRENT STATE to CURRENT STATE NORMALIZER (106); ... State every element with its numeral and catchword, every connection and its nature, every containment — in drawing order.",
        "numerals": ["100", "102", "104", "106"]   // the numerals THIS figure uses
      }
      // ...up to MAX_FIGURES
    ],
    "numerals": [
      { "ref": "100", "feature": "Device", "figures": [1], "definedInSpec": false },
      { "ref": "102", "feature": "Local Activity Capture Interface", "figures": [1, 2], "definedInSpec": true }
      // ...the global ledger: ref → canonical feature name, across the whole set
    ]
  },
  "spec": "optional short context string"   // OPTIONAL — see §5
}
```

Field reference:

| Field | Type | Required | Notes |
|---|---|---|---|
| `plan.figures[]` | array | yes | One entry per figure to draw. This IS the planner's output — each entry is a ready `FIGURE_ASSIGNMENT` for your drafter. |
| `plan.figures[].figNumber` | int | yes | 1-based. Echoed back in the response for matching. |
| `plan.figures[].figType` | enum | yes | One of your existing drafter figTypes. |
| `plan.figures[].title` | string | yes | Use verbatim as the figure title (don't re-derive it). |
| `plan.figures[].outline` | string | yes | **Authoritative** drawing instructions (see §5). Names every element with numeral + catchword, every connection, every containment, in drawing order. Your planner's STEP 5 output. |
| `plan.figures[].numerals[]` | string[] | yes | The numerals this figure is allowed to use. Your drafter's "allowed numeral set". |
| `plan.numerals[]` | array | yes | The global numeral **ledger** — `ref → feature`, exactly your planner's `numerals` output. Feed as `NUMERAL_LEDGER`. |
| `spec` | string | no | Optional extra context. Usually unneeded — the outline is self-sufficient (§5). |

The consuming app may include extra fields on figures (e.g. `briefDescription`,
`detailedDescription`, `illustrates`). **Ignore any field you don't need** — those
are for the caller's document, not for drawing.

---

## 4. `POST /api/v1/draw` — response (`200 OK`)

Same shape as `/generate`'s response, plus `figNumber` and `numerals`:

```jsonc
{
  "figures": [
    {
      "figNumber": 1,                  // NEW — matches plan.figures[].figNumber
      "id": "fig-1",                   // keep for backward-compat with /generate
      "title": "System Architecture Overview",
      "svgData": "<svg …>…</svg>",
      "pdfBase64": "JVBERi0…",
      "numerals": ["100", "102", "104", "106"]   // NEW — numerals ACTUALLY placed
    }
    // ...one per figure successfully drawn, in figNumber order
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `figNumber` | int | The plan's `figNumber` for this figure. Lets the caller join svg/pdf back to its plan entry (and its description). **Required** for the caller. |
| `numerals` | string[] | The numerals your drafter **actually rendered** after its S4 legibility budget (which may drop nodes beyond ~10). The caller uses this to trim/annotate its description so text and drawing never disagree. |
| `id`, `title`, `svgData`, `pdfBase64` | — | Same as `/generate` today. |

Order the array by `figNumber`.

---

## 5. Drafter behavior under plan mode

Two invariants — both are already in `drafter.leap.md`, just restated for this path:

1. **THE LEDGER IS LAW.** Use only numerals in that figure's `numerals` set, each on
   the feature the global `numerals` ledger names. Never invent, renumber, or borrow
   another figure's numeral. (Your drafter's existing prime directive.)
2. **THE OUTLINE IS AUTHORITATIVE.** In plan mode, the caller's planner guarantees
   each `outline` is *self-sufficient* — it already states every element, every
   connection and its nature, and every containment, in drawing order. So the drafter
   should draw **from the outline** and must **not** invent structure the outline
   doesn't state. The optional `spec` is only fallback context; if absent, the
   outline stands alone.

Everything else in your drafter state machine (S0–S6: routing by figType, the
per-figType sub-machines, the label/legibility/verify gates) runs unchanged.

---

## 6. Minimal implementation checklist

- [ ] Add `PlanFigure`, `LedgerEntry`, `DrawRequest` request models mirroring §3
      (`figNumber, figType, title, outline, numerals[]` per figure; `ref, feature,
      figures[], definedInSpec` per ledger row). Extra inbound fields ignored.
- [ ] Add `figNumber: int` and `numerals: list[str]` to the response figure model
      (extend the existing `GeneratedFigure`, or a sibling model for this route).
- [ ] Add `POST /api/v1/draw`. Auth + validation identical to `/generate`.
- [ ] Handler: **skip the planner.** For each `plan.figures[i]`: call the existing
      drafter with `FIGURE_ASSIGNMENT = plan.figures[i]`, `NUMERAL_LEDGER =
      plan.numerals` (and `SPECIFICATION = spec or ""`), then layout + render as now.
- [ ] Collect the numerals actually placed by the drafter for each figure and return
      them (`numerals`) alongside `figNumber`.
- [ ] Cap at `MAX_FIGURES`; return `400` if `plan.figures` is empty or malformed;
      reuse existing `500`/timeout handling.
- [ ] Leave `POST /api/v1/generate` untouched.

---

## 7. Validation the caller will do

The consuming app will:
- Send a plan whose `figures[].numerals` are all present in the global `numerals`
  ledger (no dangling refs).
- Match each response figure by `figNumber`, then reconcile its stored description
  against the returned `numerals` (dropping any numeral the drawing didn't render).

So the contract the caller depends on is: **`figNumber` is echoed back, and
`numerals` reflects what was actually drawn.** Those two fields are the only hard
additions; everything else is your existing `/generate` behavior minus the planner.

---

*Questions on the request/response shapes → ask the app-2 side. This spec is
versioned with the app-2 planner that produces the plan; if the plan schema in §3
changes, this file is updated in the app-2 repo (`DIAGRAM_SERVICE_PLAN_MODE.md`).*
