import { assertEquals, assertRejects } from "@std/assert";
import { EngineeringProjectCommandError } from "../domain/engineering-project-command-service.ts";
import { parseCm01DripTrayMechanicalProof } from "../domain/cm01-drip-tray-mechanical-proof.ts";
import { createThreadSnapshot } from "../domain/thread-snapshot-validation.ts";
import { captureCm01DripTrayMechanical } from "./cm01-drip-tray-mechanical-capture.ts";
import {
  CoffeeMachineCm01V3MechanicalRunExecutor,
  materializeCoffeeMachineCm01V3MechanicalSnapshot,
} from "./coffee-machine-cm01-v3-mechanical-run-executor.ts";
import type { McpToolResult } from "./http-mcp-tool-client.ts";

Deno.test("CM-01 V3 mechanical executor rejects human and foreign project commands before a provider call", async () => {
  const providers = {
    calls: 0,
    callTool() {
      this.calls++;
      return Promise.reject(new Error("must not call"));
    },
  };
  const executor = new CoffeeMachineCm01V3MechanicalRunExecutor({
    projects: {
      get() {
        return Promise.resolve(undefined);
      },
    } as never,
    commands: {} as never,
    snapshots: {} as never,
    proof: proof(),
    build123d: providers,
    calculix: providers,
    attempts: {} as never,
    captures: {} as never,
    lease: {
      async withLease(
        _project: string,
        _run: string,
        callback: () => Promise<unknown>,
      ) {
        return await callback();
      },
    } as never,
  });
  const command = {
    commandId: "command",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: 1,
    issuedAt: "2026-08-03T16:00:00.000Z",
    runId: "run",
  };
  await assertRejects(
    () => executor.execute({ kind: "human", actorId: "human" }, command),
    EngineeringProjectCommandError,
    "Only an authenticated agent",
  );
  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent" }, command),
    EngineeringProjectCommandError,
    "does not exist",
  );
  assertEquals(providers.calls, 0);
});

Deno.test("CM-01 V3 mechanical materialization records only the CalculiX-attested STEP consumption", async () => {
  const capture = await captureCm01DripTrayMechanical(
    new StaticClient(exportResult()),
    new StaticClient(solveResult()),
    proof(),
    () => "2026-08-03T16:00:00.000Z",
  );
  const materialized = await materializeCoffeeMachineCm01V3MechanicalSnapshot(
    baseSnapshot(),
    "run:mechanical",
    capture,
    "casys://test/mechanical-capture",
    proof(),
  );
  const step = materialized.snapshot.artifacts.find((artifact) =>
    artifact.name === "CM-01 V3 isolated DripTray STEP"
  )!;
  assertEquals(step.inputArtifactIds, []);
  assertEquals(
    materialized.snapshot.consumptions.filter((item) =>
      item.consumer.serverId === "build123d"
    ).length,
    0,
  );
  assertEquals(
    materialized.snapshot.consumptions.filter((item) =>
      item.consumer.serverId === "calculix" && item.artifactId === step.id
    ).length,
    1,
  );
});

function baseSnapshot() {
  const at = "2026-08-03T15:00:00.000Z";
  const fingerprint = { algorithm: "sha256" as const, digest: "a".repeat(64) };
  return createThreadSnapshot({
    schemaVersion: "1.0",
    id: "project:coffee-machine-cm01-v3:r1:test-base",
    revision: 1,
    generatedAt: at,
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01 coffee machine",
      kind: "system",
      version: "test",
      modelArtifactId: "test-model",
    },
    freshness: { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: "test-base",
      name: "Test V3 baseline",
      status: "applied" as const,
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: "test-model-created",
        kind: "created" as const,
        target: { kind: "artifact" as const, id: "test-model" },
        summary: "Create test model.",
        afterFingerprint: fingerprint,
      }],
    },
    artifacts: [{
      id: "test-model",
      name: "Test CM-01 model",
      kind: "sysml-model" as const,
      version: "test",
      fingerprint,
      producer: { serverId: "syson", tool: "test", runId: "test" },
      inputArtifactIds: [],
      freshness: {
        status: "fresh" as const,
        changedAt: at,
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "test-model-change",
      relation: "changes" as const,
      from: { kind: "change" as const, id: "test-model-created" },
      to: { kind: "artifact" as const, id: "test-model" },
      rationale: "Test baseline created the model.",
    }],
    proposedActions: [],
  });
}

const STEP_SHA = "ea061880c9efc043fa0ad8475594a12c447481723e4e46dfdd7dc62a8dca3c84";
function exportResult() {
  return {
    text: "",
    structuredContent: {
      schemaVersion: "1.0",
      kind: "export",
      metrics: {},
      files: [{
        format: "step",
        path: "/exports/coffee-machine-cm01-v3-drip-tray.step",
        bytes: 15490,
        sha256: STEP_SHA,
      }],
    },
  };
}
function solveResult() {
  return {
    text: "",
    structuredContent: {
      schemaVersion: "2.0",
      kind: "static-solve",
      inputArtifact: {
        path: "/tmp/input.step",
        sourcePath: "/exports/coffee-machine-cm01-v3-drip-tray.step",
        sha256: STEP_SHA,
        bytes: 15490,
      },
      mesh: {
        nodes: 100,
        elements: 50,
        nodesPerSelection: { PART: 100, FIXED: 10, LOADED: 10 },
      },
      constraints: {
        fixedSelections: ["FIXED"],
        loads: [{ selection: "LOADED", forceN: [0, 0, -100] }],
      },
      metrics: {
        maxDisplacement: { value: 0.1, unit: "mm", nodeId: 1, vectorMm: [0, 0, -0.1] },
        maxVonMises: { value: 0.5, unit: "MPa", elementId: 1 },
      },
    },
  };
}
class StaticClient {
  constructor(private readonly result: McpToolResult) {}
  callTool(): Promise<McpToolResult> {
    return Promise.resolve(structuredClone(this.result));
  }
}

function proof() {
  return parseCm01DripTrayMechanicalProof({
    schemaVersion: "cm01-v3-drip-tray-static-proof/1.0",
    id: "coffee-machine-cm01-v3-drip-tray-static-proof",
    project: {
      id: "coffee-machine-cm01-v3",
      subjectId: "project:coffee-machine-cm01-v3",
    },
    evidenceBoundary: "concept only",
    geometry: { widthMm: 190, depthMm: 135, heightMm: 28 },
    material: { eMpa: 2200, nu: 0.35 },
    meshSizeMm: 5,
    fixed: { name: "FIXED", box: { min: [-96, 66.5, -15], max: [96, 68.5, 15] } },
    loaded: {
      name: "LOADED",
      box: { min: [-96, -68.5, -15], max: [96, -66.5, 15] },
      forceN: [0, 0, -100],
    },
    limits: { maximumDisplacementMm: 1, maximumVonMisesMpa: 20 },
  });
}
