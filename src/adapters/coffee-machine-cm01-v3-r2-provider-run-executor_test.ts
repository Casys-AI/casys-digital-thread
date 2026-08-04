// deno-lint-ignore-file no-explicit-any require-await
import { assertEquals, assertRejects } from "@std/assert";
import { EngineeringProjectCommandError } from "../domain/engineering-project-command-service.ts";
import {
  CoffeeMachineCm01V3CadR2RunExecutor,
  CoffeeMachineCm01V3MechanicalR2RunExecutor,
  CoffeeMachineCm01V3MechanicalR3RunExecutor,
} from "./coffee-machine-cm01-v3-r2-provider-run-executor.ts";
import { captureCm01DripTrayMechanicalR3 } from "./cm01-drip-tray-mechanical-capture-r3.ts";
import {
  CoffeeMachineCm01V3MechanicalR2SuccessorMaterializer,
} from "./coffee-machine-cm01-v3-r2-successor-materializer.ts";
import { CoffeeMachineCm01V3MechanicalR3SuccessorMaterializer } from "./coffee-machine-cm01-v3-r3-successor-materializer.ts";
import { Cm01DripTrayMechanicalR3CaptureRecovery } from "./cm01-drip-tray-mechanical-r3-capture-recovery.ts";
import {
  CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutor,
} from "./coffee-machine-cm01-v3-r3-identity-recovery-run-executor.ts";
import {
  applyCm01DripTrayHeight28To30Correction,
  deriveCm01DripTrayHeight30Proof,
  deriveCm01DripTrayHeight30Recipe,
} from "../domain/cm01-drip-tray-height-correction.ts";
import { parseCm01DripTrayMechanicalProof } from "../domain/cm01-drip-tray-mechanical-proof.ts";
import { parseCm01DripTrayMechanicalProofR3 } from "../domain/cm01-drip-tray-mechanical-proof.ts";
import { parseCoffeeMachineCm01SemanticRecipe } from "../domain/coffee-machine-cm01-semantic-recipe.ts";
import { createThreadSnapshot } from "../domain/thread-snapshot-validation.ts";
import RECIPE from "../../config/product-recipes/coffee-machine-cm01-v1.json" with {
  type: "json",
};
import PROOF from "../../config/mechanical-proof-cases/coffee-machine-cm01-v3-drip-tray-static.json" with {
  type: "json",
};
import R3_PROOF from "../../config/mechanical-proof-cases/coffee-machine-cm01-v3-drip-tray-height-30-static-r3.json" with {
  type: "json",
};

const command = {
  commandId: "run-cm01-r2",
  projectId: "coffee-machine-cm01-v3",
  expectedRevision: 1,
  issuedAt: "2026-08-03T18:00:00.000Z",
  runId: "run:cm01-r2",
};
const ARCHITECTURE_ID = `coffee-machine-cm01-v3-architecture-${"a".repeat(64)}`;

Deno.test("CM-01 R2 provider executors reject a non-agent or unavailable project before any provider call", async () => {
  const providers = new CountingProvider();
  const base = {
    projects: { get: () => Promise.resolve(undefined) } as never,
    commands: {} as never,
    snapshots: {} as never,
    attempts: {} as never,
    captures: {} as never,
    lease: {
      withLease: async (_p: string, _r: string, callback: () => Promise<unknown>) =>
        await callback(),
    } as never,
  };
  const cad = new CoffeeMachineCm01V3CadR2RunExecutor({
    ...base,
    recipe: recipe(),
    build123d: providers,
  });
  const mechanical = new CoffeeMachineCm01V3MechanicalR2RunExecutor({
    ...base,
    proof: proof(),
    build123d: providers,
    calculix: providers,
  });
  await assertRejects(
    () => cad.execute({ kind: "human", actorId: "human:reviewer" }, command),
    EngineeringProjectCommandError,
    "Only an authenticated agent",
  );
  await assertRejects(
    () => mechanical.execute({ kind: "agent", actorId: "agent:engineering" }, command),
    EngineeringProjectCommandError,
    "does not exist",
  );
  assertEquals(providers.calls, 0);
});

