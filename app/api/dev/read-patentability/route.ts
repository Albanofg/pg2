import { NextResponse } from "next/server";
import { runPatentabilityReader } from "@/lib/modules/conception/agents";
import { openaiAgentRunner } from "@/lib/modules/conception/runner.openai";

/**
 * DEV-ONLY: runs the front-door patentability reader against a raw idea with the
 * REAL agent and returns its output, so we can judge the register and the quality
 * of the angles BEFORE a human hits it. Blocked in production.
 *
 *   GET  /api/dev/read-patentability            → the business-process sample
 *   GET  /api/dev/read-patentability?case=tech  → a technical sample (expect no card)
 *   POST /api/dev/read-patentability  {"idea":"…"}
 */
export const runtime = "nodejs";
export const maxDuration = 120;

/** The solar lead-gen business process (the Gemini "Patent Process" example). */
const BUSINESS_IDEA = `I have an idea for a lead gen service that supplies local solar installers with leads. It receives a geojson file that outlines an area affected by a power outage in real time, then does a data bump on that area to get addresses, then another data bump with city or county data to remove condos and apartment buildings, then another to filter for owners who live at the address, then another on city permit data to see which owners already have permits for solar. Then a same day postcard send where the postcard has a coupon code and QR code that uniquely identifies that customer, and when that customer goes to the website the website is completely free of any ad platform tracking so the customer is not inundated with competitor's ads. When the customer clicks the button to ask for more info they add their phone number and the lead is sent in real time to a local provider who will pay for the lead. The business advantage is much higher ROI on lead gen because you target people at their moment of pain, and by avoiding any digital footprint you are not watering down your leads.`;

/** A clearly technical idea — the reader should wave this through (verdict "technical"). */
const TECHNICAL_IDEA = `My system reduces write amplification in an LSM-tree key-value store running on a device with no network. Instead of compacting on a size trigger, it samples the per-key overwrite frequency in a bounded 4MB ring buffer and defers compaction for keys whose overwrite rate exceeds a threshold, so hot keys are merged once instead of on every level. Compaction runs only while the device is on external power and the write queue depth is under 8.`;

async function read(idea: string) {
  const started = Date.now();
  const result = await runPatentabilityReader(openaiAgentRunner, {
    verbatim: [idea],
    core: "",
  });
  return { ms: Date.now() - started, idea: idea.slice(0, 120) + "…", result };
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "dev_only" }, { status: 404 });
  }
  const which = new URL(req.url).searchParams.get("case");
  try {
    return NextResponse.json(await read(which === "tech" ? TECHNICAL_IDEA : BUSINESS_IDEA));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "dev_only" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { idea?: string };
  try {
    return NextResponse.json(await read(body.idea?.trim() || BUSINESS_IDEA));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
