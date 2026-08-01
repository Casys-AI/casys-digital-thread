import { assertEquals, assertThrows } from "@std/assert";
import { materializeAttestedMechanicalRun } from "../adapters/attested-mechanical-run.ts";
import {
  applyThreadSnapshotExtension,
  applyThreadSnapshotExtensionIfNew,
  snapshotEvidenceExtension,
  type ThreadSnapshotExtension,
} from "./thread-snapshot-extension.ts";

Deno.test("ThreadSnapshot extensions advance one immutable revision without owning the root", async () => {
  const base = await materializeAttestedMechanicalRun(capture());
  const extension = thermalExtension(base.subject.id);
  const result = applyThreadSnapshotExtension(base, extension);

  assertEquals(result.revision, 2);
  assertEquals(result.previous, { snapshotId: base.id, revision: 1 });
  assertEquals(result.artifacts.length, base.artifacts.length + 1);
  assertEquals(result.observations.at(-1)?.quantity, { value: 94, unit: "degC" });
  assertEquals(result.requirements, []);
  assertEquals(result.changeSet.changes.length, base.changeSet.changes.length + 1);
  assertEquals(base.revision, 1);
  assertEquals(base.artifacts.length, 2);
});

Deno.test("ThreadSnapshot extensions cannot attach evidence to another subject", async () => {
  const base = await materializeAttestedMechanicalRun(capture());
  assertThrows(
    () => applyThreadSnapshotExtension(base, thermalExtension("another-subject")),
    Error,
    "targets another-subject",
  );
});

Deno.test("a standalone part snapshot can become evidence of an explicitly wider subject", async () => {
  const part = await materializeAttestedMechanicalRun(capture());
  const extension = snapshotEvidenceExtension(part, {
    id: "attach-bracket-evidence",
    name: "Attach the bracket evidence branch",
    subjectId: "coffee-machine-cm01",
  });

  assertEquals(extension.subjectId, "coffee-machine-cm01");
  assertEquals(extension.artifacts.length, 2);
  assertEquals(extension.provenance.some((link) => link.relation === "changes"), false);
  assertEquals(extension.proposedActions[0].readiness, "blocked");
});

Deno.test("attaching historical evidence records the explicit assembly time", async () => {
  const base = await materializeAttestedMechanicalRun(capture());
  const result = applyThreadSnapshotExtension(
    base,
    thermalExtension(base.subject.id),
    { appliedAt: "2026-08-01T06:00:00.000Z" },
  );
  assertEquals(result.generatedAt, "2026-08-01T06:00:00.000Z");
  assertEquals(result.changeSet.appliedAt, "2026-08-01T06:00:00.000Z");
  assertEquals(
    result.observations.at(-1)?.source.capturedAt,
    "2026-08-01T04:00:00.000Z",
  );
});

Deno.test("repeated assembly preserves one immutable head and advances from that head", async () => {
  const base = await materializeAttestedMechanicalRun(capture());
  const first = applyThreadSnapshotExtensionIfNew(
    base,
    thermalExtension(base.subject.id),
  );
  const repeated = applyThreadSnapshotExtensionIfNew(
    first.snapshot,
    thermalExtension(base.subject.id),
  );
  const second = applyThreadSnapshotExtensionIfNew(
    repeated.snapshot,
    pressureExtension(base.subject.id),
  );

  assertEquals(first.applied, true);
  assertEquals(first.snapshot.revision, 2);
  assertEquals(first.snapshot.previous, { snapshotId: base.id, revision: 1 });
  assertEquals(repeated.applied, false);
  assertEquals(repeated.snapshot, first.snapshot);
  assertEquals(second.applied, true);
  assertEquals(second.snapshot.revision, 3);
  assertEquals(second.snapshot.previous, {
    snapshotId: first.snapshot.id,
    revision: first.snapshot.revision,
  });
  assertEquals(second.snapshot.id, `${base.subject.id}:r3:capture-pressure-run`);
});

