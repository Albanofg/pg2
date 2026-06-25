/**
 * The Helper conversation — the shared shape of the back-and-forth between the
 * inventor and the Helper, used by EVERY module so the Helper is one continuous
 * presence (not a per-module note-taker). Pure types only (no zod, no server-only)
 * so both the client thread component and the server engines import them freely.
 */

/**
 * ONE short question the Helper attaches to a reply. The whole point: replying is
 * one tap. The Helper proposes a few candidate answers the inventor can click, and
 * they can always type their own instead. At most ONE question per turn — never a
 * wall of five.
 */
export type HelperQuestion = {
  /** The single, short question. */
  ask: string;
  /** One short line on why it helps — optional, kept to a sentence. */
  why?: string;
  /** 2–4 short proposed answers the inventor can tap; they can always type their own. */
  options: string[];
};

/** @deprecated Legacy multi-point teaching. Kept only so older stored turns still render. */
export type HelperTeachingPoint = {
  topic: string;
  why_it_matters: string;
  what_would_strengthen: string;
  ask: string;
};

/**
 * One turn in the Helper conversation. The Helper ALWAYS replies in words (a
 * teacher and brainstorming partner, never a silent mutator); the inventor's
 * composer messages are shown too so the exchange reads as a real dialogue.
 *
 * A helper turn carries a SHORT reply and, when something is genuinely needed, at
 * most ONE `question` with tap-to-answer options — not a wall of text.
 */
export type HelperTurn = {
  role: "inventor" | "helper";
  text: string;
  /** At most ONE short question, with tap-to-answer options. The fast-reply path. */
  question?: HelperQuestion;
  /** @deprecated Legacy multi-point teaching; only older stored turns still carry this. */
  teaching?: HelperTeachingPoint[];
  /** What the Helper understood the message to be (helper turns only). Loose so each module can label it. */
  intent?: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
};
