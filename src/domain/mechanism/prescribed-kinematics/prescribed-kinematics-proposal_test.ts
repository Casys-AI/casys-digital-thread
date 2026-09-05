import { assertEquals, assertThrows } from "@std/assert";
import {
  encodePrescribedKinematicsCaseProposalParameters,
  encodePrescribedKinematicsRunProposalParameters,
  parsePrescribedKinematicsCaseProposalParameters,
  parsePrescribedKinematicsRunProposalParameters,
} from "./prescribed-kinematics-proposal.ts";

const CASE = {
  workspaceRevision: 4,
  attachmentId: "attachment-assembly",
  attachmentRevision: 1,
} as const;

const CASE_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "a".repeat(64),
};

Deno.test("L1 case proposal encodes exactly workspaceRevision, attachmentId, attachmentRevision", () => {
  const encoded = encodePrescribedKinematicsCaseProposalParameters(CASE);
  assertEquals(encoded.map((parameter) => parameter.key), [
    "workspaceRevision",
    "attachmentId",
    "attachmentRevision",
  ]);
  assertEquals(parsePrescribedKinematicsCaseProposalParameters(encoded), CASE);
  assertEquals(
    encoded.some((parameter) =>
      /provider|image|tool|args|endpoint|runtime|fingerprint/i.test(parameter.key)
    ),
    false,
  );
});

Deno.test("L1 case proposal refuses latest, extra keys, and provider smuggling", () => {
  assertThrows(
    () =>
      encodePrescribedKinematicsCaseProposalParameters({
        ...CASE,
        attachmentId: "latest",
      }),
    TypeError,
    "latest",
  );
  const encoded = [
    ...encodePrescribedKinematicsCaseProposalParameters(CASE),
    { key: "extra", label: "Extra", value: true },
  ];
  assertThrows(
    () => parsePrescribedKinematicsCaseProposalParameters(encoded),
    TypeError,
    "exactly 3",
  );
  assertThrows(
    () =>
      parsePrescribedKinematicsCaseProposalParameters([{
        key: "provider",
        label: "Provider",
        value: "chrono",
      }]),
    TypeError,
    "provider",
  );
});

Deno.test("L3 run proposal restates only the domain L1 case SHA-256", () => {
  const encoded = encodePrescribedKinematicsRunProposalParameters(CASE_FINGERPRINT);
  assertEquals(encoded, [{
    key: "caseFingerprint",
    label: "Exact L1 prescribed-kinematics case SHA-256",
    value: CASE_FINGERPRINT.digest,
  }]);
  assertEquals(parsePrescribedKinematicsRunProposalParameters(encoded), {
    caseFingerprint: CASE_FINGERPRINT,
  });
});

Deno.test("L3 run proposal refuses an invented placeholder and a provider key", () => {
  assertThrows(
    () =>
      parsePrescribedKinematicsRunProposalParameters([{
        key: "observation",
        label: "Observation",
        value: "prescribed-kinematics",
      }]),
    TypeError,
    "caseFingerprint",
  );
  assertThrows(
    () =>
      parsePrescribedKinematicsRunProposalParameters([{
        key: "runtime",
        label: "Runtime",
        value: "chrono",
      }]),
    TypeError,
    "runtime",
  );
  assertThrows(
    () =>
      encodePrescribedKinematicsRunProposalParameters({
        algorithm: "sha256",
        digest: "not-a-digest",
      }),
    TypeError,
    "SHA-256",
  );
});
