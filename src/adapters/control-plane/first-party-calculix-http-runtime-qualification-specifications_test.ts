import { assertEquals } from "@std/assert";
import { fingerprintCalculixHttpQualificationCriteria } from "./calculix-http-runtime-qualification-criteria.ts";
import { fingerprintCalculixHttpQualificationProtocol } from "./calculix-http-runtime-qualification-protocol.ts";
import {
  createFirstPartyCalculixHttpRuntimeQualificationCandidates,
} from "./first-party-calculix-http-runtime-qualification-candidates.ts";
import {
  CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_SPEC_ID,
  createFirstPartyCalculixHttpRuntimeQualificationSpecifications,
} from "./first-party-calculix-http-runtime-qualification-specifications.ts";

Deno.test("the CalculiX HTTP specification fingerprints bytes/source/case/protocol/criteria", async () => {
  const [[candidate], [spec]] = await Promise.all([
    createFirstPartyCalculixHttpRuntimeQualificationCandidates(),
    createFirstPartyCalculixHttpRuntimeQualificationSpecifications(),
  ]);
  if (!candidate || !spec) throw new Error("qualification contract absent");
  assertEquals(spec.id, CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_SPEC_ID);
  assertEquals(spec.candidate, {
    id: candidate.id,
    version: candidate.version,
    fingerprint: candidate.fingerprint,
  });
  assertEquals(spec.sourceFingerprint, candidate.fixture.sourceFingerprint);
  assertEquals(spec.loweringFingerprint, candidate.fixture.methodFingerprint);
  assertEquals(spec.caseFingerprint, candidate.fixture.case.fingerprint);
  assertEquals(
    spec.protocolFingerprint,
    await fingerprintCalculixHttpQualificationProtocol(),
  );
  assertEquals(
    spec.criteriaFingerprint,
    await fingerprintCalculixHttpQualificationCriteria(),
  );
});