Deno.test("CM-01 R2 CAD executor calls the fixed provider once and publishes one successor", async () => {
  const fixture = await cadFixture();
  const provider = new CadProvider();
  const executor = new CoffeeMachineCm01V3CadR2RunExecutor({
    projects: fixture.projects as never,
    commands: fixture.commands as never,
    snapshots: fixture.snapshots as never,
    attempts: fixture.attempts,
    captures: fixture.captures,
    lease: fixture.lease as never,
    recipe: recipe(),
    build123d: provider,
    now: () => "2026-08-03T19:00:00.000Z",
  });
  const completed = await executor.execute(
    { kind: "agent", actorId: "agent:engineering" },
    command,
  );
  assertEquals(provider.calls, 1);
  assertEquals(completed.agentRuns[0]!.status, "completed");
  const result = completed.agentRuns[0]!.resultSnapshot!;
  const snapshot = await fixture.snapshots.get(result.snapshotId);
  assertEquals(snapshot?.revision, 3);
  assertEquals(
    snapshot?.artifacts.some((item) =>
      item.name === "CM-01 30 mm DripTray assembly STEP export"
    ),
    true,
  );
  assertEquals(fixture.attempts.completes, 1);
});

Deno.test("CM-01 R3 recovery executor only publishes a fresh isolated solve successor", async () => {
  const fixture = await mechanicalR3Fixture();
  const provider = new MechanicalProvider();
  const executor = new CoffeeMachineCm01V3MechanicalR3RunExecutor({
    projects: fixture.projects as never,
    commands: fixture.commands as never,
    snapshots: fixture.snapshots as never,
    attempts: fixture.attempts,
    captures: fixture.captures,
    lease: fixture.lease as never,
    proof: proofR3(),
    build123d: provider,
    calculix: provider,
    now: () => "2026-08-03T19:00:00.000Z",
  });
  const completed = await executor.execute(
    { kind: "agent", actorId: "agent:engineering" },
    { ...command, commandId: "run-cm01-r3", runId: "run:cm01-r3" },
  );
  assertEquals(provider.calls, 2);
  assertEquals(completed.agentRuns[0]?.status, "completed");
  const result = completed.agentRuns[0]?.resultSnapshot!;
  const snapshot = await fixture.snapshots.get(result.snapshotId);
  assertEquals(snapshot?.revision, 4);
  assertEquals(
    snapshot?.consumptions.some((item) =>
      item.consumer.tool === "calculix_solve_static" &&
      snapshot.artifacts.find((artifact) => artifact.id === item.artifactId)?.name ===
        "CM-01 R3 30 mm isolated DripTray STEP"
    ),
    true,
  );
  assertEquals(
    snapshot?.consumptions.some((item) =>
      item.consumer.tool === "calculix_solve_static" &&
      snapshot.artifacts.find((artifact) => artifact.id === item.artifactId)?.name ===
        "CM-01 30 mm DripTray assembly STEP export"
    ),
    false,
  );
  assertEquals(result.snapshotId.includes("mechanical-r3-"), true);
  assertEquals(result.snapshotId.includes("mechanical-r2-"), false);
  const r3Artifacts = snapshot!.artifacts.filter((item) =>
    item.id.startsWith("coffee-machine-cm01-v3-mechanical-r3-")
  );
  assertEquals(r3Artifacts.length, 3);
  assertEquals(r3Artifacts.every((item) => !item.id.includes("mechanical-r2")), true);
  const r3Requirements = snapshot!.requirements.filter((item) =>
    item.id.startsWith("coffee-machine-cm01-v3-mechanical-r3-")
  );
  assertEquals(r3Requirements.map((item) => item.version), [
    "cm01-v3-r3",
    "cm01-v3-r3",
  ]);
  assertEquals(
    snapshot!.evaluations
      .filter((item) => item.id.startsWith("coffee-machine-cm01-v3-mechanical-r3-"))
      .every((item) => item.evaluator.tool === "evaluate_cm01_drip_tray_limits_r3"),
    true,
  );
});

