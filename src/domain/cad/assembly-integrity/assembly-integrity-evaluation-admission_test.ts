import { assertEquals, assertThrows } from "@std/assert";
import {
  encodeAssemblyIntegrityEvaluationAdmissionParameters,
  parseAssemblyIntegrityEvaluationAdmissionParameters,
  validateAssemblyIntegrityEvaluationAdmission,
} from "./assembly-integrity-evaluation-admission.ts";
import {
  VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
} from "./assembly-integrity-evaluation-proposal.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const F = "f".repeat(64);

Deno.test("assembly-integrity L4 admission binds only server-derived identities", () => {
  const admission = validAdmission();
  const parameters = encodeAssemblyIntegrityEvaluationAdmissionParameters(admission);

  assertEquals(parameters.length, 20);
  assertEquals(
    parseAssemblyIntegrityEvaluationAdmissionParameters(parameters),
    admission,
  );
  assertThrows(
    () => validateAssemblyIntegrityEvaluationAdmission({ ...admission, tolerance: 1 }),
    TypeError,
    "unsupported field tolerance",
  );
  assertThrows(
    () =>
      parseAssemblyIntegrityEvaluationAdmissionParameters([
        ...parameters,
        { key: "verdict", label: "verdict", value: "pass" },
      ]),
    TypeError,
    "exactly",
  );
  assertThrows(
    () =>
      validateAssemblyIntegrityEvaluationAdmission({
        ...admission,
        observation: { ...admission.observation, artifactId: "latest" },
      }),
    TypeError,
    "must bind",
  );
});

Deno.test("assembly-integrity L4 admission projects an L3 geometry capture before strict MRTR encoding", () => {
  const l3GeometryModule = {
    schemaVersion: "geometry-module-capture/1.0" as const,
    artifactId: `geometry-${A}`,
    fingerprint: fp(A),
  };
  const admission = {
    ...validAdmission(),
    geometryModule: {
      artifactId: l3GeometryModule.artifactId,
      fingerprint: l3GeometryModule.fingerprint,
    },
  };

  assertEquals(
    parseAssemblyIntegrityEvaluationAdmissionParameters(
      encodeAssemblyIntegrityEvaluationAdmissionParameters(admission),
    ).geometryModule,
    admission.geometryModule,
  );
  assertThrows(
    () =>
      encodeAssemblyIntegrityEvaluationAdmissionParameters({
        ...admission,
        geometryModule: l3GeometryModule,
      }),
    TypeError,
    "unsupported field schemaVersion",
  );
});

function validAdmission() {
  return validateAssemblyIntegrityEvaluationAdmission({
    schemaVersion: "assembly-integrity-evaluation-admission/1.0",
    operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
    projectId: "project-assembly",
    basis: {
      kind: "thread-snapshot",
      snapshotId: "assembly:r7",
      revision: 7,
      subjectId: "assembly",
    },
    observation: {
      artifactId: `assembly-integrity-observation-${C}`,
      fingerprint: fp(C),
      observationFingerprint: fp(D),
    },
    geometryModule: { artifactId: `geometry-${A}`, fingerprint: fp(A) },
    assemblyStep: {
      artifactId: `cad-asset-${A}-module-step-${B}`,
      fingerprint: fp(B),
    },
    inputBundle: {
      schemaVersion: "assembly-integrity-input-bundle/1.0",
      fingerprint: fp(E),
      byteCount: 1024,
    },
    method: {
      schemaVersion: "assembly-integrity-evaluation-method/1.0",
      id: "assembly-integrity-evaluation",
      version: "1.0",
      fingerprint: fp(F),
    },
  });
}

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}
