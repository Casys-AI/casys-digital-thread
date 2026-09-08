/** Fingerprint-only CalculiX HTTP qualification specification. */

import { fingerprintCalculixHttpQualificationCriteria } from "./calculix-http-runtime-qualification-criteria.ts";
import { fingerprintCalculixHttpQualificationProtocol } from "./calculix-http-runtime-qualification-protocol.ts";
import {
  type CapabilityRuntimeQualificationSpecification,
  createCapabilityRuntimeQualificationSpecification,
} from "../../domain/capability/runtime/capability-runtime-qualification-specification.ts";
import {
  CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID,
  createFirstPartyCalculixHttpRuntimeQualificationCandidates,
} from "./first-party-calculix-http-runtime-qualification-candidates.ts";

export const CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_SPEC_ID =
  "calculix-http-arm64-native-v1-spec" as const;

export async function createFirstPartyCalculixHttpRuntimeQualificationSpecifications(): Promise<
  readonly CapabilityRuntimeQualificationSpecification[]
> {
  const candidate =
    (await createFirstPartyCalculixHttpRuntimeQualificationCandidates())[0];
  if (
    !candidate || candidate.id !== CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID
  ) {
    throw new TypeError(
      "CalculiX HTTP qualification candidate must resolve exactly once.",
    );
  }
  return Object.freeze([
    await createCapabilityRuntimeQualificationSpecification({
      schemaVersion: "capability-runtime-qualification-specification/1.0",
      id: CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_SPEC_ID,
      version: "1",
      candidate: {
        id: candidate.id,
        version: candidate.version,
        fingerprint: candidate.fingerprint,
      },
      sourceFingerprint: candidate.fixture.sourceFingerprint,
      loweringFingerprint: candidate.fixture.methodFingerprint,
      caseFingerprint: candidate.fixture.case.fingerprint,
      protocolFingerprint: await fingerprintCalculixHttpQualificationProtocol(),
      criteriaFingerprint: await fingerprintCalculixHttpQualificationCriteria(),
    }),
  ]);
}