Deno.test("CM-01 R3 identity recovery creates a deterministic R3 successor without rewriting historical R10", async () => {
  const fixture = await mechanicalR3Fixture();
  const basis = fixture.getProject().agentRuns[0]!.basis!;
  const r9 = await fixture.snapshots.get(basis.snapshotId);
  if (!r9) throw new Error("fixture lacks R9 basis");
  const providers = new MechanicalProvider();
  const capture = await captureCm01DripTrayMechanicalR3(
    providers,
    providers,
    proofR3(),
    () => "2026-08-03T19:00:00.000Z",
  );
  const historical = await new CoffeeMachineCm01V3MechanicalR2SuccessorMaterializer()
    .materialize(
      r9,
      "run:historical-r3-wrongly-materialized",
      capture as never,
      `casys://test/${capture.fingerprint.digest}`,
      proofR3() as never,
    );
  const recovery = new CoffeeMachineCm01V3MechanicalR3SuccessorMaterializer();
  const first = await recovery.materializeIdentityRecovery(
    historical.snapshot,
    "run:cm01-r3-identity-recovery",
    "run:historical-r3-wrongly-materialized",
    capture,
    `casys://test/${capture.fingerprint.digest}`,
    proofR3(),
  );
  const replay = await recovery.materializeIdentityRecovery(
    historical.snapshot,
    "run:cm01-r3-identity-recovery",
    "run:historical-r3-wrongly-materialized",
    capture,
    `casys://test/${capture.fingerprint.digest}`,
    proofR3(),
  );
  assertEquals(historical.snapshot.revision, 4);
  assertEquals(historical.snapshot.id.includes("mechanical-r2-"), true);
  assertEquals(first.snapshot.revision, 5);
  assertEquals(first.snapshot.previous, {
    snapshotId: historical.snapshot.id,
    revision: historical.snapshot.revision,
  });
  assertEquals(first.snapshot.id.includes("mechanical-r3-"), true);
  assertEquals(first.snapshot.id.includes("mechanical-r2-"), false);
  assertEquals(first.snapshot, replay.snapshot);
  const r3Prefix = `coffee-machine-cm01-v3-mechanical-r3-${capture.fingerprint.digest}`;
  const r2Prefix = `coffee-machine-cm01-v3-mechanical-r2-${capture.fingerprint.digest}`;
  assertEquals(
    first.snapshot.provenance.some((link) =>
      link.relation === "supersedes" &&
      link.from.id === `${r3Prefix}-solve` && link.to.id === `${r2Prefix}-solve`
    ),
    true,
  );
  assertEquals(
    first.snapshot.artifacts.filter((item) => item.id.startsWith(r3Prefix)).length,
    3,
  );
  assertEquals(
    first.snapshot.requirements
      .filter((item) => item.id.startsWith(r3Prefix))
      .every((item) => item.version === "cm01-v3-r3"),
    true,
  );
  assertEquals(providers.calls, 2);
});

