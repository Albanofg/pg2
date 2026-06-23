"use client";

import type { ContextFile } from "@/lib/store";

type Handlers = {
  addFile: (f: ContextFile) => void;
  updateFile: (id: string, patch: Partial<ContextFile>) => void;
};

/**
 * Stream a context file to Vercel Blob via the upload API route, registering it
 * against the project so the mesh can read it. Reports progress through the
 * store handlers so the Left Sidebar reflects status without page reloads.
 */
export async function uploadContextFile(
  file: File,
  projectId: string,
  { addFile, updateFile }: Handlers
): Promise<void> {
  const id = crypto.randomUUID();
  addFile({
    id,
    name: file.name,
    size: file.size,
    status: "uploading",
  });

  try {
    const res = await fetch(
      `/api/upload?filename=${encodeURIComponent(file.name)}&projectId=${projectId}`,
      {
        method: "POST",
        body: file,
        headers: { "content-type": file.type || "application/octet-stream" },
      }
    );
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.json();
    updateFile(id, { status: "ready", url: blob.url });
  } catch {
    updateFile(id, { status: "error" });
  }
}
