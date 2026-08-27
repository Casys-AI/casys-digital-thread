import { assertEquals } from "@std/assert";
import {
  encodeSpiceAdmittedObservationEvaluationAdmission,
  parseSpiceAdmittedObservationEvaluationParameters,
  VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION,
} from "./admitted-observation-evaluation-proposal.ts";

const DIGEST = "a".repeat(64);

function admission() {
  return {
    schemaVersion: "spice-admitted-observation-evaluation-admission/1.0",
    methodSchemaVersion: "spice-admitted-observation-evaluation-method/1.0",
    projectId: "project.electrical-method",
    subjectId: "subject.electrical-method",
    basis: {
      snapshotId: "placeholder-thread-snapshot",
      revision: 1,
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    },
    sheet: {
      id: "placeholder-electrical-observation-method-sheet",
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    },
    capture: {
      artifactId: `spice-admitted-capture-${DIGEST}`,
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    },
    evidence: {
      artifactId: `spice-admitted-evidence-${DIGEST}`,
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    },
    result: {
      artifactId: `spice-admitted-result-${DIGEST}`,
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    },
    methodFingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    profileId: "admitted-spice-observations-v1",
    unitAlgebra: {
      id: "electrical-observation-unit-algebra",
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    },
  };
}

Deno.test("admitted SPICE evaluation MRTR round-trips identities without values or SysON", () => {
  const parameters = encodeSpiceAdmittedObservationEvaluationAdmission(
    admission(),
  );
  assertEquals(
    `${VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.id}@${VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.version}`,
    "verify.evaluate-admitted-spice-observations@1",
  );
  for (const parameter of parameters) {
    const encoded = JSON.stringify(parameter);
    assertEquals(encoded.includes("syson"), false);
    assertEquals(encoded.includes('"args"'), false);
    assertEquals(encoded.includes("provider"), false);
  }
  const parsed = parseSpiceAdmittedObservationEvaluationParameters(parameters);
  assertEquals(parsed.capture.artifactId, `spice-admitted-capture-${DIGEST}`);
  assertEquals(parsed.evidence.artifactId, `spice-admitted-evidence-${DIGEST}`);
  assertEquals(parsed.result.artifactId, `spice-admitted-result-${DIGEST}`);
});

Deno.test("admitted SPICE evaluation MRTR refuses a capture id that does not derive from its digest", () => {
  const value = admission();
  value.capture.artifactId = "spice-admitted-capture-other";
  const error = throws(() => encodeSpiceAdmittedObservationEvaluationAdmission(value));
  assertEquals(error.message.includes("derive from its digest"), true);
});

function throws(run: () => unknown): TypeError {
  try {
    run();
  } catch (error) {
    if (error instanceof TypeError) return error;
    throw error;
  }
  throw new Error("expected TypeError");
}
