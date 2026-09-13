/** Recross retained ERP evidence without recomputing recorded prices. */
import type { BuyCostBundle } from "./buy-cost-bundle.ts";
import {
  assertBuySourceCaptureFingerprint,
  type BuySourceCaptureEnvelope,
  findBuySourceChildRow,
  findBuySourceDocument,
} from "./buy-source-capture.ts";
import { deterministicJson, sha256Hex } from "../kernel/deterministic-json.ts";

export async function assertBuySourceLineage(
  bundle: BuyCostBundle,
  captures: readonly BuySourceCaptureEnvelope[],
): Promise<void> {
  const retained = new Map(captures.map((item) => [item.fingerprint, item]));
  if (
    retained.size !== captures.length ||
    bundle.sourceCaptures.length !== captures.length
  ) {
    throw new TypeError(
      "Buy source references must match the retained captures exactly.",
    );
  }
  const seen = new Set<string>();
  for (const ref of bundle.sourceCaptures) {
    const envelope = retained.get(ref.fingerprint);
    if (
      !envelope || seen.has(ref.fingerprint) ||
      deterministicJson(ref.sourceInstance) !==
        deterministicJson(envelope.capture.sourceInstance) ||
      ref.capturedAt !== envelope.capture.capturedAt
    ) {
      throw new TypeError("Buy source reference does not match its retained capture.");
    }
    seen.add(ref.fingerprint);
    await assertBuySourceCaptureFingerprint(envelope, sha256Hex);
  }
  for (const line of bundle.lines) {
    const citation = line.citation;
    if (citation?.kind !== "erp-attested") continue;
    const envelope = retained.get(citation.captureFingerprint);
    const document = envelope &&
      findBuySourceDocument(envelope.capture, citation.document);
    if (
      !envelope || !document ||
      deterministicJson(citation.sourceInstance) !==
        deterministicJson(envelope.capture.sourceInstance) ||
      document.modified !== citation.modified ||
      document.fingerprint !== citation.documentFingerprint ||
      (citation.rowName !== undefined &&
        !findBuySourceChildRow(document, citation.rowName))
    ) {
      throw new TypeError(
        "Buy line citation does not match its retained ERP evidence.",
      );
    }
  }
}
