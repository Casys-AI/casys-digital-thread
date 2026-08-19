import { assertEquals, assertRejects } from "@std/assert";
import { projectThreadWorkbenchSnapshot } from "../adapters/thread/thread-workbench-projector.ts";
import { materializeAttestedMechanicalRun } from "./attested-mechanical-run-fixture.ts";

Deno.test("attested CAD to FEA evidence becomes a canonical snapshot without an invented verdict", async () => {
  const snapshot = await materializeAttestedMechanicalRun(capture());
  const projection = projectThreadWorkbenchSnapshot(snapshot);

  assertEquals(snapshot.subject.modelArtifactId, snapshot.artifacts[0].id);
  assertEquals(snapshot.consumptions[0].status, "verified");
  assertEquals(snapshot.observations.map((item) => item.quantity.unit), [
    "kg",
    "mm",
    "MPa",
  ]);
  assertEquals(snapshot.requirements, []);
  assertEquals(snapshot.evaluations, []);
  assertEquals(snapshot.violations, []);
  assertEquals(snapshot.proposedActions[0].readiness, "blocked");
  assertEquals(projection.source, "observed");
  assertEquals(projection.change.status, "pending");
  assertEquals(projection.artifacts[1].attestation?.status, "verified");
});

Deno.test("attested mechanical capture rejects a producer and consumer hash mismatch", async () => {
  const value = capture();
  value.fea.inputArtifact.sha256 = "c".repeat(64);
  await assertRejects(
    () => materializeAttestedMechanicalRun(value),
    Error,
    "does not prove one identical STEP fingerprint",
  );
});

Deno.test("attested mechanical capture requires a rejected negative control", async () => {
  const value = capture();
  value.negativeControl.status = "accepted";
  await assertRejects(
    () => materializeAttestedMechanicalRun(value),
    Error,
    "rejected-before-solve",
  );
});

function capture() {
  const sha = "b".repeat(64);
  return {
    schemaVersion: "attested-mechanical-run/1.0",
    capturedAt: "2026-08-01T03:03:48.000Z",
    source: "observed-local-uncommitted",
    subject: "Generic product support bracket",
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
        bytes: 35319,
        sha256: sha,
      },
      metrics: {
        volume_mm3: 21079.9,
        area_mm2: 10074.8,
        density_kg_m3: 2700,
        mass_kg: 0.0569,
      },
    },
    fea: {
      tool: "calculix_solve_static",
      expectedStepSha256: sha,
      inputArtifact: {
        path: "/tmp/input.step",
        sourcePath: "/exports/bracket.step",
        sha256: sha,
        bytes: 35319,
      },
      metrics: {
        maxDisplacement: { value: 0.0428, unit: "mm", nodeId: 26 },
        maxVonMises: { value: 26.29, unit: "MPa", elementId: 5331 },
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
