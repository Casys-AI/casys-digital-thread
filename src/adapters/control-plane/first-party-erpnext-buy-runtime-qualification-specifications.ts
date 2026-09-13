/** Fingerprint-only ERP Buy qualification specification. */

import {
  type CapabilityRuntimeQualificationSpecification,
  createCapabilityRuntimeQualificationSpecification,
} from "../../domain/capability/runtime/capability-runtime-qualification-specification.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import { fingerprintErpnextBuyQualificationCriteria } from "./erpnext-buy-runtime-qualification-criteria.ts";
import { fingerprintErpnextBuyQualificationProtocol } from "./erpnext-buy-runtime-qualification-protocol.ts";
import {
  ERPNEXT_BUY_RUNTIME_QUALIFICATION_CANDIDATE_ID,
  type ErpnextBuyRuntimeQualificationCandidate,
} from "./first-party-erpnext-buy-runtime-qualification-candidates.ts";
import { ERPNEXT_BUY_QUALIFICATION_PROTOCOL } from "./erpnext-buy-runtime-qualification-protocol.ts";

export const ERPNEXT_BUY_RUNTIME_QUALIFICATION_SPEC_ID =
  "erpnext-buy-source-v1-spec" as const;

export async function createErpnextBuyRuntimeQualificationSpecifications(
  candidates: readonly ErpnextBuyRuntimeQualificationCandidate[],
): Promise<readonly CapabilityRuntimeQualificationSpecification[]> {
  const candidate = candidates[0];
  if (
    candidates.length !== 1 || !candidate ||
    candidate.id !== ERPNEXT_BUY_RUNTIME_QUALIFICATION_CANDIDATE_ID
  ) {
    throw new TypeError("ERP Buy qualification candidate must resolve exactly once.");
  }
  const loweringFingerprint = await sha256Fingerprint({
    schemaVersion: "erpnext-buy-qualification-lowering/1.0",
    protocol: ERPNEXT_BUY_QUALIFICATION_PROTOCOL,
  });
  const caseFingerprint = await sha256Fingerprint({
    schemaVersion: "erpnext-buy-qualification-case/1.0",
    fixtureId: candidate.fixture.id,
    documents: candidate.fixture.documents,
  });
  return Object.freeze([
    await createCapabilityRuntimeQualificationSpecification({
      schemaVersion: "capability-runtime-qualification-specification/1.0",
      id: ERPNEXT_BUY_RUNTIME_QUALIFICATION_SPEC_ID,
      version: "1",
      candidate: {
        id: candidate.id,
        version: candidate.version,
        fingerprint: candidate.fingerprint,
      },
      sourceFingerprint: candidate.fixture.sourceFingerprint,
      loweringFingerprint,
      caseFingerprint,
      protocolFingerprint: await fingerprintErpnextBuyQualificationProtocol(),
      criteriaFingerprint: await fingerprintErpnextBuyQualificationCriteria(),
    }),
  ]);
}