function thermalExtension(subjectId: string): ThreadSnapshotExtension {
  const at = "2026-08-01T04:00:00.000Z";
  const artifactId = "modelica-evidence-demo";
  const operation = {
    serverId: "modelica",
    tool: "modelica_run_get",
    runId: "observed-run",
  };
  return {
    id: "capture-modelica-run",
    name: "Capture persisted Modelica evidence",
    subjectId,
    capturedAt: at,
    artifacts: [{
      id: artifactId,
      name: "Persisted Modelica result",
      kind: "evidence",
      version: "a".repeat(12),
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      producer: operation,
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [{
      id: "obs-water-temperature",
      name: "Water temperature",
      metric: "water_temperature_max",
      quantity: { value: 94, unit: "degC" },
      source: { operation, artifactIds: [artifactId], capturedAt: at },
      freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    }],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "modelica-temperature-from-run",
      relation: "derived_from",
      from: { kind: "observation", id: "obs-water-temperature" },
      to: { kind: "artifact", id: artifactId },
      rationale: "The value was read from the persisted run artifact.",
    }],
    proposedActions: [],
  };
}

function pressureExtension(subjectId: string): ThreadSnapshotExtension {
  const extension = thermalExtension(subjectId);
  return {
    ...extension,
    id: "capture-pressure-run",
    name: "Capture persisted pressure evidence",
    artifacts: extension.artifacts.map((artifact) => ({
      ...artifact,
      id: "pressure-evidence-demo",
      name: "Persisted pressure result",
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
      version: "c".repeat(12),
    })),
    observations: extension.observations.map((observation) => ({
      ...observation,
      id: "obs-pressure",
      name: "Pump pressure",
      metric: "pump_pressure_max",
      source: { ...observation.source, artifactIds: ["pressure-evidence-demo"] },
    })),
    provenance: extension.provenance.map((link) => ({
      ...link,
      id: "pressure-from-run",
      from: { kind: "observation" as const, id: "obs-pressure" },
      to: { kind: "artifact" as const, id: "pressure-evidence-demo" },
    })),
  };
}

function capture() {
  const sha = "b".repeat(64);
  return {
    schemaVersion: "attested-mechanical-run/1.0",
    capturedAt: "2026-08-01T03:03:48.000Z",
    source: "observed-local-uncommitted",
    subject: "CoffeeMachine support bracket",
    providers: {
      build123d: {
        endpoint: "http://127.0.0.1:3014/mcp",
        sourceRevision: "e".repeat(40),
        dirty: true,
        containerId: "build-container",
      },
      calculix: {
        endpoint: "http://127.0.0.1:3015/mcp",
        sourceRevision: "f".repeat(40),
        dirty: true,
        containerId: "fea-container",
      },
    },
    cad: {
      tool: "build123d_export",
      artifact: {
        format: "step",
        path: "/exports/bracket.step",
        bytes: 1,
        sha256: sha,
      },
      metrics: {
        volume_mm3: 1,
        area_mm2: 1,
        density_kg_m3: 2700,
        mass_kg: 0.05,
      },
    },
    fea: {
      tool: "calculix_solve_static",
      expectedStepSha256: sha,
      inputArtifact: {
        path: "/tmp/input.step",
        sourcePath: "/exports/bracket.step",
        sha256: sha,
        bytes: 1,
      },
      metrics: {
        maxDisplacement: { value: 0.04, unit: "mm", nodeId: 1 },
        maxVonMises: { value: 26.29, unit: "MPa", elementId: 1 },
      },
    },
    artifactAttestation: {
      status: "verified",
      producerSha256: sha,
      consumerSha256: sha,
      equal: true,
    },
    negativeControl: {
      expectedSha256: "0".repeat(64),
      status: "rejected-before-solve",
      message: "STEP SHA-256 mismatch",
    },
    limitations: ["No model-owned mechanical criterion."],
  };
}
