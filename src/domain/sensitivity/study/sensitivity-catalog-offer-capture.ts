/**
 * Fail-closed parser for the sealed `sensitivity-catalog-offer-capture/1.0`
 * document published by `verify.seal-proof-case@1`.
 *
 * The stored offer is not a runnable study. A later sensitivity-study seal
 * review reopens this envelope, digest-checks it, and recompiles the offer
 * from the signed proof plus admission before compiling `step`.
 */

import { exactRecord, nonEmptyText } from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import { VERIFY_SEAL_PROOF_CASE_OPERATION } from "../../fea/seal-case/fea-proof-proposal.ts";
import {
  type ReadySensitivityCatalogOffer,
  SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA,
  validateReadySensitivityCatalogOffer,
} from "./sensitivity-catalog-from-proof.ts";

export interface SensitivityCatalogOfferCapture {
  readonly schemaVersion: typeof SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA;
  readonly trustedRunId: string;
  readonly sealedAt: string;
  readonly offerDigest: string;
  readonly offer: ReadySensitivityCatalogOffer;
}

const SHA256 = /^[a-f0-9]{64}$/;

export async function parseSensitivityCatalogOfferCapture(
  text: string,
): Promise<SensitivityCatalogOfferCapture> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError("Sensitivity catalog offer capture is not valid JSON.");
  }
  const record = exactRecord(
    parsed,
    [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "sealedAt",
      "offerDigest",
      "offer",
    ],
    "Sensitivity catalog offer capture",
  );
  if (deterministicJson(record) !== text) {
    throw new TypeError("Sensitivity catalog offer capture is not canonical JSON.");
  }
  if (record.schemaVersion !== SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA) {
    throw new TypeError(
      "Sensitivity catalog offer capture schemaVersion is unsupported.",
    );
  }
  const operation = exactRecord(
    record.operation,
    ["id", "version"],
    "Sensitivity catalog offer capture.operation",
  );
  if (
    operation.id !== VERIFY_SEAL_PROOF_CASE_OPERATION.id ||
    operation.version !== VERIFY_SEAL_PROOF_CASE_OPERATION.version
  ) {
    throw new TypeError(
      "Sensitivity catalog offer capture was not produced by verify.seal-proof-case@1.",
    );
  }
  const sealedAt = nonEmptyText(
    record.sealedAt,
    "Sensitivity catalog offer capture.sealedAt",
  );
  if (Number.isNaN(Date.parse(sealedAt))) {
    throw new TypeError(
      "Sensitivity catalog offer capture sealedAt must be ISO-8601.",
    );
  }
  const offer = validateReadySensitivityCatalogOffer(
    record.offer,
    "Sensitivity catalog offer capture.offer",
  );
  const offerDigest = digestValue(
    record.offerDigest,
    "Sensitivity catalog offer capture.offerDigest",
  );
  const computed = (await sha256Fingerprint(offer)).digest;
  if (computed !== offerDigest) {
    throw new TypeError(
      "Sensitivity catalog offer capture does not bind canonical offer bytes.",
    );
  }
  return {
    schemaVersion: SENSITIVITY_CATALOG_OFFER_CAPTURE_SCHEMA,
    trustedRunId: nonEmptyText(
      record.trustedRunId,
      "Sensitivity catalog offer capture.trustedRunId",
    ),
    sealedAt,
    offerDigest,
    offer,
  };
}

function digestValue(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!SHA256.test(digest)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 hex digest.`);
  }
  return digest;
}
