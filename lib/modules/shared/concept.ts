/**
 * Cross-module concept model.
 *
 * The concept object is the currency that flows between modules: Module 1
 * (Conception) produces it, Module 2 (Maturation) enriches it, later stages
 * carry it forward. This file is pure (no server-only imports) so both client
 * UI and server engines can use it.
 */

/** Where a piece of a concept came from (locked terms). */
export type Provenance =
  /** The inventor conceived it; their words are the source. */
  | "inventor_conceived"
  /** The system rephrased or routinely elaborated the inventor's own words;
   *  no new substance. */
  | "system_formalized"
  /** The system proposed an addition and the inventor explicitly accepted it. */
  | "system_suggested_accepted"
  /** The inventor CONFIRMED a machine-surfaced item as binding/relevant — e.g. a
   *  researched domain constraint (Layer 1) or a retrieved candidate (Layer 5).
   *  Confirmation of retrieved material, not composition; the tap is the act. */
  | "inventor_confirmed";

/** Lifecycle of a concept. Serialize merged status as `merged_into:<id>`. */
export type ConceptStatus =
  | { state: "active" }
  | { state: "dropped" }
  | { state: "merged_into"; into: string };

/** One verbatim inventor input that a concept derives from, in order. */
export type ConceptionTrailItem = {
  /** Links back to the originating ledger entry. */
  ledgerId: string;
  /** The inventor's exact words, stored unedited. */
  verbatim_text: string;
  /** ISO-8601 timestamp of when the inventor supplied it. */
  timestamp: string;
};

/** Per-part provenance of a concept's text. */
export type ConceptProvenancePart = {
  /** The slice of substance this provenance applies to. */
  excerpt: string;
  provenance: Provenance;
  /** Ledger entry ids (inventor verbatim) this part derives from. */
  derivedFrom: string[];
};

/** A clean, owned, traceable concept — the unit that moves between stages. */
export type ConceptObject = {
  id: string;
  title: string;
  /** Clean text rewritten from the inventor's words, adding no new substance. */
  formalized_statement: string;
  /** Ordered, timestamped verbatim inventor inputs this concept derives from. */
  conception_trail: ConceptionTrailItem[];
  /** Per-part provenance of the concept's text. */
  provenance: ConceptProvenancePart[];
  status: ConceptStatus;
};

/** Canonical string form of a status, e.g. "active" or "merged_into:abc". */
export function statusLabel(status: ConceptStatus): string {
  return status.state === "merged_into"
    ? `merged_into:${status.into}`
    : status.state;
}
