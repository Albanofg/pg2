import "server-only";
import { createHash } from "node:crypto";

/**
 * RFC 3161 trusted timestamping.
 *
 * To prove the exact moment of human conception we:
 *   1. SHA-256 hash the Inventor's Notebook.
 *   2. Build a DER-encoded TimeStampReq carrying that hash.
 *   3. POST it to a public TSA (DigiCert) as application/timestamp-query.
 *   4. Receive the DER TimeStampResp and store it base64.
 *
 * Minimal hand-rolled DER encoder — every length here is < 128 bytes, but the
 * encoder handles the long form defensively in case the hash algorithm changes.
 */

// --- tiny DER helpers ---------------------------------------------------------

function derLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

// SHA-256 OID 2.16.840.1.101.3.4.2.1
const SHA256_OID = Buffer.from([
  0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
]);
const DER_NULL = Buffer.from([0x05, 0x00]);

/** Build the DER TimeStampReq for a 32-byte SHA-256 digest. */
export function buildTimeStampRequest(sha256: Buffer): Buffer {
  const version = tlv(0x02, Buffer.from([0x01])); // INTEGER 1
  const algId = tlv(0x30, Buffer.concat([SHA256_OID, DER_NULL]));
  const hashedMessage = tlv(0x04, sha256); // OCTET STRING
  const messageImprint = tlv(0x30, Buffer.concat([algId, hashedMessage]));
  const certReq = tlv(0x01, Buffer.from([0xff])); // BOOLEAN TRUE
  return tlv(0x30, Buffer.concat([version, messageImprint, certReq]));
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export type SealResult = {
  contentHash: string; // hex
  rfc3161Token: string | null; // base64 DER TimeStampResp
  sealedAt: Date;
  tsaStatus: "ok" | "tsa_unavailable";
};

/**
 * Hash the notebook and obtain a trusted timestamp token. If the TSA is
 * unreachable we still return the hash + server time so sealing degrades
 * gracefully (the cryptographic proof can be re-obtained later from the hash).
 */
export async function sealNotebook(content: string): Promise<SealResult> {
  const hashHex = sha256Hex(content);
  const digest = Buffer.from(hashHex, "hex");
  const tsaUrl = process.env.TSA_URL || "http://timestamp.digicert.com";

  try {
    const req = buildTimeStampRequest(digest);
    const res = await fetch(tsaUrl, {
      method: "POST",
      headers: { "content-type": "application/timestamp-query" },
      body: new Uint8Array(req),
    });
    if (!res.ok) throw new Error(`TSA returned ${res.status}`);
    const reply = Buffer.from(await res.arrayBuffer());
    return {
      contentHash: hashHex,
      rfc3161Token: reply.toString("base64"),
      sealedAt: new Date(),
      tsaStatus: "ok",
    };
  } catch (err) {
    console.error("[rfc3161] TSA request failed", err);
    return {
      contentHash: hashHex,
      rfc3161Token: null,
      sealedAt: new Date(),
      tsaStatus: "tsa_unavailable",
    };
  }
}
