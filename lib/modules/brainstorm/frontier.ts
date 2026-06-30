import "server-only";
import {
  runDeepener,
  runDerivationTracer,
  runExcavator,
  runMarketAnalyst,
  runReversalStep,
  runSection101,
  runTensorFinder,
} from "./agents";
import { marketSearchEnabled, searchMarket } from "./market";
import type {
  AgentRunner,
  Backpack,
  DerivationTrace,
  ExcavationFrontier,
  LensCard,
  ReversalStep,
} from "./types";

/**
 * The Step-1 frontier (the doc's first-sixty-seconds screen): a raw spark becomes
 * three lens cards — the latent NEED, a claimable MECHANISM (recommended), and a
 * strategic MARKET fork — each handed back sharper with an honest market read.
 * One excavator call + three market reads in parallel; the deeper grid engine is
 * not on this critical path.
 */
export async function runExcavationFrontier(
  runAgent: AgentRunner,
  input: { spark: string; clarifierAnswer?: string; skipClassify?: boolean },
): Promise<ExcavationFrontier> {
  // Every input gets the three market-aware idea cards — the part that works. (No
  // special "formed invention" screen: it hid the three ideas, which is the one thing
  // that should always be there.)
  const excavated = await runExcavator(runAgent, {
    spark: input.spark,
    ...(input.clarifierAnswer ? { clarifierAnswer: input.clarifierAnswer } : {}),
  });

  const cards: LensCard[] = excavated.cards.map((c) => ({
    lens: c.lens,
    label: c.label,
    restatement: c.restatement,
    mechanism: c.mechanism,
  }));

  // §101 gate on the mechanism card: if it's still an abstract idea ("display
  // information"), rescue it by injecting the constraint that makes it a concrete
  // technical improvement. The §101 reasoning stays backstage — only the rescued
  // restatement/mechanism reach the card. Runs before the market read so the read
  // reflects the rescued framing.
  const mech = cards.find((c) => c.lens === "mechanism");
  if (mech) {
    try {
      const checked = await runSection101(runAgent, {
        problem: input.spark,
        restatement: mech.restatement,
        mechanism: mech.mechanism,
      });
      if (checked.restatement) mech.restatement = checked.restatement;
      if (checked.mechanism) mech.mechanism = checked.mechanism;
    } catch (err) {
      console.error("[brainstorm] §101 gate failed", err);
    }
  }

  // Ground each card in real competition (the differentiator), in parallel.
  await Promise.all(
    cards.map(async (card) => {
      try {
        const query = `${input.spark} ${card.label} ${card.restatement} — existing products, competitors, tools`;
        const evidence = await searchMarket(query);
        card.marketRead = await runMarketAnalyst(runAgent, {
          problem: input.spark,
          direction: `${card.restatement} (mechanism: ${card.mechanism})`,
          evidence,
        });
      } catch (err) {
        console.error("[brainstorm] market read failed for", card.label, err);
      }
    }),
  );

  // No "recommended" badge: the three directions are presented as equals and the
  // inventor chooses. (The old ranking could badge a CROWDED card as "best" when no
  // card had clean whitespace — recommending a crowded space is worse than not
  // recommending at all. The honest market meter on each card carries the signal.)

  const notes: string[] = [];
  if (!marketSearchEnabled() && cards.some((c) => c.marketRead)) {
    notes.push(
      "Market reads are from the model's knowledge (no live search wired yet) — verify the competitors before relying on them.",
    );
  }

  return {
    spark: input.spark,
    mode: "vague",
    ...(excavated.clarifier.prompt ? { clarifier: excavated.clarifier } : {}),
    cards,
    notes,
  };
}

/**
 * "Go deeper": narrow ONE chosen direction into three SHARPER sub-directions. Light by
 * design — short tap-to-pick options, NO market read (the rich three-card-with-market
 * screen happens once, at the top; deeper levels stay simple so the inventor isn't reading
 * a wall of text at every step).
 */
export async function deepenFrontier(
  runAgent: AgentRunner,
  input: {
    problem: string;
    direction: string;
    options?: string[];
    steer?: string;
  },
): Promise<ExcavationFrontier> {
  const out = await runDeepener(runAgent, input);
  const cards: LensCard[] = out.cards.map((c) => ({
    lens: "mechanism" as const,
    label: c.label,
    restatement: c.restatement,
    mechanism: "",
  }));
  return { spark: input.direction, mode: "vague", cards, notes: [] };
}

/**
 * The inventor picked a lens card — reconstruct its derivation and open the
 * adaptive walk. Lazy on purpose: only the chosen direction is reversed.
 */
export async function openLens(
  runAgent: AgentRunner,
  input: { spark: string; card: LensCard; backpack: Backpack },
): Promise<{ trace: DerivationTrace; opener: ReversalStep }> {
  // Aim the walk at the REAL breakthrough. If the card's surface is occupied
  // ("crowded"), the obvious mechanism is a dead end — derive toward the steer (the
  // how-plus-constraint one level below the vertical) instead, so the inventor is
  // only ever walked toward a reachable breakthrough, never interrogated on a
  // already-taken path. Clean/durable cards walk their own mechanism.
  const read = input.card.marketRead;
  const target =
    read?.verdict === "crowded" && read.steer?.trim() ? read.steer.trim() : input.card.mechanism;
  const trace = await runDerivationTracer(runAgent, {
    problem: input.spark,
    mechanism: target,
    operatesOn: input.card.restatement,
  });
  // Ground the walk in a real tensor (two poles + the assumed-away constraint) so it
  // TEACHES that tensor rather than inferring one mid-walk. Best-effort — the walk
  // falls back to inferring from the mechanism if this fails.
  try {
    trace.tensor = await runTensorFinder(runAgent, {
      problem: input.spark,
      mechanism: target,
      restatement: input.card.restatement,
      ...(input.card.marketRead ? { market: input.card.marketRead } : {}),
    });
  } catch (err) {
    console.error("[brainstorm] tensor-finder failed", err);
  }
  const opener = await runReversalStep(runAgent, {
    trace,
    backpack: input.backpack,
    conversation: [],
  });
  return { trace, opener };
}
