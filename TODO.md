# Patent Geyser — Open To-Dos

_Snapshot as of 2026-07-08. Everything below is outstanding; things already shipped are listed at the bottom for context._

---

## 🗓️ Scheduled — Friday: harden the diagrams service

**Service:** `patentgeyser-api` (Render, **Python 3, Starter** — now live), repo `Albanofg/diagrams-builder-pg`, Blueprint-managed (`render.yaml`), https://patentgeyser-api.onrender.com

Starter already removed sleep/cold-starts + gave more RAM. It does **not** fix the "one stuck render wedges the whole service until a manual restart" jam. Three changes fix that:

1. **Per-render hard timeout (the real fix).** Wrap the render in a **`ProcessPoolExecutor` + `future.result(timeout=N)`** (a thread can't force-kill a hung/CPU-bound render; a process can). App-side client gives up ~180s, so set **N ≈ 170s** and return HTTP 504 on timeout.
2. **Multiple workers + gunicorn backstop + recycling** in `render.yaml` `startCommand`, e.g.:
   `gunicorn app:app --workers 3 --threads 2 --timeout 200 --graceful-timeout 30 --max-requests 100 --max-requests-jitter 20`
   (replace `app:app`; if FastAPI add `--worker-class uvicorn.workers.UvicornWorker`)
3. **Keep the render off the request/event loop** (use the process pool / `run_in_executor`) and keep a fast `/health` that doesn't render.

➡️ **Need before finalizing exact commands:** paste `render.yaml` + the app entrypoint / render-function file so the generic message becomes exact code.

---

## 🔧 Open — small, ready to do

- **Admin: add `mercer@tomitrader.com`.** Already added in code (`lib/admin.ts`); needs a **deploy**. ALSO **check if `ADMIN_EMAILS` is set in the Vercel/production env** — if it is, it overrides the code list, so he must be added there too (comma-separated).

---

## ⏸️ Deferred — bigger / needs a decision

- **GPT → Gemini model migration (the big one).** Most drafting/analysis agents currently run on GPT; the intent from the start was Gemini-primary. Risk: GPT vs Gemini return different JSON shapes and can break structured outputs — treat as a real re-do, ~1 week+. **Needs sign-off from above; do NOT start until greenlit.** (Note: embeddings already run on Gemini — this is about the chat/drafting agents only.)
- **Device-switch / multi-user survival.** Per-project `moduleState` already persists in Postgres, but the pre-Conception **brainstorm session + current-stage pointer** may still be client-side (localStorage). Make them DB-backed so work survives device switches and is safe for two users later. ("We'll figure it out later.")
- **Figures storage scaling.** Generated diagram figures live in the project's `moduleState` jsonb blob; move them to Vercel Blob so large figure sets don't bloat the row.

---

## ✨ Families Phase 2 — optional polish (feature is shipped & working)

- **Per-agent retrieval `subject` — DONE for the 4 core content modules** (Conception, Maturation, Differentiation, Showcase; 31 agents). Each now queries semantic retrieval with a focused subject (concept title/statement, section key-concepts, or the piece under review) instead of its full instruction-laden prompt. **Remaining:** Module-0 brainstorm agents (deferred — pre-conception ideation, less central to overlap-catching) and Showcase's figure-planner (its prompt is already the draft content).
- **Reranking pass.** An optional rerank over the top-K retrieved passages. NOTE: a dedicated rerank API (Cohere/Voyage) is a **new vendor** — blocked without sign-off (per the no-new-vendors rule). The only no-vendor route is an extra LLM rerank call per retrieval, which adds latency/cost to every agent turn. Deferred pending a decision.

---

## ✅ Recently shipped (context, no action)

- **Project metadata on the ICB.** Inventor(s) / Application No. / Filed / Status now render as a cover block under the title in both the `.docx` and markdown export (each field shown only when set on the project's "Edit details"). New `getProjectMeta` getter + `IcbMeta` threaded through `assembleDisclosureDocx` / `assembleDisclosureMarkdown`.
- **Standalone tone-by-status.** Filing status (filed/granted/archived → maintenance tone) is now its own project-level `## PROJECT STATUS` block, emitted for standalone projects too — no longer gated behind family membership. Doctrine's tone rule lifted out of FAMILY AWARENESS.

- Diagram integration (plan-mode planner + re-viewable Drawings part of ICB + landscape docx sheets), gating (diagrams locked until Genus/Species; ICB/PoHC locked until diagrams), ICB filename + USPTO structure + Abstract-last.
- Admin AI-usage dashboard (`/admin`) + **Reindex families** button.
- Project Families: grouping, zero-AI overlap, family-aware Helper; **family editing** (name/description/background); **reference-document uploads** (PDF via Gemini, DOCX via mammoth).
- **Per-project details** (inventor names / filed date / status / application number / notes).
- **Semantic family retrieval (Phase 2)** — Gemini `gemini-embedding-001` @1536, pgvector/HNSW, feeding the Helper **and every working agent**, with the CORE "background only" guard. DDL applied + reindex run.
- Rule recorded: **no new external vendors/keys without explicit approval** (why we used Gemini embeddings, not Voyage).
