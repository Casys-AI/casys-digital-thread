import { assertEquals } from "@std/assert";
import { ChronoPrescribedKinematicsCaseLowerer } from "../mechanics/chrono/chrono-prescribed-kinematics-case-lowerer.ts";
import { createFirstPartyCapabilityRuntimeQualificationCandidates } from "./first-party-capability-runtime-qualification-candidates.ts";
import {
  CHRONO_ARM64_EMULATION_QUALIFICATION_SPEC_ID,
  createFirstPartyCapabilityRuntimeQualificationSpecifications,
} from "./first-party-capability-runtime-qualification-specifications.ts";
import { fingerprintChronoArm64EmulationQualificationCriteria } from "../../domain/capability/runtime/capability-runtime-qualification-criteria.ts";
import { CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT } from "../../domain/capability/runtime/capability-runtime-qualification-criteria.ts";
import { prescribedKinematicsRequiredSampleTimes } from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";
import {
  CHRONO_QUALIFICATION_DISPATCH_DEADLINE_MS,
  CHRONO_QUALIFICATION_PROTOCOL,
  fingerprintChronoQualificationProtocol,
} from "../../application/use-cases/mechanics/prescribed-kinematics/prescribed-kinematics-receipt-readback.ts";

Deno.test("the first-party Chrono spec fingerprints candidate, source, lowering, case, protocol and criteria", async () => {
  const [candidates, specs] = await Promise.all([
    createFirstPartyCapabilityRuntimeQualificationCandidates(),
    createFirstPartyCapabilityRuntimeQualificationSpecifications(),
  ]);
  const candidate = candidates[0]!;
  const spec = specs[0]!;
  assertEquals(spec.id, CHRONO_ARM64_EMULATION_QUALIFICATION_SPEC_ID);
  assertEquals(spec.candidate.id, candidate.id);
  assertEquals(spec.candidate.fingerprint, candidate.fingerprint);
  assertEquals(spec.sourceFingerprint, candidate.fixture.sourceFingerprint);
  const lowered = await new ChronoPrescribedKinematicsCaseLowerer().lower({
    source: candidate.fixture.source,
    sourceFingerprint: candidate.fixture.sourceFingerprint,
  });
  assertEquals(spec.loweringFingerprint, lowered.loweringFingerprint);
  assertEquals(spec.caseFingerprint, lowered.requestFingerprint);
  assertEquals(
    spec.criteriaFingerprint,
    await fingerprintChronoArm64EmulationQualificationCriteria(),
  );
  assertEquals(
    spec.protocolFingerprint,
    await fingerprintChronoQualificationProtocol(),
  );
  assertEquals(
    CHRONO_QUALIFICATION_PROTOCOL.schemaVersion,
    "chrono-qualification-protocol/2.0",
  );
  assertEquals(CHRONO_QUALIFICATION_DISPATCH_DEADLINE_MS, 5 * 60 * 1000);
  assertEquals(
    CHRONO_QUALIFICATION_PROTOCOL.dispatchDeadlineMs,
    CHRONO_QUALIFICATION_DISPATCH_DEADLINE_MS,
  );
  assertEquals(
    prescribedKinematicsRequiredSampleTimes(candidate.fixture.source).length,
    CHRONO_ARM64_EMULATION_QUALIFICATION_SAMPLE_COUNT,
  );
  const again = await createFirstPartyCapabilityRuntimeQualificationSpecifications();
  assertEquals(again[0]?.fingerprint, spec.fingerprint);
});
