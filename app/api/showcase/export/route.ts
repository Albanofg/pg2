import { NextResponse } from "next/server";
import { sealNotebook } from "@/lib/crypto/rfc3161";
import { loadShowcase } from "@/lib/modules/showcase/registry";
import {
  assembleDisclosureMarkdown,
  buildProofContent,
} from "@/lib/modules/showcase/export";

export const runtime = "nodejs";

/**
 * Export the finished work: the Invention Disclosure (Markdown, with any
 * broadened Key Concepts) + a proof package — the full Ledger, RFC-3161 sealed.
 * The proof degrades gracefully if the TSA is unreachable (hash + server time).
 */
export async function POST(req: Request) {
  let projectId: string | undefined;
  try {
    ({ projectId } = (await req.json()) as { projectId?: string });
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!projectId) {
    return NextResponse.json({ error: "projectId_required" }, { status: 400 });
  }

  try {
    const engine = await loadShowcase(projectId);
    if (!engine) {
      return NextResponse.json(
        { error: "no_showcase", detail: "Run Showcase before exporting." },
        { status: 409 },
      );
    }
    const disclosure = engine.getDisclosure() ?? [];
    const keyConcepts = engine.finish();
    const entries = engine.ledgerEntries();

    const disclosureMarkdown = assembleDisclosureMarkdown(disclosure, keyConcepts);
    const proofContent = buildProofContent(entries);
    const seal = await sealNotebook(proofContent);

    return NextResponse.json({
      disclosure: disclosureMarkdown,
      proof: {
        content: proofContent,
        contentHash: seal.contentHash,
        rfc3161Token: seal.rfc3161Token,
        sealedAt: seal.sealedAt.toISOString(),
        tsaStatus: seal.tsaStatus,
        entries,
      },
    });
  } catch (err) {
    console.error("[showcase/export] failed", err);
    return NextResponse.json(
      { error: "export_failed", detail: String(err) },
      { status: 500 },
    );
  }
}
