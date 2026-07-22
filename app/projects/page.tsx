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
  familyId: string | null;
  inventorNames: string | null;
  filedDate: string | null;
  status: string | null;
  applicationNumber: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
type FamilyRow = { id: string; title: string; description: string | null; context: string | null };

type FamilyDraft = { title: string; description: string; context: string };

type ContextFileRow = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  summary: string | null;
  extractionStatus: string; // pending | ok | failed
  extractionError: string | null;
  createdAt: string;
};

type Details = {
  title: string;
  inventorNames: string;
  filedDate: string;
  status: string;
  applicationNumber: string;
  notes: string;
};
const STATUS_OPTIONS = ["draft", "filed", "granted", "abandoned", "archived"];

export default function ProjectsPage() {
  const router = useRouter();
  const reset = useWorkspace((s) => s.reset);
  const setActiveProject = useWorkspace((s) => s.setActiveProject);
  const activeProjectId = useWorkspace((s) => s.activeProjectId);

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newFamily, setNewFamily] = useState("");
  const [creatingFamily, setCreatingFamily] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmFamilyId, setConfirmFamilyId] = useState<string | null>(null);
  // The project whose details modal is open, plus its editable draft.
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  // The family whose edit modal is open, plus its editable draft.
  const [familyEditId, setFamilyEditId] = useState<string | null>(null);
  const [familyDraft, setFamilyDraft] = useState<FamilyDraft | null>(null);
  const [savingFamily, setSavingFamily] = useState(false);
  // The family whose reference-documents modal is open.
  const [docsFamily, setDocsFamily] = useState<{ id: string; title: string } | null>(null);
  const [docs, setDocs] = useState<ContextFileRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [pRes, fRes] = await Promise.all([fetch("/api/projects"), fetch("/api/families")]);
      if (pRes.status === 401 || fRes.status === 401) {
        router.replace("/login");
        return;
      }
      if (!pRes.ok) throw new Error(`list failed (${pRes.status})`);
      const pData = await pRes.json();
      setProjects(Array.isArray(pData.projects) ? pData.projects : []);
      const fData = await fRes.json().catch(() => ({}));
      setFamilies(Array.isArray(fData.families) ? fData.families : []);
    } catch (err) {
      setError(
        "Couldn't load projects. Is the database reachable? (Run `npm run db:push` once if this is a fresh setup.)",
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
      /* clear locally regardless */
    }
    reset();
    useWorkspace.persist.clearStorage();
    router.replace("/login");
  }, [reset, router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(
    (id: string) => {
      reset();
      setActiveProject(id);
      // Land on the project; the workspace resumes at the furthest module and
      // rewrites the URL to /workspace/<id>/<stage>.
      router.push(`/workspace/${id}`);
    },
    [reset, setActiveProject, router],
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

  const createFamily = useCallback(async () => {
    if (!newFamily.trim()) return;
    setCreatingFamily(true);
    setError(null);
    try {
      const res = await fetch("/api/families", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: newFamily }),
      });
      if (!res.ok) throw new Error(`family create failed (${res.status})`);
      setNewFamily("");
      await refresh();
    } catch (err) {
      setError("Couldn't create the family.");
      console.error(err);
    } finally {
      setCreatingFamily(false);
    }
  }, [newFamily, refresh]);

  const deleteFamily = useCallback(
    async (id: string) => {
      setConfirmFamilyId(null);
      setError(null);
      try {
        const res = await fetch(`/api/families/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`family delete failed (${res.status})`);
        await refresh();
      } catch (err) {
        setError("Couldn't delete the family.");
        console.error(err);
      }
    },
    [refresh],
  );

  const moveToFamily = useCallback(
    async (projectId: string, familyId: string | null) => {
      setBusyId(projectId);
      setError(null);
      try {
        const res = familyId
          ? await fetch(`/api/projects/${projectId}/family`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ familyId }),
            })
          : await fetch(`/api/projects/${projectId}/family`, { method: "DELETE" });
        if (!res.ok) throw new Error(`move failed (${res.status})`);
        await refresh();
      } catch (err) {
        setError("Couldn't move the project.");
        console.error(err);
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      setConfirmId(null);
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
    [activeProjectId, setActiveProject, refresh],
  );

  const openDetails = useCallback((p: ProjectRow) => {
    setDetailsId(p.id);
    setDetails({
      title: p.title ?? "",
      inventorNames: p.inventorNames ?? "",
      filedDate: p.filedDate ?? "",
      status: p.status ?? "",
      applicationNumber: p.applicationNumber ?? "",
      notes: p.notes ?? "",
    });
  }, []);

  const saveDetails = useCallback(async () => {
    if (!detailsId || !details) return;
    setSavingDetails(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${detailsId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(details),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setDetailsId(null);
      setDetails(null);
      await refresh();
    } catch (err) {
      setError("Couldn't save the project details.");
      console.error(err);
    } finally {
      setSavingDetails(false);
    }
  }, [detailsId, details, refresh]);

  const openFamilyEdit = useCallback((f: FamilyRow) => {
    setFamilyEditId(f.id);
    setFamilyDraft({
      title: f.title ?? "",
      description: f.description ?? "",
      context: f.context ?? "",
    });
  }, []);

  const saveFamily = useCallback(async () => {
    if (!familyEditId || !familyDraft) return;
    if (!familyDraft.title.trim()) return;
    setSavingFamily(true);
    setError(null);
    try {
      const res = await fetch(`/api/families/${familyEditId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(familyDraft),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setFamilyEditId(null);
      setFamilyDraft(null);
      await refresh();
    } catch (err) {
      setError("Couldn't save the family.");
      console.error(err);
    } finally {
      setSavingFamily(false);
    }
  }, [familyEditId, familyDraft, refresh]);

  const loadDocs = useCallback(async (familyId: string) => {
    setDocsLoading(true);
    setDocError(null);
    try {
      const res = await fetch(`/api/families/${familyId}/context-files`);
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const data = await res.json();
      setDocs(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      setDocError("Couldn't load the documents.");
      console.error(err);
    } finally {
      setDocsLoading(false);
    }
  }, []);

  const openDocs = useCallback(
    (f: FamilyRow) => {
      setDocsFamily({ id: f.id, title: f.title });
      setDocs([]);
      void loadDocs(f.id);
    },
    [loadDocs],
  );

  const uploadDoc = useCallback(
    async (file: File) => {
      if (!docsFamily) return;
      const lower = file.name.toLowerCase();
      if (!lower.endsWith(".pdf") && !lower.endsWith(".docx")) {
        setDocError("Only PDF and DOCX files are supported.");
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        setDocError("Files must be 15 MB or smaller.");
        return;
      }
      setUploadingDoc(true);
      setDocError(null);
      try {
        const res = await fetch(
          `/api/families/${docsFamily.id}/context-files?filename=${encodeURIComponent(file.name)}`,
          { method: "POST", body: file },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || data.error || `upload failed (${res.status})`);
        }
        await loadDocs(docsFamily.id);
      } catch (err) {
        setDocError(err instanceof Error ? err.message : "Couldn't upload the document.");
        console.error(err);
      } finally {
        setUploadingDoc(false);
      }
    },
    [docsFamily, loadDocs],
  );

  const deleteDoc = useCallback(
    async (fileId: string) => {
      if (!docsFamily) return;
      setDocError(null);
      try {
        const res = await fetch(`/api/families/${docsFamily.id}/context-files/${fileId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`delete failed (${res.status})`);
        setDocs((prev) => prev.filter((d) => d.id !== fileId));
      } catch (err) {
        setDocError("Couldn't delete the document.");
        console.error(err);
      }
    },
    [docsFamily],
  );

  // Group projects by family; loose (no family) rendered separately.
  const byFamily = new Map<string, ProjectRow[]>();
  const loose: ProjectRow[] = [];
  for (const p of projects) {
    if (p.familyId) {
      const arr = byFamily.get(p.familyId) ?? [];
      arr.push(p);
      byFamily.set(p.familyId, arr);
    } else {
      loose.push(p);
    }
  }

  const renderProject = (p: ProjectRow) => (
    <li
      key={p.id}
      className="flex flex-col gap-3 rounded-md border border-border bg-panel p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <button onClick={() => open(p.id)} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-sans text-sm font-semibold text-ink">{p.title}</span>
          {p.id === activeProjectId && (
            <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">
              active
            </span>
          )}
          {p.status && (
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
              {p.status}
            </span>
          )}
        </div>
        <div className="mt-1 font-mono text-xs text-ink-muted">
          {phaseLabel(p.currentPhase)} · updated {new Date(p.updatedAt).toLocaleString()}
        </div>
      </button>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {confirmId === p.id ? (
          <>
            <span className="font-mono text-[11px] text-ink-muted">Delete for good?</span>
            <button
              onClick={() => void remove(p.id)}
              disabled={busyId === p.id}
              className="rounded-md border border-red-500/50 bg-red-500/15 px-3 py-1.5 font-sans text-xs text-red-300 transition-colors hover:bg-red-500/25 disabled:opacity-50"
            >
              {busyId === p.id ? "…" : "Delete"}
            </button>
            <button
              onClick={() => setConfirmId(null)}
              className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted transition-colors hover:text-ink"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {families.length > 0 && (
              <select
                value={p.familyId ?? ""}
                onChange={(e) => void moveToFamily(p.id, e.target.value || null)}
                disabled={busyId === p.id}
                title="Move to a family"
                className="max-w-[9rem] rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-[11px] text-ink-muted focus:border-accent focus:outline-none disabled:opacity-50"
              >
                <option value="">No family</option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => open(p.id)}
              className="rounded-md bg-accent px-3 py-1.5 font-sans text-xs font-medium text-brand transition-colors hover:bg-accent/90"
            >
              Open
            </button>
            <button
              onClick={() => openDetails(p)}
              disabled={busyId === p.id}
              className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              Edit
            </button>
            <button
              onClick={() => setConfirmId(p.id)}
              disabled={busyId === p.id}
              className="rounded-md border border-border px-3 py-1.5 font-sans text-xs text-red-300 transition-colors hover:border-red-500/40 hover:bg-red-500/10 disabled:opacity-50"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </li>
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
        <h1 className="mt-3 font-sans text-3xl font-bold tracking-tight text-ink">Projects</h1>
        <p className="mt-2 font-mono text-sm text-ink-muted">
          Each project is one Invention Concept Blueprint. Group related projects into a{" "}
          <span className="text-ink">family</span> so they stake distinct ground — the Helper flags
          when a new Key Concept overlaps one a sibling already covers.
        </p>
      </header>

      {/* New project + new family */}
      <div className="mb-8 flex flex-col gap-2">
        <div className="flex gap-2">
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
        <div className="flex gap-2">
          <input
            value={newFamily}
            onChange={(e) => setNewFamily(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !creatingFamily) void createFamily();
            }}
            placeholder="New family name (groups related projects)"
            className="flex-1 rounded-md border border-border bg-panel px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-muted/60 focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => void createFamily()}
            disabled={creatingFamily || !newFamily.trim()}
            className="rounded-md border border-border px-4 py-2 font-sans text-sm text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
          >
            {creatingFamily ? "Creating…" : "New family"}
          </button>
        </div>
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
        <div className="space-y-6">
          {families.map((f) => {
            const members = byFamily.get(f.id) ?? [];
            return (
              <section key={f.id} className="rounded-lg border border-accent/30 bg-accent/[0.04] p-3">
                <div className="mb-2 flex items-start justify-between gap-2 px-1">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-accent">▦</span>
                      <span className="truncate font-sans text-sm font-semibold text-ink">{f.title}</span>
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
                        {members.length} {members.length === 1 ? "project" : "projects"}
                      </span>
                    </div>
                    {f.description && (
                      <p className="mt-1 pl-6 font-sans text-xs text-ink-muted">{f.description}</p>
                    )}
                  </div>
                  {confirmFamilyId === f.id ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[11px] text-ink-muted">Delete family?</span>
                      <button
                        onClick={() => void deleteFamily(f.id)}
                        className="rounded-md border border-red-500/50 bg-red-500/15 px-2.5 py-1 font-sans text-xs text-red-300 hover:bg-red-500/25"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmFamilyId(null)}
                        className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => openFamilyEdit(f)}
                        title="Edit family name, description & background"
                        className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted hover:text-ink"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => openDocs(f)}
                        title="Reference documents shared across this family"
                        className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted hover:text-ink"
                      >
                        Documents
                      </button>
                      <button
                        onClick={() => setConfirmFamilyId(f.id)}
                        title="Delete family (keeps its projects)"
                        className="rounded-md border border-border px-2.5 py-1 font-sans text-xs text-ink-muted hover:text-ink"
                      >
                        Delete family
                      </button>
                    </div>
                  )}
                </div>
                {members.length ? (
                  <ul className="space-y-2">{members.map(renderProject)}</ul>
                ) : (
                  <p className="px-1 py-2 font-mono text-[11px] text-ink-muted">
                    No projects yet — move one in with its family dropdown.
                  </p>
                )}
              </section>
            );
          })}

          {loose.length > 0 && (
            <section>
              {families.length > 0 && (
                <div className="mb-2 px-1 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
                  Not in a family
                </div>
              )}
              <ul className="space-y-2">{loose.map(renderProject)}</ul>
            </section>
          )}
        </div>
      )}

      {/* Edit project details modal */}
      {detailsId && details && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDetailsId(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-lg border border-border bg-panel p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-sans text-lg font-semibold text-ink">Edit project details</h2>
                <p className="mt-0.5 font-sans text-xs text-ink-muted">
                  Every field is optional. Fill in what you know; you can come back later.
                </p>
              </div>
              <button
                onClick={() => setDetailsId(null)}
                className="rounded-md px-2 py-1 font-mono text-xs text-ink-muted hover:text-ink"
              >
                ✕
              </button>
            </div>

            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void saveDetails();
              }}
            >
              <Field label="Title">
                <input
                  value={details.title}
                  onChange={(e) => setDetails({ ...details, title: e.target.value })}
                  autoFocus
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 font-sans text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
              <Field label="Inventor name(s)" hint="Comma-separated.">
                <input
                  value={details.inventorNames}
                  onChange={(e) => setDetails({ ...details, inventorNames: e.target.value })}
                  placeholder="e.g. Alice Smith, Bob Jones"
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-muted/60 focus:border-accent focus:outline-none"
                />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Filed date">
                  <input
                    type="date"
                    value={details.filedDate}
                    onChange={(e) => setDetails({ ...details, filedDate: e.target.value })}
                    className="w-full rounded-md border border-border bg-bg px-3 py-2 font-sans text-sm text-ink focus:border-accent focus:outline-none"
                  />
                </Field>
                <Field label="Status">
                  <select
                    value={details.status}
                    onChange={(e) => setDetails({ ...details, status: e.target.value })}
                    className="w-full rounded-md border border-border bg-bg px-3 py-2 font-sans text-sm text-ink focus:border-accent focus:outline-none"
                  >
                    <option value="">—</option>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Application number">
                <input
                  value={details.applicationNumber}
                  onChange={(e) => setDetails({ ...details, applicationNumber: e.target.value })}
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 font-sans text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
              <Field label="Notes">
                <textarea
                  value={details.notes}
                  onChange={(e) => setDetails({ ...details, notes: e.target.value })}
                  rows={4}
                  placeholder="Anything else worth remembering about this project."
                  className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-muted/60 focus:border-accent focus:outline-none"
                />
              </Field>

              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDetailsId(null)}
                  className="rounded-md border border-border px-4 py-2 font-sans text-sm text-ink-muted transition-colors hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDetails}
                  className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand transition-colors hover:bg-accent/90 disabled:opacity-50"
                >
                  {savingDetails ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit family modal */}
      {familyEditId && familyDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setFamilyEditId(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-lg border border-border bg-panel p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-sans text-lg font-semibold text-ink">Edit family</h2>
                <p className="mt-0.5 font-sans text-xs text-ink-muted">
                  A family groups related projects. The background below is shared context the
                  Helper reads on every turn for each project in this family.
                </p>
              </div>
              <button
                onClick={() => setFamilyEditId(null)}
                className="rounded-md px-2 py-1 font-mono text-xs text-ink-muted hover:text-ink"
              >
                ✕
              </button>
            </div>

            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void saveFamily();
              }}
            >
              <Field label="Name">
                <input
                  value={familyDraft.title}
                  onChange={(e) => setFamilyDraft({ ...familyDraft, title: e.target.value })}
                  autoFocus
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 font-sans text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
              <Field label="Description" hint="A short label shown on the family card.">
                <input
                  value={familyDraft.description}
                  onChange={(e) => setFamilyDraft({ ...familyDraft, description: e.target.value })}
                  placeholder="e.g. Everything around the self-cleaning water bottle"
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-muted/60 focus:border-accent focus:outline-none"
                />
              </Field>
              <Field
                label="Background"
                hint="Standing context for the Helper — the product domain, what these projects share, and where each should stake distinct ground."
              >
                <textarea
                  value={familyDraft.context}
                  onChange={(e) => setFamilyDraft({ ...familyDraft, context: e.target.value })}
                  rows={5}
                  placeholder="Notes that guide the Helper across every project in this family."
                  className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-muted/60 focus:border-accent focus:outline-none"
                />
              </Field>

              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setFamilyEditId(null)}
                  className="rounded-md border border-border px-4 py-2 font-sans text-sm text-ink-muted transition-colors hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingFamily || !familyDraft.title.trim()}
                  className="rounded-md bg-accent px-4 py-2 font-sans text-sm font-medium text-brand transition-colors hover:bg-accent/90 disabled:opacity-50"
                >
                  {savingFamily ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Family reference documents modal */}
      {docsFamily && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDocsFamily(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-lg border border-border bg-panel p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate font-sans text-lg font-semibold text-ink">
                  Documents · {docsFamily.title}
                </h2>
                <p className="mt-0.5 font-sans text-xs text-ink-muted">
                  Reference documents (PDF or DOCX, up to 15 MB) shared across every project in this
                  family. The Helper reads them as background — it cites them by name and never
                  copies their text into your record.
                </p>
              </div>
              <button
                onClick={() => setDocsFamily(null)}
                className="rounded-md px-2 py-1 font-mono text-xs text-ink-muted hover:text-ink"
              >
                ✕
              </button>
            </div>

            <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-bg px-4 py-6 font-sans text-sm text-ink-muted transition-colors hover:border-accent hover:text-ink">
              <input
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                disabled={uploadingDoc}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // allow re-selecting the same file
                  if (file) void uploadDoc(file);
                }}
                className="hidden"
              />
              {uploadingDoc ? "Uploading & reading the document…" : "+ Upload a PDF or DOCX"}
            </label>

            {docError && (
              <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-2.5 font-mono text-[11px] text-red-300">
                {docError}
              </div>
            )}

            <div className="mt-4">
              {docsLoading ? (
                <p className="font-mono text-xs text-ink-muted">Loading…</p>
              ) : docs.length === 0 ? (
                <p className="rounded-md border border-border bg-bg p-4 text-center font-mono text-xs text-ink-muted">
                  No documents yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {docs.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-start justify-between gap-3 rounded-md border border-border bg-bg p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-sans text-sm font-medium text-ink">
                            {d.filename}
                          </span>
                          <DocStatusBadge status={d.extractionStatus} />
                          <span className="font-mono text-[10px] text-ink-muted">
                            {formatBytes(d.sizeBytes)}
                          </span>
                        </div>
                        {d.summary && (
                          <p className="mt-1 font-sans text-xs text-ink-muted">{d.summary}</p>
                        )}
                        {d.extractionStatus === "failed" && d.extractionError && (
                          <p className="mt-1 font-mono text-[10px] text-red-300">{d.extractionError}</p>
                        )}
                      </div>
                      <button
                        onClick={() => void deleteDoc(d.id)}
                        title="Remove this document"
                        className="shrink-0 rounded-md border border-border px-2.5 py-1 font-sans text-xs text-red-300 transition-colors hover:border-red-500/40 hover:bg-red-500/10"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function DocStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    ok: { label: "Ready", className: "border-accent/40 text-accent" },
    pending: { label: "Processing…", className: "border-border text-ink-muted" },
    failed: { label: "Unreadable", className: "border-red-500/40 text-red-300" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${s.className}`}
    >
      {s.label}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-sans text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="font-sans text-[11px] text-ink-muted">{hint}</span>}
    </label>
  );
}
