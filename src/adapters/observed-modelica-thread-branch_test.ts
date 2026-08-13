import { assertEquals, assertThrows } from "@std/assert";
import type { RunDetail } from "../contracts/console.ts";
import type { ThreadSnapshot } from "../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtension } from "../domain/thread/thread-snapshot-extension.ts";
import {
  createObservedModelicaRunExtension,
  parsePersistedModelicaRunEvidence,
} from "./observed-modelica-thread-branch.ts";

Deno.test("Modelica extension attaches persisted thermal evidence without a verdict", () => {
  const base = baseSnapshot();
  const extension = createObservedModelicaRunExtension(base.subject.id, persistedRun());
  const snapshot = applyThreadSnapshotExtension(base, extension);

  assertEquals(
    snapshot.id,
    "coffee-machine-support-bracket:r2:modelica-run-run-thermal-1-model-scenario-bound",
  );
  assertEquals(snapshot.revision, 2);
  assertEquals(snapshot.previous, { snapshotId: "base-mechanical", revision: 1 });
  assertEquals(snapshot.requirements, []);
  assertEquals(snapshot.evaluations, []);
  assertEquals(snapshot.violations, []);
  assertEquals(snapshot.artifacts.length, 5);
  assertEquals(snapshot.changeSet.changes.length, 5);
  assertEquals(snapshot.observations.map((item) => item.metric), [
    "support_mass",
    "water_temperature_max",
    "heater_energy",
  ]);

  const model = snapshot.artifacts.find((item) => item.kind === "simulation-model");
  const result = snapshot.artifacts.find((item) => item.kind === "solver-result");
  const scenario = snapshot.artifacts.find((item) => item.id.includes("-scenario-"));
  const evidence = snapshot.artifacts.find((item) => item.id.includes("-evidence-"));
  if (!model || !result || !scenario || !evidence) {
    throw new Error("Expected the complete Modelica artifact fixture.");
  }
  assertEquals(result.inputArtifactIds, [model.id, scenario.id]);
  assertEquals(result.inputArtifactIds.includes("support-step"), false);
  assertEquals(extension.name, "Attach persisted mcp-modelica run thermal evidence");
  assertEquals(extension.modelica, {
    runId: "run_thermal_1",
    fingerprint: {
      algorithm: "sha256",
      digest: "3fcb376a95425251db53d0cdf59c01a5021a857a0cf475f54280344325ea4d4c",
    },
    model: {
      id: "coffee-machine-v1",
      version: "0.1.0",
      fingerprint: {
        algorithm: "sha256",
        digest: "a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec",
      },
    },
    scenario: {
      id: "heat-up-nominal",
      fingerprint: {
        algorithm: "sha256",
        digest: "5db8a06592050a03a8d727900801f9185b2e7fa2fb3092ce15dd3c6c70eb0941",
      },
    },
  });
  assertEquals(snapshot.consumptions.find((item) => item.artifactId === model.id), {
    id: "consume-modelica-run-thermal-1-model-a641b63a4934-by-run-thermal-1",
    artifactId: model.id,
    consumer: {
      serverId: "modelica",
      tool: "modelica_simulate",
      runId: "run_thermal_1",
    },
    observedFingerprint: {
      algorithm: "sha256",
      digest: "a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec",
    },
    verifiedAt: "2026-08-01T02:35:57.597Z",
    status: "verified",
  });
  assertEquals(snapshot.consumptions.find((item) => item.artifactId === scenario.id), {
    id: "consume-modelica-run-thermal-1-scenario-5db8a0659205-by-run-thermal-1",
    artifactId: scenario.id,
    consumer: {
      serverId: "modelica",
      tool: "modelica_simulate",
      runId: "run_thermal_1",
    },
    observedFingerprint: {
      algorithm: "sha256",
      digest: "5db8a06592050a03a8d727900801f9185b2e7fa2fb3092ce15dd3c6c70eb0941",
    },
    verifiedAt: "2026-08-01T02:35:57.597Z",
    status: "verified",
  });
  assertEquals(
    snapshot.provenance.some((link) =>
      link.relation === "derived_from" && link.from.kind === "observation" &&
      link.to.id === evidence.id
    ),
    true,
  );
  assertEquals(
    snapshot.provenance.some((link) =>
      link.relation === "derived_from" && link.from.kind === "artifact" &&
      link.from.id === result.id && link.to.id === model.id
    ),
    true,
  );
  assertEquals(
    snapshot.provenance.some((link) =>
      link.relation === "derived_from" && link.from.id === result.id &&
      link.to.id === "support-step"
    ),
    false,
  );
});

Deno.test("parsePersistedModelicaRunEvidence rejects a scenario verdict overlay", () => {
  const run = persistedRun();
  run.verdictStatus = "passed";
  run.requirements = [{
    id: "not-a-product-requirement",
    title: "fixture",
    status: "pass",
  }];

  assertThrows(
    () => parsePersistedModelicaRunEvidence(run),
    Error,
    "must not contain an attached requirement verdict",
  );
});

