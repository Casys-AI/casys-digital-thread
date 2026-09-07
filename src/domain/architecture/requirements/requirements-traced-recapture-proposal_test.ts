import { assertEquals, assertThrows } from "@std/assert";
import {
  encodeTracedRequirementsRecaptureParameters,
  MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION,
  MODEL_RECAPTURE_TRACED_REQUIREMENTS_PRODUCER_TOOL,
  parseTracedRequirementsRecaptureProposalParameters,
  REQUIREMENTS_TRACED_RECAPTURE_ADMISSION_SCHEMA,
  REQUIREMENTS_TRACED_RECAPTURE_CAPTURE_SCHEMA,
  type RequirementsTracedRecaptureAdmission,
  validateTracedRequirementsRecaptureAdmission,
} from "./requirements-traced-recapture-proposal.ts";
import {
  encodeRequirementsRecaptureParameters,
  parseRequirementsRecaptureParameters,
  validateRequirementsRecaptureAdmission,
} from "./requirements-recapture-proposal.ts";

function admission(
  predecessorSchema: "requirements-capture/5.0" | "requirements-capture/6.0" =
    "requirements-capture/5.0",
): RequirementsTracedRecaptureAdmission {
  return {
    schemaVersion: REQUIREMENTS_TRACED_RECAPTURE_ADMISSION_SCHEMA,
    operation: MODEL_RECAPTURE_TRACED_REQUIREMENTS_OPERATION,
    basis: {
      snapshotId: "thread:fixture:r4",
      revision: 4,
      subjectId: "subject:fixture",
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    },
    architecture: {
      artifactId: "artifact:architecture:r4",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      producerRunId: "run:architecture:r4",
    },
    predecessor: {
      artifactId: "artifact:requirements:r3",
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      producerRunId: "run:requirements:r3",
      schemaVersion: predecessorSchema,
    },
    target: {
      kind: "part-definition",
      label: "Wing",
      elementId: "part-definition:wing",
    },
    containerComponent: "Wing",
    partDefName: "WingRequirements",
    requirementsElementId: "requirement-usage:wing",
    envelope: { fingerprint: { algorithm: "sha256", digest: "d".repeat(64) } },
  };
}

Deno.test("traced recapture MRTR round-trips both traced predecessor schemas without relabeling", () => {
  for (
    const schema of ["requirements-capture/5.0", "requirements-capture/6.0"] as const
  ) {
    const input = admission(schema);
    const parameters = encodeTracedRequirementsRecaptureParameters(input);
    assertEquals(parameters.length, 21);
    const parsed = parseTracedRequirementsRecaptureProposalParameters(parameters);
    assertEquals(parsed, input);
    assertEquals(parsed.operation.version, "2");
    assertEquals(parsed.predecessor.schemaVersion, schema);
    assertEquals(encodeTracedRequirementsRecaptureParameters(parsed), parameters);
    assertEquals(Object.isFrozen(parsed), true);
    assertEquals(Object.isFrozen(parsed.predecessor), true);
    assertEquals(Object.isFrozen(parameters), true);
  }
  assertEquals(
    MODEL_RECAPTURE_TRACED_REQUIREMENTS_PRODUCER_TOOL,
    "model.recapture-requirements@2",
  );
  assertEquals(
    REQUIREMENTS_TRACED_RECAPTURE_CAPTURE_SCHEMA,
    "requirements-capture/6.0",
  );
});

Deno.test("traced recapture refuses untraced predecessors and historical grammar refuses downgrade", () => {
  for (
    const schema of [
      "requirements-capture/1.0",
      "requirements-capture/3.0",
      "requirements-capture/4.0",
      "requirements-capture/7.0",
    ]
  ) {
    const value = admission();
    assertThrows(() =>
      validateTracedRequirementsRecaptureAdmission({
        ...value,
        predecessor: { ...value.predecessor, schemaVersion: schema },
      })
    );
    const parameters = encodeTracedRequirementsRecaptureParameters(value).map((
      parameter,
    ) =>
      parameter.key.endsWith("predecessor.schemaVersion")
        ? { ...parameter, value: schema }
        : parameter
    );
    assertThrows(() => parseTracedRequirementsRecaptureProposalParameters(parameters));
  }
  for (
    const schema of ["requirements-capture/5.0", "requirements-capture/6.0"] as const
  ) {
    const traced = admission(schema);
    assertThrows(() =>
      validateRequirementsRecaptureAdmission({
        ...traced,
        schemaVersion: "requirements-recapture-admission/1.0",
        operation: { id: "model.recapture-requirements", version: "1" },
      })
    );
    assertThrows(() =>
      parseRequirementsRecaptureParameters(
        encodeTracedRequirementsRecaptureParameters(traced),
      )
    );
  }
});

