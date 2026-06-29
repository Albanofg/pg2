import "server-only";
import {
  runDerivationTracer,
  runExcavator,
  runMarketAnalyst,
  runReversalStep,
  runSection101,
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
  input: { spark: string; clarifierAnswer?: string },
): Promise<ExcavationFrontier> {
  const excavated = await runExcavator(runAgent, {
    spark: input.spark,
    ...(input.clarifierAnswer ? { clarifierAnswer: input.clarifierAnswer } : {}),
  });

  // The MECHANISM lens is the only true patent candidate — always recommended.
  const cards: LensCard[] = excavated.cards.map((c) => ({
    lens: c.lens,
    label: c.label,
    restatement: c.restatement,
    mechanism: c.mechanism,
    recommended: c.lens === "mechanism",
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

  const notes: string[] = [];
  if (!marketSearchEnabled() && cards.some((c) => c.marketRead)) {
    notes.push(
      "Market reads are from the model's knowledge (no live search wired yet) — verify the competitors before relying on them.",
    );
  }

  return {
    spark: input.spark,
    ...(excavated.clarifier.prompt ? { clarifier: excavated.clarifier } : {}),
    cards,
    notes,
  };
}

/**
 * The inventor picked a lens card — reconstruct its derivation and open the
 * adaptive walk. Lazy on purpose: only the chosen direction is reversed.
 */
export async function openLens(
  runAgent: AgentRunner,
  input: { spark: string; card: LensCard; backpack: Backpack },
): Promise<{ trace: DerivationTrace; opener: ReversalStep }> {
  const trace = await runDerivationTracer(runAgent, {
    problem: input.spark,
    mechanism: input.card.mechanism,
    operatesOn: input.card.restatement,
  });
  const opener = await runReversalStep(runAgent, {
    trace,
    backpack: input.backpack,
    conversation: [],
  });
  return { trace, opener };
}