Deno.test("parsePersistedModelicaRunEvidence rejects evidence from a different model", () => {
  const run = persistedRun();
  run.evidence[0].sha256 = "f".repeat(64);

  assertThrows(
    () => parsePersistedModelicaRunEvidence(run),
    Error,
    "does not match the run model SHA-256",
  );
});

function baseSnapshot(): ThreadSnapshot {
  const freshness = {
    status: "fresh" as const,
    changedAt: "2026-08-01T03:03:48.000Z",
    invalidatedByChangeIds: [],
  };
  return {
    schemaVersion: "1.0",
    id: "base-mechanical",
    revision: 1,
    generatedAt: "2026-08-01T03:03:48.000Z",
    subject: {
      id: "coffee-machine-support-bracket",
      name: "CoffeeMachine support bracket",
      kind: "part",
      version: "b29f52b39a39",
      modelArtifactId: "support-step",
    },
    freshness,
    changeSet: {
      id: "capture-mechanical",
      name: "Capture mechanical evidence",
      status: "applied",
      createdAt: "2026-08-01T03:03:48.000Z",
      appliedAt: "2026-08-01T03:03:48.000Z",
      changes: [{
        id: "capture-step",
        kind: "created",
        target: { kind: "artifact", id: "support-step" },
        summary: "Captured the STEP export.",
        afterFingerprint: {
          algorithm: "sha256",
          digest: "b29f52b39a390405d271ca4eceb3f0cdfd675cabe944d4babb8dd21f0010e3fd",
        },
      }],
    },
    artifacts: [{
      id: "support-step",
      name: "Support bracket STEP",
      kind: "step",
      version: "b29f52b39a39",
      fingerprint: {
        algorithm: "sha256",
        digest: "b29f52b39a390405d271ca4eceb3f0cdfd675cabe944d4babb8dd21f0010e3fd",
      },
      producer: { serverId: "build123d", tool: "build123d_export", runId: "run-cad" },
      inputArtifactIds: [],
      freshness,
    }],
    consumptions: [],
    observations: [{
      id: "support-mass",
      name: "Support mass",
      metric: "support_mass",
      quantity: { value: 0.0569, unit: "kg" },
      source: {
        operation: {
          serverId: "build123d",
          tool: "build123d_export",
          runId: "run-cad",
        },
        artifactIds: ["support-step"],
        capturedAt: "2026-08-01T03:03:48.000Z",
      },
      freshness,
    }],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: "capture-step-link",
        relation: "changes",
        from: { kind: "change", id: "capture-step" },
        to: { kind: "artifact", id: "support-step" },
        rationale: "The capture created this artifact.",
      },
      {
        id: "mass-step-link",
        relation: "derived_from",
        from: { kind: "observation", id: "support-mass" },
        to: { kind: "artifact", id: "support-step" },
        rationale: "Mass was read from the export evidence.",
      },
    ],
    proposedActions: [],
  };
}

function persistedRun(): RunDetail {
  return {
    id: "modelica:run_thermal_1",
    name: "coffee-machine-v1 / heat-up-nominal",
    subject: "Modelica 0.1.0",
    source: "observed",
    status: "succeeded",
    verdictStatus: "not_evaluated",
    startedAt: "2026-08-01T02:35:55.149Z",
    completedAt: "2026-08-01T02:35:57.597Z",
    passedRequirements: 0,
    failedRequirements: 0,
    unresolvedRequirements: 0,
    description: "Persisted Modelica evidence.",
    stages: [],
    measurements: [
      {
        id: "water_temperature_max",
        label: "Maximum water temperature",
        value: { value: 94.00000007343664, unit: "degC", display: "94 degC" },
      },
      {
        id: "heater_energy",
        label: "Heater energy",
        value: { value: 493914.2758438271, unit: "J", display: "493914 J" },
      },
    ],
    provenance: [],
    warnings: [],
    requirements: [],
    evidence: [
      {
        id: "model",
        kind: "model",
        label: "CoffeeMachine Modelica model",
        path: "casys://modelica/runs/run_thermal_1/CoffeeMachine.mo",
        sha256: "a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec",
        bytes: 2572,
      },
      {
        id: "result",
        kind: "result",
        label: "Simulation result",
        path: "casys://modelica/runs/run_thermal_1/result.csv",
        sha256: "4195b85b47fa1b03bf0a7cb004a2e8669bce34ae94bb68fb627b186103afbc8f",
        bytes: 351007,
      },
      {
        id: "evidence",
        kind: "evidence",
        label: "Computed evidence",
        path: "casys://modelica/runs/run_thermal_1/evidence.json",
        sha256: "c08d71e1f362bc17c4b29758166173abc34f0a424c3a9c8987e855eef53d2559",
        bytes: 827,
      },
    ],
    modelicaEvidence: {
      runId: "run_thermal_1",
      fingerprint: "3fcb376a95425251db53d0cdf59c01a5021a857a0cf475f54280344325ea4d4c",
      model: {
        id: "coffee-machine-v1",
        version: "0.1.0",
        sha256: "a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec",
      },
      scenario: {
        id: "heat-up-nominal",
        sha256: "5db8a06592050a03a8d727900801f9185b2e7fa2fb3092ce15dd3c6c70eb0941",
      },
    },
  };
}