Deno.test("CM-01 R3 identity-recovery executor reads the completed capture and never calls providers", async () => {
  const fixture = await mechanicalR3Fixture();
  const r9Reference = fixture.getProject().agentRuns[0]!.basis!;
  const r9 = await fixture.snapshots.get(r9Reference.snapshotId);
  if (!r9) throw new Error("fixture lacks R9 basis");
  const providers = new MechanicalProvider();
  const capture = await captureCm01DripTrayMechanicalR3(
    providers,
    providers,
    proofR3(),
    () => "2026-08-03T19:00:00.000Z",
  );
  const historicalMaterialization =
    await new CoffeeMachineCm01V3MechanicalR2SuccessorMaterializer()
      .materialize(
        r9,
        "run:cm01-r3-historical",
        capture as never,
        `casys://test/${capture.fingerprint.digest}`,
        proofR3() as never,
      );
  const r10 = createThreadSnapshot({
    ...historicalMaterialization.snapshot,
    id:
      `project:coffee-machine-cm01-v3:r10:coffee-machine-cm01-v3-mechanical-r2-${capture.fingerprint.digest}-extension`,
    revision: 10,
    previous: {
      snapshotId: "project:coffee-machine-cm01-v3:r9:fixture",
      revision: 9,
    },
  });
  await fixture.snapshots.save(r10);
  const historicalEvidenceId =
    `coffee-machine-cm01-v3-mechanical-r2-${capture.fingerprint.digest}-solve`;
  const recoveryRun = {
    id: "run:cm01-r3-identity-recovery",
    workItemId: "mechanical-r3-identity-recovery",
    status: "queued",
    summary: "recover identity",
    queuedAt: "2026-08-03T20:00:00.000Z",
    evidenceRefs: [],
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: r10.id,
      revision: r10.revision,
      subjectId: r10.subject.id,
    },
  };
  const originalR3Run = {
    id: "run:cm01-r3-historical",
    workItemId: "mechanical-r3-original",
    status: "completed",
    summary: "historical R3",
    queuedAt: "2026-08-03T19:00:00.000Z",
    startedAt: "2026-08-03T19:00:01.000Z",
    completedAt: "2026-08-03T19:00:02.000Z",
    evidenceRefs: [{
      snapshotId: r10.id,
      snapshotRevision: r10.revision,
      kind: "artifact" as const,
      id: historicalEvidenceId,
    }],
    resultSnapshot: {
      snapshotId: r10.id,
      revision: r10.revision,
      subjectId: r10.subject.id,
    },
    basis: r9Reference,
  };
  fixture.setProject({
    ...fixture.getProject(),
    revision: 20,
    workItems: [
      {
        id: "mechanical-r3-identity-recovery",
        operation: {
          id: "repair.coffee-machine-cm01-drip-tray-mechanical-r3-identity",
          version: "1",
          bindings: [
            { name: "approvedBrief", source: { kind: "approved-brief" } },
            {
              name: "historicalMechanicalR3Result",
              source: {
                kind: "thread-entity",
                reference: {
                  snapshotId: r10.id,
                  snapshotRevision: r10.revision,
                  kind: "artifact",
                  id: historicalEvidenceId,
                },
              },
            },
          ],
        },
      },
      {
        id: "mechanical-r3-original",
        operation: {
          id: "verify.coffee-machine-cm01-drip-tray-mechanical",
          version: "3",
          bindings: [],
        },
      },
    ],
    agentRuns: [recoveryRun, originalR3Run],
    commandReceipts: [],
  });
  assertEquals(
    fixture.getProject().agentRuns[1]!.resultSnapshot,
    {
      snapshotId: r10.id,
      revision: r10.revision,
      subjectId: r10.subject.id,
    },
  );
  assertEquals(
    fixture.getProject().workItems[1]!.operation,
    {
      id: "verify.coffee-machine-cm01-drip-tray-mechanical",
      version: "3",
      bindings: [],
    },
  );
  assertEquals(
    fixture.getProject().agentRuns.filter((candidate: any) => {
      const workItem = fixture.getProject().workItems.find((item: any) =>
        item.id === candidate.workItemId
      );
      return candidate.status === "completed" &&
        workItem?.operation?.id === "verify.coffee-machine-cm01-drip-tray-mechanical" &&
        workItem.operation.version === "3" &&
        candidate.resultSnapshot?.snapshotId === r10.id &&
        candidate.resultSnapshot?.revision === r10.revision;
    }).length,
    1,
  );
  const source = new Cm01DripTrayMechanicalR3CaptureRecovery(
    {
      completedCapture: async () => ({ algorithm: "sha256", digest: "a".repeat(64) }),
    },
    {
      uriFor: () => "casys://test/r3-completed-capture",
      read: async () => JSON.stringify(capture),
    },
  );
  const executor = new CoffeeMachineCm01V3MechanicalR3IdentityRecoveryRunExecutor({
    projects: fixture.projects as never,
    commands: fixture.commands as never,
    snapshots: fixture.snapshots as never,
    capture: source,
    proof: proofR3(),
    lease: fixture.lease as never,
  });
  const providerCallsBeforeRecovery = providers.calls;
  const command = {
    commandId: "recover-cm01-r3-identity",
    projectId: "coffee-machine-cm01-v3",
    expectedRevision: 20,
    issuedAt: "2026-08-03T20:00:00.000Z",
    runId: recoveryRun.id,
  };
  const completed = await executor.execute(
    { kind: "agent", actorId: "agent:engineering" },
    command,
  );
  const result = completed.agentRuns[0]!.resultSnapshot!;
  const r11 = await fixture.snapshots.get(result.snapshotId);
  assertEquals(providers.calls, providerCallsBeforeRecovery);
  assertEquals(result.revision, 11);
  assertEquals(result.snapshotId.includes("mechanical-r3-"), true);
  assertEquals(result.snapshotId.includes("mechanical-r2-"), false);
  assertEquals(r11?.previous, { snapshotId: r10.id, revision: 10 });
  assertEquals((await fixture.snapshots.get(r10.id))?.id, r10.id);
  const replay = await executor.execute(
    { kind: "agent", actorId: "agent:engineering" },
    command,
  );
  assertEquals(replay.agentRuns[0]!.resultSnapshot, result);
  assertEquals(providers.calls, providerCallsBeforeRecovery);
});

