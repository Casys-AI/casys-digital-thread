import { assertEquals, assertThrows } from "@std/assert";
import type { IsolatedCodeExecutionReceipt } from "../../compile/isolation/isolated-code-execution.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../thread/thread-snapshot-extension.ts";
import type { ThreadSnapshot } from "../../thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../thread/thread-snapshot-validation.ts";
import type { ModelicaAdmittedExecutionCapture } from "./execution-evidence.ts";
import {
  assertThreadEvidenceExact,
  buildDocumentarySuccessor,
  exactAdmissionArtifact,
  threadEvidenceFor,
} from "./documentary-thread-evidence.ts";

const CAPTURED_AT = "2026-08-20T05:00:00.000Z";
const ADMISSION_DIGEST = "a".repeat(64);
const ADMISSION_ID = `technical-compilation-admission-${ADMISSION_DIGEST}`;
const ADMISSION_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: ADMISSION_DIGEST,
};

function freshAt() {
  return {
    status: "fresh" as const,
    changedAt: CAPTURED_AT,
    invalidatedByChangeIds: [],
  };
}

async function basisSnapshot(): Promise<ThreadSnapshot> {
  const modelFingerprint = await sha256Fingerprint({ model: "ramp" });
  const modelArtifact = {
    id: "artifact.model.ramp",
    name: "Ramp model",
    kind: "sysml-model" as const,
    version: modelFingerprint.digest,
    fingerprint: modelFingerprint,
    uri: `casys://sysml/sha256/${modelFingerprint.digest}`,
    mediaType: "application/json",
    producer: { serverId: "syson", tool: "capture", runId: "run.syson" },
    inputArtifactIds: [],
    freshness: freshAt(),
  };
  const current = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.ramp.1",
    revision: 1,
    generatedAt: CAPTURED_AT,
    subject: {
      id: "subject.ramp",
      name: "Ramp",
      kind: "system",
      version: "1",
      modelArtifactId: modelArtifact.id,
    },
    freshness: freshAt(),
    changeSet: {
      id: "changes.ramp.1",
      name: "Ramp baseline",
      status: "applied",
      createdAt: CAPTURED_AT,
      appliedAt: CAPTURED_AT,
      changes: [{
        id: "change.artifact.model.ramp",
        kind: "created",
        target: { kind: "artifact", id: modelArtifact.id },
        summary: "Created the Ramp model.",
        afterFingerprint: modelArtifact.fingerprint,
      }],
    },
    artifacts: [modelArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.artifact.model.ramp",
      relation: "changes",
      from: { kind: "change", id: "change.artifact.model.ramp" },
      to: { kind: "artifact", id: modelArtifact.id },
      rationale: "Created the Ramp model.",
    }],
    proposedActions: [],
  });
  const admissionArtifact = {
    id: ADMISSION_ID,
    name: "Modelica technical compilation admission",
    kind: "document" as const,
    version: ADMISSION_DIGEST,
    fingerprint: ADMISSION_FINGERPRINT,
    uri: `casys://technical-compilation-admission-capture/sha256/${ADMISSION_DIGEST}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "compile.seal-admission@3",
      runId: "run.compile.seal",
    },
    inputArtifactIds: [],
    freshness: freshAt(),
  };
  const applied = applyThreadSnapshotExtensionIfNew(current, {
    id: "admitted-modelica-basis",
    name: "Admitted Modelica basis",
    subjectId: current.subject.id,
    capturedAt: CAPTURED_AT,
    artifacts: [admissionArtifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  }, { appliedAt: CAPTURED_AT });
  if (!applied.applied) throw new Error("basis extension failed");
  return validateThreadSnapshot(applied.snapshot);
}

function capture(): ModelicaAdmittedExecutionCapture {
  return {
    admission: {
      admissionArtifact: {
        id: ADMISSION_ID,
        fingerprint: ADMISSION_FINGERPRINT,
      },
    },
    metrics: [
      { outputName: "position", statistic: "final", value: 0, unit: "m" },
      { outputName: "position", statistic: "max_abs", value: 1, unit: "m" },
    ],
  } as unknown as ModelicaAdmittedExecutionCapture;
}

function receipt(): IsolatedCodeExecutionReceipt {
  return {
    outputs: [
      {
        role: "evidence",
        sha256: "e".repeat(64),
        casUri: `casys://isolated-output/sha256/${"e".repeat(64)}`,
        mediaType: "application/json",
      },
      {
        role: "result",
        sha256: "f".repeat(64),
        casUri: `casys://isolated-output/sha256/${"f".repeat(64)}`,
        mediaType: "text/csv",
      },
    ],
  } as unknown as IsolatedCodeExecutionReceipt;
}