Deno.test("traced recapture refuses every forged operation/admission discriminant", () => {
  for (
    const operation of [
      { id: "model.recapture-requirements", version: "1" },
      { id: "model.write-requirements", version: "2" },
      { id: "model.recapture-requirements", version: 2 },
      { id: "model.recapture-requirements", version: "2", runtime: "latest" },
    ]
  ) {
    assertThrows(() =>
      validateTracedRequirementsRecaptureAdmission({ ...admission(), operation })
    );
  }
  assertThrows(() =>
    validateTracedRequirementsRecaptureAdmission({
      ...admission(),
      schemaVersion: "requirements-recapture-admission/1.0",
    })
  );
  for (
    const [key, value] of [
      ["schemaVersion", "requirements-recapture-admission/1.0"],
      ["operation.version", "1"],
      ["operation.id", "model.write-requirements"],
    ]
  ) {
    const parameters = encodeTracedRequirementsRecaptureParameters(admission()).map((
      parameter,
    ) =>
      parameter.key === `model.recaptureRequirements.${key}`
        ? { ...parameter, value: value! }
        : parameter
    );
    assertThrows(() => parseTracedRequirementsRecaptureProposalParameters(parameters));
  }
});

Deno.test("traced recapture reuses exact scalar, label and field validation", () => {
  const parameters = encodeTracedRequirementsRecaptureParameters(admission());
  assertThrows(() =>
    parseTracedRequirementsRecaptureProposalParameters([
      ...parameters,
      { key: "model.recaptureRequirements.runtime", label: "Runtime", value: "latest" },
    ])
  );
  assertThrows(() =>
    parseTracedRequirementsRecaptureProposalParameters([
      ...parameters.slice(0, -1),
      parameters[0]!,
    ])
  );
  assertThrows(() =>
    parseTracedRequirementsRecaptureProposalParameters([
      { ...parameters[0]!, label: "Forged label" },
      ...parameters.slice(1),
    ])
  );
  assertThrows(() =>
    parseTracedRequirementsRecaptureProposalParameters([
      { ...parameters[0]!, unit: "extra" },
      ...parameters.slice(1),
    ])
  );
  assertThrows(() =>
    parseTracedRequirementsRecaptureProposalParameters([...parameters].reverse())
  );
  assertThrows(() =>
    validateTracedRequirementsRecaptureAdmission({ ...admission(), sourceRefs: [] })
  );
  assertThrows(() =>
    validateTracedRequirementsRecaptureAdmission({
      ...admission(),
      basis: { ...admission().basis, snapshotId: "latest" },
    })
  );
  assertThrows(() =>
    validateTracedRequirementsRecaptureAdmission({
      ...admission(),
      predecessor: {
        ...admission().predecessor,
        artifactId: admission().architecture.artifactId,
      },
    })
  );
});

Deno.test("historical scalar recapture admissions remain unchanged", () => {
  for (const schema of ["requirements-capture/3.0", "requirements-capture/4.0"]) {
    const historical = {
      ...admission(),
      schemaVersion: "requirements-recapture-admission/1.0",
      operation: { id: "model.recapture-requirements", version: "1" },
      predecessor: { ...admission().predecessor, schemaVersion: schema },
    };
    const parameters = encodeRequirementsRecaptureParameters(historical);
    assertEquals(parseRequirementsRecaptureParameters(parameters), historical);
    assertThrows(() => parseTracedRequirementsRecaptureProposalParameters(parameters));
  }
});
