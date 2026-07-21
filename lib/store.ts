"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { PhaseKey } from "./utils";
import type { Grade, LedgerEntry } from "@/lib/modules/shared";

/** The living "Current Idea" — everything the inventor has approved so far. */
export type ProofIdea = {
  /** The distilled core (conception), if approved yet. */
  core: string | null;
  /** The concepts the inventor owns, with their current text + reasoning/grade. */
  concepts: {
    title: string;
    text: string;
    /** The reasons the piece rests on (anchored to the inventor's words). */
    reasons?: string[];
    /** The cross-agent grade — a failed grade is shown, never buried. */
    grade?: Grade;
  }[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "helper";
  content: string;
  isDisavowal?: boolean;
  /** Optional text the user disavowed/quoted, shown above the message. */
  quote?: string;
};

export type ContextFile = {
  id: string;
  name: string;
  size: number;
  url?: string;
  status: "uploading" | "ready" | "error";
};

/** A node in the Shared Consciousness DAG, mirrored on the client for live rendering. */
export type DraftNode = {
  nodeKey: string;
  label: string;
  draftOutput: string | null;
  isVerified: boolean;
  invalidated: boolean;
};

export type MeshStatus = {
  active: boolean;
  /** Terminal-style log lines, newest last. */
  log: string[];
};

export type ConnectionState = "online" | "reconnecting";

export type ModuleStage =
  | "orientation" // Module 0 — the front porch: surface the machine idea, produce a brief for Conception
  | "brainstorm" // parked (kept, not in the flow) — the old pre-Conception Socratic window
  | "conception"
  | "maturation"
  | "landscape"
  | "differentiation"
  | "genus_species" // the "more ways to build it" expansion — its own step before the draft
  | "showcase";

type WorkspaceState = {
  projectId: string | null;
  /** The project the workspace should load (chosen from the dashboard). */
  activeProjectId: string | null;
  /** Which module the workspace is showing for this project. */
  stage: ModuleStage;
  /** Right panel — the living current idea and the notebook of decisions. */
  proofIdea: ProofIdea;
  proofNotebook: LedgerEntry[];
  title: string;
  phase: PhaseKey;
  /** Distilled "Current Idea" the Helper has extracted so far. */
  currentIdea: string;
  files: ContextFile[];
  messages: ChatMessage[];
  draftNodes: DraftNode[];
  mesh: MeshStatus;
  connection: ConnectionState;
  /** Text the user highlighted in the Live Draft, pending disavowal. */
  pendingQuote: string | null;
  input: string;
  /**
   * The one idea the inventor typed at the entry, handed to Module 0 so the
   * brainstorm step never asks them to type again — it just runs (research + 3
   * options). Transient (not persisted); cleared once the panel consumes it.
   */
  brainstormSeed: string | null;
  /**
   * The detailed brief the Orientation stage produced, handed to Conception to
   * pre-fill "Describe your invention". Transient (not persisted); Conception
   * consumes it once and clears it.
   */
  orientationBrief: string | null;

  // actions
  setProject: (id: string, title: string) => void;
  setActiveProject: (id: string | null) => void;
  setStage: (stage: ModuleStage) => void;
  setProof: (idea: ProofIdea, notebook: LedgerEntry[]) => void;
  setPhase: (phase: PhaseKey) => void;
  setCurrentIdea: (idea: string) => void;
  setInput: (value: string) => void;
  addFile: (file: ContextFile) => void;
  updateFile: (id: string, patch: Partial<ContextFile>) => void;
  removeFile: (id: string) => void;
  addMessage: (msg: ChatMessage) => void;
  appendToLastHelperMessage: (chunk: string) => void;
  setDraftNodes: (nodes: DraftNode[]) => void;
  upsertDraftNode: (node: DraftNode) => void;
  invalidateNodes: (nodeKeys: string[]) => void;
  setMesh: (mesh: Partial<MeshStatus>) => void;
  pushMeshLog: (line: string) => void;
  clearMeshLog: () => void;
  setConnection: (state: ConnectionState) => void;
  setPendingQuote: (quote: string | null) => void;
  setBrainstormSeed: (seed: string | null) => void;
  setOrientationBrief: (brief: string | null) => void;
  reset: () => void;
};

/**
 * Union two ledgers by entry id (ids are preserved as the ledger chains across
 * modules), then order by time. Keeps the notebook a complete, growing record of the
 * whole process instead of only the active stage's slice.
 */
function mergeLedger(existing: LedgerEntry[], incoming: LedgerEntry[]): LedgerEntry[] {
  const byId = new Map<string, LedgerEntry>();
  for (const e of existing) byId.set(e.id, e);
  for (const e of incoming) byId.set(e.id, e); // incoming is authoritative for shared ids
  return [...byId.values()].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

const initial = {
  projectId: null,
  activeProjectId: null as string | null,
  stage: "conception" as ModuleStage, // conception | maturation | landscape
  proofIdea: { core: null, concepts: [] } as ProofIdea,
  proofNotebook: [] as LedgerEntry[],
  title: "Untitled Draft",
  phase: "core_novelty" as PhaseKey,
  currentIdea: "",
  files: [] as ContextFile[],
  messages: [] as ChatMessage[],
  draftNodes: [] as DraftNode[],
  mesh: { active: false, log: [] as string[] },
  connection: "online" as ConnectionState,
  pendingQuote: null as string | null,
  input: "",
  brainstormSeed: null as string | null,
  orientationBrief: null as string | null,
};

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set) => ({
      ...initial,

      // Switching projects resets the accumulated notebook so one project's history
      // never leaks into another's.
      setProject: (id, title) =>
        set((s) => (s.projectId === id ? { title } : { projectId: id, title, proofNotebook: [] })),
      setActiveProject: (activeProjectId) => set({ activeProjectId }),
      setStage: (stage) => set({ stage }),
      // The Idea reflects the ACTIVE stage (replace). The Notebook is the whole
      // process, always — accumulate every stage's ledger by id and never shrink, so
      // moving between stages never drops earlier entries.
      setProof: (proofIdea, proofNotebook) =>
        set((s) => ({ proofIdea, proofNotebook: mergeLedger(s.proofNotebook, proofNotebook) })),
      setPhase: (phase) => set({ phase }),
      setCurrentIdea: (currentIdea) => set({ currentIdea }),
      setInput: (input) => set({ input }),

      addFile: (file) => set((s) => ({ files: [...s.files, file] })),
      updateFile: (id, patch) =>
        set((s) => ({
          files: s.files.map((f) => (f.id === id ? { ...f, ...patch } : f)),
        })),
      removeFile: (id) =>
        set((s) => ({ files: s.files.filter((f) => f.id !== id) })),

      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      appendToLastHelperMessage: (chunk) =>
        set((s) => {
          const msgs = [...s.messages];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === "helper") {
              msgs[i] = { ...msgs[i], content: msgs[i].content + chunk };
              break;
            }
          }
          return { messages: msgs };
        }),

      setDraftNodes: (draftNodes) => set({ draftNodes }),
      upsertDraftNode: (node) =>
        set((s) => {
          const exists = s.draftNodes.some((n) => n.nodeKey === node.nodeKey);
          return {
            draftNodes: exists
              ? s.draftNodes.map((n) => (n.nodeKey === node.nodeKey ? node : n))
              : [...s.draftNodes, node],
          };
        }),
      invalidateNodes: (nodeKeys) =>
        set((s) => ({
          draftNodes: s.draftNodes.map((n) =>
            nodeKeys.includes(n.nodeKey)
              ? { ...n, invalidated: true, isVerified: false }
              : n
          ),
        })),

      setMesh: (mesh) => set((s) => ({ mesh: { ...s.mesh, ...mesh } })),
      pushMeshLog: (line) =>
        set((s) => ({
          mesh: { ...s.mesh, log: [...s.mesh.log.slice(-40), line] },
        })),
      clearMeshLog: () => set((s) => ({ mesh: { ...s.mesh, log: [] } })),

      setConnection: (connection) => set({ connection }),
      setPendingQuote: (pendingQuote) => set({ pendingQuote }),
      setBrainstormSeed: (brainstormSeed) => set({ brainstormSeed }),
      setOrientationBrief: (orientationBrief) => set({ orientationBrief }),

      reset: () => set({ ...initial }),
    }),
    {
      name: "patent-geyser-workspace",
      storage: createJSONStorage(() => localStorage),
      // Persist chat + idea state for offline resilience; never persist live mesh log.
      // NOT `stage`: it's a per-project value (the furthest module reached), resolved
      // authoritatively by /api/projects/bootstrap on load. Persisting it globally
      // made a fresh project open on whatever stage was last viewed for a DIFFERENT
      // project — landing you on a stage this project hasn't reached.
      partialize: (s) => ({
        projectId: s.projectId,
        activeProjectId: s.activeProjectId,
        title: s.title,
        phase: s.phase,
        currentIdea: s.currentIdea,
        files: s.files,
        messages: s.messages,
        draftNodes: s.draftNodes,
      }),
    }
  )
);