Deno.test("documentary successor records exact three artifacts, observations, and provenance", async () => {
  const basis = await basisSnapshot();
  const captureFingerprint = { algorithm: "sha256" as const, digest: "c".repeat(64) };
  const expected = buildDocumentarySuccessor({
    basisSnapshot: basis,
    basis: {
      kind: "thread-snapshot",
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
    runId: "run.admitted",
    capturedAt: CAPTURED_AT,
    capture: capture(),
    captureFingerprint,
    captureUri:
      `casys://modelica-admitted-execution/sha256/${captureFingerprint.digest}`,
    receipt: receipt(),
  });
  assertEquals(expected.artifacts.map((artifact) => artifact.kind), [
    "document",
    "evidence",
    "solver-result",
  ]);
  assertEquals(expected.artifacts.map((artifact) => artifact.id), [
    `modelica-admitted-capture-${captureFingerprint.digest}`,
    `modelica-admitted-evidence-${"e".repeat(64)}`,
    `modelica-admitted-result-${"f".repeat(64)}`,
  ]);
  assertEquals(expected.observations.map((observation) => observation.id), [
    "modelica-admitted-position-final-run.admitted",
    "modelica-admitted-position-max_abs-run.admitted",
  ]);
  assertEquals(
    expected.observations.every((observation) =>
      observation.source.capturedAt === CAPTURED_AT
    ),
    true,
  );
  assertEquals(expected.snapshot.requirements, []);
  assertEquals(expected.snapshot.evaluations, []);
  assertEquals(expected.snapshot.violations, []);
  const provenanceIds = expected.snapshot.provenance.map((link) => link.id);
  assertEquals(
    [
      `derived-from-${ADMISSION_ID}-by-modelica-admitted-capture-${captureFingerprint.digest}`,
      `derived-from-${ADMISSION_ID}-by-modelica-admitted-evidence-${"e".repeat(64)}`,
      `derived-from-${ADMISSION_ID}-by-modelica-admitted-result-${"f".repeat(64)}`,
      `uses-consume-${ADMISSION_ID}-by-modelica-admitted-capture-${captureFingerprint.digest}`,
    ].every((id) => provenanceIds.includes(id)),
    true,
  );
  const evidence = threadEvidenceFor(expected);
  assertEquals(evidence.artifacts.capture.id, expected.artifacts[0].id);
  assertThreadEvidenceExact({ ...evidence, fingerprint: captureFingerprint }, expected);
});

Deno.test("documentary successor uses the explicit capturedAt and rejects a second branch", async () => {
  const basis = await basisSnapshot();
  const input = {
    basisSnapshot: basis,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: basis.id,
      revision: basis.revision,
      subjectId: basis.subject.id,
    },
    runId: "run.admitted",
    capturedAt: "2026-08-21T00:00:00.000Z",
    capture: capture(),
    captureFingerprint: {
      algorithm: "sha256" as const,
      digest: "c".repeat(64),
    },
    captureUri: `casys://modelica-admitted-execution/sha256/${"c".repeat(64)}`,
    receipt: receipt(),
  };
  const first = buildDocumentarySuccessor(input);
  assertEquals(
    first.artifacts.every((artifact) =>
      artifact.freshness.changedAt === input.capturedAt
    ),
    true,
  );
  assertThrows(
    () =>
      buildDocumentarySuccessor({
        ...input,
        basisSnapshot: first.snapshot,
        basis: {
          ...input.basis,
          snapshotId: first.snapshot.id,
          revision: first.snapshot.revision,
        },
      }),
    TypeError,
    "documentary branch is already present",
  );
});

Deno.test("exact admission artifact stays compile.seal-admission@3 and rejects producer drift", async () => {
  const basis = await basisSnapshot();
  assertEquals(
    exactAdmissionArtifact(basis, ADMISSION_ID, ADMISSION_FINGERPRINT).producer.tool,
    "compile.seal-admission@3",
  );
  const drifted = {
    ...basis,
    artifacts: basis.artifacts.map((artifact) =>
      artifact.id === ADMISSION_ID
        ? {
          ...artifact,
          producer: {
            ...artifact.producer,
            tool: "simulate.run-qualified-modelica-kit@1",
          },
        }
        : artifact
    ),
  } as ThreadSnapshot;
  assertThrows(
    () => exactAdmissionArtifact(drifted, ADMISSION_ID, ADMISSION_FINGERPRINT),
    TypeError,
    "divergent identity",
  );
});