Deno.test("CM-01 R3 recovery executor rejects a non-agent before its providers", async () => {
  const providers = new CountingProvider();
  const executor = new CoffeeMachineCm01V3MechanicalR3RunExecutor({
    projects: { get: () => Promise.resolve(undefined) } as never,
    commands: {} as never,
    snapshots: {} as never,
    attempts: {} as never,
    captures: {} as never,
    lease: {
      withLease: async (_p: string, _r: string, callback: () => Promise<unknown>) =>
        await callback(),
    } as never,
    proof: proofR3(),
    build123d: providers,
    calculix: providers,
  });
  await assertRejects(
    () => executor.execute({ kind: "human", actorId: "human:reviewer" }, command),
    EngineeringProjectCommandError,
    "Only an authenticated agent",
  );
  assertEquals(providers.calls, 0);
});

class CountingProvider {
  calls = 0;
  callTool(): Promise<never> {
    this.calls += 1;
    return Promise.reject(new Error("provider must not be reached"));
  }
}

class CadProvider {
  calls = 0;
  callTool() {
    this.calls += 1;
    return Promise.resolve({
      text: "",
      structuredContent: {
        schemaVersion: "1.0",
        kind: "export",
        metrics: {},
        files: [
          {
            format: "step",
            path: "/tmp/coffee-machine-cm01-v3-r2.step",
            bytes: 101,
            sha256: "1".repeat(64),
          },
          {
            format: "gltf",
            path: "/tmp/coffee-machine-cm01-v3-r2.glb",
            bytes: 102,
            sha256: "2".repeat(64),
            viewer: { kind: "gltf" },
          },
          {
            format: "stl",
            path: "/tmp/coffee-machine-cm01-v3-r2.stl",
            bytes: 103,
            sha256: "3".repeat(64),
          },
        ],
      },
    });
  }
}

class MechanicalProvider {
  calls = 0;
  callTool(call: { name: string }) {
    this.calls += 1;
    if (call.name === "build123d_export") {
      return Promise.resolve({
        text: "",
        structuredContent: {
          schemaVersion: "1.0",
          kind: "export",
          metrics: {},
          files: [{
            format: "step",
            path: "/exports/coffee-machine-cm01-v3-drip-tray-height-30.step",
            bytes: 15490,
            sha256: "4".repeat(64),
          }],
        },
      });
    }
    return Promise.resolve({
      text: "",
      structuredContent: {
        schemaVersion: "2.0",
        kind: "static-solve",
        inputArtifact: {
          path: "/tmp/input.step",
          sourcePath: "/exports/coffee-machine-cm01-v3-drip-tray-height-30.step",
          bytes: 15490,
          sha256: "4".repeat(64),
        },
        mesh: {
          nodes: 50,
          elements: 20,
          nodesPerSelection: { FIXED: 10, LOADED: 10, PART: 50 },
        },
        constraints: {
          fixedSelections: ["FIXED"],
          loads: [{ selection: "LOADED", forceN: [0, 0, -100] }],
        },
        metrics: {
          maxDisplacement: {
            value: 0.1,
            unit: "mm",
            nodeId: 1,
            vectorMm: [0, 0, -0.1],
          },
          maxVonMises: { value: 0.5, unit: "MPa", elementId: 1 },
        },
      },
    });
  }
}

