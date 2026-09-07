import { assertEquals, assertThrows } from "@std/assert";
import {
  encodeRequirementsRecaptureParameters,
  fingerprintRequirementsRecaptureEnvelope,
  parseRequirementsRecaptureParameters,
  REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA,
} from "./requirements-recapture-proposal.ts";

const DIGEST = "a".repeat(64);
const OTHER = "b".repeat(64);

function admission() {
  return {
    schemaVersion: REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA,
    operation: { id: "model.recapture-requirements" as const, version: "1" as const },
    basis: {
      snapshotId: "thread:id01:r70",
      revision: 70,
      subjectId: "subject:id01",
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    },
    architecture: {
      artifactId: `architecture-${DIGEST}`,
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
      producerRunId: "run:architecture-r70",
    },
    predecessor: {
      artifactId: `requirements-CameraMountBracket-${OTHER}`,
      fingerprint: { algorithm: "sha256" as const, digest: OTHER },
      producerRunId: "run:requirements-r7",
      schemaVersion: "requirements-capture/3.0",
    },
    target: {
      kind: "part-definition" as const,
      label: "CameraMountBracket",
      elementId: "part-definition:camera-mount",
    },
    containerComponent: "CameraMountBracket",
    partDefName: "CameraMountBracketRequirements",
    requirementsElementId: "requirement-usage:camera-mount",
    envelope: {
      fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
    },
  };
}

Deno.test("requirements recapture MRTR round-trips the closed admission", () => {
  const parameters = encodeRequirementsRecaptureParameters(admission());
  assertEquals(parameters.length, 21);
  const parsed = parseRequirementsRecaptureParameters(parameters);
  assertEquals(parsed.schemaVersion, REQUIREMENTS_RECAPTURE_ADMISSION_SCHEMA);
  assertEquals(parsed.operation.id, "model.recapture-requirements");
  assertEquals(parsed.target.elementId, "part-definition:camera-mount");
  assertEquals(parsed.predecessor.schemaVersion, "requirements-capture/3.0");
  assertEquals(
    encodeRequirementsRecaptureParameters(parsed),
    parameters,
  );
});

Deno.test("requirements recapture MRTR refuses unknown keys, latest, and same-artifact pairs", () => {
  const parameters = [...encodeRequirementsRecaptureParameters(admission())];
  parameters.push({
    key: "model.recaptureRequirements.runtime",
    label: "Runtime",
    value: "latest",
  });
  assertThrows(() => parseRequirementsRecaptureParameters(parameters));

  const latest = admission();
  latest.basis.snapshotId = "latest";
  assertThrows(() => encodeRequirementsRecaptureParameters(latest));

  const same = admission();
  same.predecessor.artifactId = same.architecture.artifactId;
  assertThrows(() => encodeRequirementsRecaptureParameters(same));
});

Deno.test("requirements recapture envelope fingerprint is deterministic", async () => {
  const envelope = {
    target: admission().target,
    architectureBasis: {
      snapshotId: "thread:id01:r70",
      revision: 70,
      fingerprint: DIGEST,
    },
    containerComponent: "CameraMountBracket",
    partDefName: "CameraMountBracketRequirements",
    requirementsElementId: "requirement-usage:camera-mount",
    requirementUsage: {
      id: "requirement-usage:camera-mount",
      kind: "RequirementUsage" as const,
    },
    constraintUsages: [{
      requirementId: "max-mass",
      id: "constraint-usage:max-mass",
      kind: "ConstraintUsage" as const,
      sourceId: "constraint-usage:max-mass",
    }],
    requirements: [{
      id: "max-mass",
      name: "Max mass",
      metric: "maxMass",
      operator: "<=" as const,
      limit: { value: 5, unit: "kg" },
    }],
  };
  assertEquals(
    await fingerprintRequirementsRecaptureEnvelope(envelope),
    await fingerprintRequirementsRecaptureEnvelope(envelope),
  );
});
