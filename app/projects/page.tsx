"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/lib/store";
import { phaseLabel } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  title: string;
  currentPhase: string;
  createdAt: string;
  updatedAt: string;
};

export default function ProjectsPage() {
  const router = useRouter();
  const reset = useWorkspace((s) => s.reset);
  const setActiveProject = useWorkspace((s) => s.setActiveProject);
  const activeProjectId = useWorkspace((s) => s.activeProjectId);

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/projects");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const data = await res.json();
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (err) {
      setError(
        "Couldn't load projects. Is the database reachable? (Run `npm run db:push` once if this is a fresh setup.)"
      );
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [router]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Clear locally regardless of the network result.
    }
    reset();
    useWorkspace.persist.clearStorage();
    router.replace("/login");
  }, [reset, router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Open a project: clear stale workspace state, then load the chosen one. */
  const open = useCallback(
    (id: string) => {
      reset();
      setActiveProject(id);
      router.push("/workspace");
    },
    [reset, setActiveProject, router]
  );

  const create = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
      if (!res.ok) throw new Error(`create failed (${res.status})`);
      const data = await res.json();
      setNewTitle("");
      if (data?.project?.id) open(data.project.id);
      else await refresh();
    } catch (err) {
      setError("Couldn't create the project.");
      console.error(err);
    } finally {
      setCreating(false);
    }
  }, [newTitle, open, refresh]);

  const remove = useCallback(
    async (id: string, title: string) => {
      if (
        !window.confirm(
          `Delete "${title}"? This permanently removes the project, its draft, transcript, and notebook. This cannot be undone.`
        )
      )
        return;
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`delete failed (${res.status})`);
        if (id === activeProjectId) setActiveProject(null);
        await refresh();
      } catch (err) {
        setError("Couldn't delete the project.");
        console.error(err);
      } finally {
        setBusyId(null);
      }
    },
    [activeProjectId, setActiveProject, refresh]
  );

  const rename = useCallback(
    async (id: string, current: string) => {
      const next = window.prompt("Rename project", current);
      if (next === null) return;
      const title = next.trim();
      if (!title || title === current) return;
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) throw new Error(`rename failed (${res.status})`);
        await refresh();
      } catch (err) {
        setError("Couldn't rename the project.");
        console.error(err);
      } finally {
        setBusyId(null);
      }
    },
    [refresh]
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-6 py-12">
      <header className="mb-8 animate-fade-in">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="font-mono text-xs uppercase tracking-[0.2em] text-action transition-colors hover:text-accent"
          >
            ← Patent Geyser
          </Link>
          <button
            onClick={() => void logout()}
            className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted transition-colors hover:text-ink"
          >
            Log out
          </button>
        </div>
        <h1 className="mt-3 font-sans text-3xl font-bold tracking-tight text-ink">
          Projects
        </h1>
        <p className="mt-2 font-mono text-sm text-ink-muted">
          Each project is one provisional patent draft, with its own transcript
          and Inventor&apos;s Notebook. Create a new one to start fresh.
        </p>
      </header>

      {/* New project */}
      <div className="mb-8 flex gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !creating) void create();
          }}
          placeholder="New project title (optional)"
          className="flex-1 rounded-md border border-border bg-panel px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-muted/60 focus:border-accent focus:outline-none"
        />
        <button
          onClick={() => void create()}
          disabled={creating}
          className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {creating ? "Creating…" : "New project"}
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <p className="font-mono text-sm text-ink-muted">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="rounded-md border border-border bg-panel p-6 text-center font-mono text-sm text-ink-muted">
          No projects yet. Create your first one above.
        </p>
      ) : (
        <ul className="space-y-3">
          {projects.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-4 rounded-md border border-border bg-panel p-4"
            >
              <button
                onClick={() => open(p.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-sans text-sm font-semibold text-ink">
                    {p.title}
                  </span>
                  {p.id === activeProjectId && (
                    <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">
                      active
                    </span>
                  )}
                </div>
                <div className="mt-1 font-mono text-xs text-ink-muted">
                  {phaseLabel(p.currentPhase)} · updated{" "}
                  {new Date(p.updatedAt).toLocaleString()}
                </div>
              </button>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => open(p.id)}
                  className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand transition-colors hover:bg-accent/90"
                >
                  Open
                </button>
                <button
                  onClick={() => void rename(p.id, p.title)}
                  disabled={busyId === p.id}
                  className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
                >
                  Rename
                </button>
                <button
                  onClick={() => void remove(p.id, p.title)}
                  disabled={busyId === p.id}
                  className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-red-300 transition-colors hover:border-red-500/40 hover:bg-red-500/10 disabled:opacity-50"
                >
                  {busyId === p.id ? "…" : "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
