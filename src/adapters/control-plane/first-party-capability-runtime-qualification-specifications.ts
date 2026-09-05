/** Code-owned Chrono qualification specification; it is not an MCP surface. */

import { ChronoPrescribedKinematicsCaseLowerer } from "../mechanics/chrono/chrono-prescribed-kinematics-case-lowerer.ts";
import { fingerprintChronoArm64EmulationQualificationCriteria } from "../../domain/capability/runtime/capability-runtime-qualification-criteria.ts";
import {
  type CapabilityRuntimeQualificationSpecification,
  createCapabilityRuntimeQualificationSpecification,
} from "../../domain/capability/runtime/capability-runtime-qualification-specification.ts";
import { fingerprintChronoQualificationProtocol } from "../../application/use-cases/mechanics/prescribed-kinematics/prescribed-kinematics-receipt-readback.ts";
import {
  createFirstPartyCapabilityRuntimeQualificationCandidates,
} from "./first-party-capability-runtime-qualification-candidates.ts";

export const CHRONO_ARM64_EMULATION_QUALIFICATION_SPEC_ID =
  "chrono-arm64-emulation-v1-spec" as const;

export async function createFirstPartyCapabilityRuntimeQualificationSpecifications(): Promise<
  readonly CapabilityRuntimeQualificationSpecification[]
> {
  const candidates = await createFirstPartyCapabilityRuntimeQualificationCandidates();
  if (candidates.length !== 1 || candidates[0] === undefined) {
    throw new TypeError("Chrono qualification candidate must resolve exactly once.");
  }
  const candidate = candidates[0];
  const lowered = await new ChronoPrescribedKinematicsCaseLowerer().lower({
    source: candidate.fixture.source,
    sourceFingerprint: candidate.fixture.sourceFingerprint,
  });
  return Object.freeze([
    await createCapabilityRuntimeQualificationSpecification({
      schemaVersion: "capability-runtime-qualification-specification/1.0",
      id: CHRONO_ARM64_EMULATION_QUALIFICATION_SPEC_ID,
      version: "1",
      candidate: {
        id: candidate.id,
        version: candidate.version,
        fingerprint: candidate.fingerprint,
      },
      sourceFingerprint: candidate.fixture.sourceFingerprint,
      loweringFingerprint: lowered.loweringFingerprint,
      caseFingerprint: lowered.requestFingerprint,
      protocolFingerprint: await fingerprintChronoQualificationProtocol(),
      criteriaFingerprint: await fingerprintChronoArm64EmulationQualificationCriteria(),
    }),
  ]);
}
