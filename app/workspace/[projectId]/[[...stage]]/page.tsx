import Triptych from "@/components/workspace/triptych";

export const dynamic = "force-dynamic";

/**
 * The workspace for one project at one module: /workspace/<projectId>/<stage>.
 * The optional catch-all also matches /workspace/<projectId> (no stage) — the
 * Triptych then resumes at the furthest reached module and rewrites the URL.
 * The URL is the source of truth; the Triptych syncs it to the store.
 */
export default function WorkspaceProjectPage() {
  return <Triptych />;
}