async function cadFixture() {
  const at = "2026-08-03T17:00:00.000Z";
  const base = createThreadSnapshot({
    schemaVersion: "1.0",
    id: "project:coffee-machine-cm01-v3:r1:base",
    revision: 1,
    generatedAt: at,
    subject: {
      id: "project:coffee-machine-cm01-v3",
      name: "CM-01",
      kind: "system",
      version: "1",
      modelArtifactId: ARCHITECTURE_ID,
    },
    freshness: fresh(at),
    changeSet: {
      id: "base",
      name: "base",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [],
    },
    artifacts: [
      artifact(
        ARCHITECTURE_ID,
        "CM-01 architecture",
        "sysml-model",
        "syson",
        "syson_element_insert_sysml",
        [],
      ),
      artifact(
        "old-plan",
        "CM-01 semantic CAD plan",
        "document",
        "digital-thread",
        "compile_coffee_machine_cm01_semantic_cad_plan",
        [ARCHITECTURE_ID],
      ),
      artifact(
        "old-script",
        "CM-01 deterministic build123d script",
        "script",
        "digital-thread",
        "compile_coffee_machine_cm01_semantic_cad_plan",
        ["old-plan"],
      ),
      artifact(
        "old-assembly",
        "CM-01 STEP export",
        "step",
        "build123d",
        "build123d_export",
        ["old-script"],
      ),
      artifact(
        "old-proof",
        "CM-01 V3 reviewed DripTray proof case",
        "document",
        "digital-thread",
        "evaluate_cm01_drip_tray_limits",
        [],
      ),
      artifact(
        "old-isolated",
        "CM-01 V3 isolated DripTray STEP",
        "step",
        "build123d",
        "build123d_export",
        ["old-proof"],
      ),
      artifact(
        "old-solve",
        "CM-01 V3 CalculiX static result",
        "solver-result",
        "calculix",
        "calculix_solve_static",
        ["old-isolated"],
      ),
      artifact(
        "thermal",
        "thermal",
        "solver-result",
        "modelica",
        "modelica_simulate",
        [],
      ),
      artifact("bom", "bom", "bom", "erpnext", "erpnext_bom_get", []),
    ],
    consumptions: baseConsumptions(),
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: baseProvenance(),
    proposedActions: [],
  });
  const corrected = (await applyCm01DripTrayHeight28To30Correction(base, {
    appliedAt: "2026-08-03T18:00:00.000Z",
  })).snapshot;
  let project: any = {
    schemaVersion: "3.0",
    id: "project-state",
    revision: 1,
    generatedAt: at,
    project: {
      id: "coffee-machine-cm01-v3",
      subjectId: "project:coffee-machine-cm01-v3",
      name: "CM-01",
    },
    workItems: [{
      id: "cad-r2",
      operation: {
        id: "design.build-coffee-machine-cm01-cad",
        version: "2",
        bindings: [
          { name: "approvedBrief", source: { kind: "approved-brief" } },
          {
            name: "dripTrayHeightCorrection",
            source: {
              kind: "thread-entity",
              reference: {
                snapshotId: corrected.id,
                snapshotRevision: corrected.revision,
                kind: "artifact",
                id: "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record",
              },
            },
          },
        ],
      },
    }],
    agentRuns: [{
      id: command.runId,
      workItemId: "cad-r2",
      status: "queued",
      summary: "r2",
      queuedAt: at,
      basis: {
        kind: "thread-snapshot",
        snapshotId: corrected.id,
        revision: corrected.revision,
        subjectId: corrected.subject.id,
      },
      evidenceRefs: [],
    }],
    commandReceipts: [],
  };
  const snapshotsById = new Map([[corrected.id, corrected]]);
  const snapshots = {
    get: async (id: string) => snapshotsById.get(id),
    save: async (snapshot: any) => snapshotsById.set(snapshot.id, snapshot),
  };
  const commands = {
    claimRun: async (origin: any) => project = transition(project, "running", origin),
    publishRun: async (origin: any) =>
      project = transition(project, "publishing", origin),
    completeRun: async (origin: any, input: any) => {
      project = transition(project, "completed", origin, input.resultSnapshot);
      project.commandReceipts.push({ commandId: input.commandId });
    },
    failRun: async () => undefined,
  };
  return {
    projects: { get: async () => project },
    getProject: () => project,
    setProject: (next: any) => project = next,
    commands,
    snapshots,
    attempts: new MemoryAttempts(),
    captures: new MemoryCaptures(),
    lease: {
      withLease: async (_p: string, _r: string, callback: () => Promise<unknown>) =>
        await callback(),
    },
  };
}

