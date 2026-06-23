# Patent Geyser 2.0

A multi-agent Socratic drafting mesh for software provisional patents. The system never invents — it uses a rigorous Socratic method to extract the genius from the inventor, producing a draft mathematically guaranteed to be human-conceived and sealed with an RFC 3161 cryptographic timestamp.

## What's in the box

The whole spec is implemented as a **Next.js 14 (App Router)** app:

- **The Triptych workspace** — three fluidly resizable panes: the Brain (left), the Socratic Helper (center), the Live Draft (right). `components/workspace/`
- **The Helper + the Mesh** — a Helper agent that asks one surgical question per turn, and a background Drafter→Verifier loop that refuses to introduce any technical substance the inventor didn't state (the `GapDetected` fallback). `lib/ai/`
- **The Shared Consciousness** — a DAG of nodes in Postgres; disavowing text cascades invalidation downstream and rewinds the phase. `lib/dag.ts`, `lib/db/`
- **The Disavowal Loop** — highlight any text in the Live Draft and it's quoted into the command-line input for correction. `components/workspace/right-sidebar.tsx`
- **The Inventor's Notebook** — the full transcript + verified draft, SHA-256 hashed and timestamped against a public TSA. `lib/crypto/rfc3161.ts`, `lib/notebook.ts`

## Tech stack

Next.js 14 · Drizzle ORM + Neon Postgres · Clerk auth · Vercel Blob · Vercel AI SDK + OpenAI (gpt-4o agents, o1-preview verification) · Zustand · Tailwind + Radix · IBM Plex Sans/Mono.

## Local setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create the external accounts and collect credentials.** Copy `.env.example` to `.env.local` and fill in:

   | Variable | Where to get it |
   | --- | --- |
   | `DATABASE_URL` | Neon dashboard → Connection Details |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk dashboard → API Keys |
   | `CLERK_WEBHOOK_SECRET` | Clerk dashboard → Webhooks (point it at `/api/webhooks/clerk`) |
   | `BLOB_READ_WRITE_TOKEN` | Vercel → Storage → Blob |
   | `OPENAI_API_KEY` | OpenAI dashboard (needs `gpt-4o` + `o1-preview` access) |
   | `TSA_URL` | Leave as `http://timestamp.digicert.com` |

3. **Provision the database schema**

   ```bash
   npm run db:push
   ```

4. **Run it**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000, sign up, and you land in the workspace.

## How a session flows

1. You answer the Helper's Core Novelty question in the command-line input.
2. Your exact words are recorded into the Shared Consciousness node for the current phase.
3. The Drafter synthesizes a section **only** from your words; the Verifier (o1-preview) rejects anything invented; up to 3 retries, then the Helper asks a targeted Socratic follow-up.
4. Verified sections stream into the Live Draft and the phase advances (Core Novelty → Tech Architecture → Detailed Implementation → Broadening).
5. Disagree with any rendered text? Highlight it — it's quoted into the input. Send your correction and the mesh invalidates that node and everything downstream, rewinding the phase.
6. Hit **Seal Inventor's Notebook** to hash the transcript and obtain an RFC 3161 timestamp, then download the notebook as Markdown.

## Project layout

```
app/
  page.tsx                     Landing
  workspace/page.tsx           The Triptych (auth-gated)
  sign-in, sign-up             Clerk
  api/
    projects/bootstrap         Get/create the active project
    upload                     Stream context files to Vercel Blob
    chat                       The orchestrator: Helper stream + mesh (NDJSON)
    seal                       Build + hash + RFC 3161 timestamp the notebook
    notebook                   Download the notebook as Markdown
    webhooks/clerk             Clerk → DB user sync
components/workspace/          triptych, left/center/right panes, phase rail
db/                            Drizzle schema + Neon client
lib/
  ai/                          backpack, helper/drafter/verifier agents, mesh
  db/                          projects, shared-consciousness, dag-invalidation
  crypto/rfc3161.ts            DER TimeStampReq builder + TSA client
  dag.ts                       The Shared Consciousness DAG
  store.ts                     Zustand client state
```

## Deployment (Vercel)

Connect the repo to Vercel, add every variable from `.env.local` to the project's Environment Variables, keep the build command as `npm run build`, and deploy. Everything is serverless/edge-friendly — no Dockerfile needed. Run `npm run db:push` once against your production `DATABASE_URL`.

## Notes & guarantees

- **The AI never invents.** This is enforced structurally (the Drafter's `GapDetected` contract + the Verifier's audit), not just by prompt wording. If the inventor hasn't stated something, the system asks rather than fills.
- **Graceful degradation.** If the TSA is unreachable, sealing still records the SHA-256 hash and server time so the proof can be re-obtained later from the hash.
- **Verified locally** with `tsc --noEmit` and `next lint` (both clean). Provide real credentials before `next build`/`next dev`, since the agents and DB require live services.
