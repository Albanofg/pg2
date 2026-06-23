import "server-only";
import { listContextFiles } from "@/lib/db/projects";

/**
 * Build a lightweight grounding summary from the inventor's uploaded context.
 * We pull a small head of each text-like file so the Helper can form analogies
 * without ballooning token cost. Binary/large files are referenced by name only.
 */
export async function buildContextSummary(projectId: string): Promise<string> {
  const files = await listContextFiles(projectId);
  if (files.length === 0) return "";

  const TEXT_EXT = /\.(md|txt|ts|tsx|js|jsx|py|json|go|rs|java|rb|c|cpp|h)$/i;
  const HEAD_BYTES = 4000;
  const parts: string[] = [];

  for (const f of files.slice(0, 6)) {
    if (!TEXT_EXT.test(f.name)) {
      parts.push(`- ${f.name} (binary, not read)`);
      continue;
    }
    try {
      const res = await fetch(f.url, {
        headers: { range: `bytes=0-${HEAD_BYTES - 1}` },
      });
      const text = (await res.text()).slice(0, HEAD_BYTES);
      parts.push(`### ${f.name}\n${text}`);
    } catch {
      parts.push(`- ${f.name} (unreadable)`);
    }
  }
  return parts.join("\n\n");
}