async function mechanicalR3Fixture() {
  const fixture = await cadFixture();
  const cad = new CoffeeMachineCm01V3CadR2RunExecutor({
    projects: fixture.projects as never,
    commands: fixture.commands as never,
    snapshots: fixture.snapshots as never,
    attempts: fixture.attempts,
    captures: fixture.captures,
    lease: fixture.lease as never,
    recipe: recipe(),
    build123d: new CadProvider(),
    now: () => "2026-08-03T19:00:00.000Z",
  });
  const afterCad = await cad.execute(
    { kind: "agent", actorId: "agent:engineering" },
    command,
  );
  const basis = afterCad.agentRuns[0]!.resultSnapshot!;
  const cadSnapshot = await fixture.snapshots.get(basis.snapshotId);
  const revisedCadStepId = cadSnapshot?.artifacts.find((item: any) =>
    item.name === "CM-01 30 mm DripTray assembly STEP export"
  )?.id;
  if (!revisedCadStepId) throw new Error("fixture lacks the fresh R2 assembly STEP");
  fixture.setProject({
    ...afterCad,
    revision: afterCad.revision + 1,
    workItems: [{
      id: "mechanical-r3",
      operation: {
        id: "verify.coffee-machine-cm01-drip-tray-mechanical",
        version: "3",
        bindings: [
          { name: "approvedBrief", source: { kind: "approved-brief" } },
          {
            name: "dripTrayHeightCorrection",
            source: {
              kind: "thread-entity",
              reference: {
                snapshotId: basis.snapshotId,
                snapshotRevision: basis.revision,
                kind: "artifact",
                id: "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record",
              },
            },
          },
          {
            name: "revisedCadStep",
            source: {
              kind: "thread-entity",
              reference: {
                snapshotId: basis.snapshotId,
                snapshotRevision: basis.revision,
                kind: "artifact",
                id: revisedCadStepId,
              },
            },
          },
        ],
      },
    }],
    agentRuns: [{
      id: "run:cm01-r3",
      workItemId: "mechanical-r3",
      status: "queued",
      summary: "r3",
      queuedAt: "2026-08-03T19:00:00.000Z",
      evidenceRefs: [],
      basis: {
        kind: "thread-snapshot",
        snapshotId: basis.snapshotId,
        revision: basis.revision,
        subjectId: basis.subjectId,
      },
    }],
  });
  return {
    ...fixture,
    attempts: new MemoryAttempts(),
    captures: new MemoryCaptures(),
  };
}

function transition(
  project: any,
  status: string,
  origin: any,
  resultSnapshot?: unknown,
) {
  const current = project.agentRuns[0];
  return {
    ...project,
    revision: project.revision + 1,
    agentRuns: project.agentRuns.map((candidate: any, index: number) =>
      index === 0
        ? {
          ...current,
          status,
          ...(status === "running"
            ? {
              claimedBy: { origin: origin.kind, id: origin.actorId },
              startedAt: "2026-08-03T18:30:00.000Z",
            }
            : {}),
          ...(resultSnapshot ? { resultSnapshot } : {}),
        }
        : candidate
    ),
  };
}

class MemoryAttempts {
  completes = 0;
  result: { action: "dispatch" } | { action: "completed"; captureFingerprint: any } = {
    action: "dispatch",
  };
  async begin() {
    return this.result;
  }
  async complete(input: any) {
    this.completes++;
    this.result = { action: "completed", captureFingerprint: input.captureFingerprint };
  }
}

class MemoryCaptures {
  readonly values = new Map<string, string>();
  uriFor(fingerprint: any) {
    return `casys://test/${fingerprint.digest}`;
  }
  async read(fingerprint: any) {
    return this.values.get(fingerprint.digest);
  }
  async save(fingerprint: any, text: string) {
    this.values.set(fingerprint.digest, text);
    return {
      uri: this.uriFor(fingerprint),
      path: `test/${fingerprint.digest}.json`,
    } as const;
  }
}

function fresh(at: string) {
  return { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] };
}

function artifact(
  id: string,
  name: string,
  kind: any,
  serverId: string,
  tool: string,
  inputArtifactIds: string[],
) {
  return {
    id,
    name,
    kind,
    version: id,
    fingerprint: {
      algorithm: "sha256" as const,
      digest:
        (id.includes("architecture")
          ? "a"
          : id.includes("plan")
          ? "b"
          : id.includes("script")
          ? "c"
          : id.includes("assembly")
          ? "d"
          : id.includes("proof")
          ? "e"
          : id.includes("isolated")
          ? "f"
          : id.includes("solve")
          ? "1"
          : id.includes("thermal")
          ? "2"
          : "3").repeat(64),
    },
    producer: { serverId, tool, runId: "base" },
    inputArtifactIds,
    freshness: fresh("2026-08-03T17:00:00.000Z"),
  };
}

function baseConsumptions() {
  return [
    consumption("old-plan", ARCHITECTURE_ID),
    consumption("old-script", "old-plan"),
    consumption("old-assembly", "old-script"),
    consumption("old-isolated", "old-proof"),
    consumption("old-solve", "old-isolated"),
  ];
}

function consumption(consumer: string, artifactId: string) {
  const digits = artifact(artifactId, "", "document", "", "", []).fingerprint;
  return {
    id: `${consumer}-consumes-${artifactId}`,
    artifactId,
    consumer: producerFor(consumer),
    observedFingerprint: digits,
    verifiedAt: "2026-08-03T17:00:00.000Z",
    status: "verified" as const,
  };
}

function baseProvenance() {
  const derivations = [
    ["old-plan", ARCHITECTURE_ID],
    ["old-script", "old-plan"],
    ["old-assembly", "old-script"],
    ["old-isolated", "old-proof"],
    ["old-solve", "old-isolated"],
  ].map(([from, to]) => ({
    id: `${from}-from-${to}`,
    relation: "derived_from" as const,
    from: { kind: "artifact" as const, id: from },
    to: { kind: "artifact" as const, id: to },
    rationale: "test lineage",
  }));
  const uses = baseConsumptions().map((item) => ({
    id: `${item.id}-uses`,
    relation: "uses" as const,
    from: { kind: "consumption" as const, id: item.id },
    to: { kind: "artifact" as const, id: item.artifactId },
    rationale: "test consumption",
  }));
  return [...derivations, ...uses];
}

function producerFor(id: string) {
  if (id === "old-plan" || id === "old-script") {
    return {
      serverId: "digital-thread",
      tool: "compile_coffee_machine_cm01_semantic_cad_plan",
      runId: "base",
    };
  }
  if (id === "old-assembly" || id === "old-isolated") {
    return { serverId: "build123d", tool: "build123d_export", runId: "base" };
  }
  return { serverId: "calculix", tool: "calculix_solve_static", runId: "base" };
}

function recipe() {
  return deriveCm01DripTrayHeight30Recipe(parseCoffeeMachineCm01SemanticRecipe(RECIPE));
}

function proof() {
  return deriveCm01DripTrayHeight30Proof(parseCm01DripTrayMechanicalProof(PROOF));
}

function proofR3() {
  return parseCm01DripTrayMechanicalProofR3(R3_PROOF);
}
