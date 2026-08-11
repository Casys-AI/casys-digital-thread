import { assertEquals, assertRejects } from "@std/assert";
import {
  canonicalResolvedOperationPlanV2Text,
  type ResolvedOperationPlanV2,
} from "../../domain/analysis/resolved-operation-plan-v2.ts";
import type { RegisteredRunPlanSealInput } from "../../domain/project/resolved-run-plan-sealer.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import { FileByteStore } from "../captures/file-byte-store.ts";
import {
  CaptureBackedRunPlanSealer,
  RESOLVED_OPERATION_PLAN_STORE_DESCRIPTOR,
} from "./capture-backed-run-plan-sealer.ts";

const fingerprint = (character: string) => ({
  algorithm: "sha256" as const,
  digest: character.repeat(64),
});

Deno.test("CaptureBackedRunPlanSealer saves, rereads, and returns only a run-bound CAS reference", async () => {
  const directory = await Deno.makeTempDir({ prefix: "resolved-run-plan-" });
  try {
    const store = new FileByteStore({
      ...RESOLVED_OPERATION_PLAN_STORE_DESCRIPTOR,
      directory,
    });
    const sealer = new CaptureBackedRunPlanSealer({
      store,
      resolver: { resolve: planFor },
    });
    const input = sealInput();
    const ref = await sealer.seal(input);
    const reread = await sealer.read(ref);

    assertEquals(ref.planId, input.run.id);
    assertEquals(reread.run.runId, input.run.id);
    assertEquals(
      reread.run.queueBasisProject.fingerprint,
      input.queueBasisProject.fingerprint,
    );
    assertEquals(
      canonicalResolvedOperationPlanV2Text(reread),
      canonicalResolvedOperationPlanV2Text(await planFor(input)),
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CaptureBackedRunPlanSealer rejects a resolver plan copied from another run before CAS publication", async () => {
  const directory = await Deno.makeTempDir({ prefix: "resolved-run-plan-" });
  try {
    const store = new FileByteStore({
      ...RESOLVED_OPERATION_PLAN_STORE_DESCRIPTOR,
      directory,
    });
    const input = sealInput();
    const sealer = new CaptureBackedRunPlanSealer({
      store,
      resolver: {
        resolve: async (candidate) => {
          const plan = await planFor(candidate) as unknown as Record<string, unknown>;
          plan.id = "run:other";
          (plan.run as Record<string, unknown>).runId = "run:other";
          return plan;
        },
      },
    });
    await assertRejects(
      () => sealer.seal(input),
      TypeError,
      "does not belong to the candidate run",
    );
    assertEquals(await Array.fromAsync(Deno.readDir(directory)), []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CaptureBackedRunPlanSealer recomputes the registered operation and direct MRTR seals", async () => {
  const directory = await Deno.makeTempDir({ prefix: "resolved-run-plan-" });
  try {
    const input = sealInput();
    const corruptions: readonly {
      readonly expected: string;
      apply(plan: ResolvedOperationPlanV2): void;
    }[] = [{
      expected: "registered work item",
      apply(plan) {
        (plan as unknown as {
          workItem: { operationFingerprint: ReturnType<typeof fingerprint> };
        }).workItem.operationFingerprint = fingerprint("d");
      },
    }, {
      expected: "exact direct MRTR decision and approval",
      apply(plan) {
        (plan as unknown as {
          authorization: { mrtr: { approvalId: string } };
        }).authorization.mrtr.approvalId = "approval:unrelated";
      },
    }];
    for (const corruption of corruptions) {
      const sealer = new CaptureBackedRunPlanSealer({
        store: new FileByteStore({
          ...RESOLVED_OPERATION_PLAN_STORE_DESCRIPTOR,
          directory,
        }),
        resolver: {
          async resolve(candidate) {
            const plan = await planFor(candidate);
            corruption.apply(plan);
            return plan;
          },
        },
      });
      await assertRejects(() => sealer.seal(input), TypeError, corruption.expected);
    }
    assertEquals(await Array.fromAsync(Deno.readDir(directory)), []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function sealInput(): RegisteredRunPlanSealInput {
  const runId = "run:modelica-recorded";
  return {
    project: {
      id: "project.cm01:project:r17:abcdabcdabcdabcd",
      revision: 17,
      project: { id: "project.cm01" },
      decisions: [mrtrDecision()],
      approvals: [mrtrApproval()],
    } as unknown as RegisteredRunPlanSealInput["project"],
    workItem: {
      id: "simulate-thermal",
      operation: {
        id: "simulate.run-modelica-scenario",
        version: "2",
        bindings: [],
      },
      decisionIds: ["decision.thermal"],
    } as unknown as RegisteredRunPlanSealInput["workItem"],
    run: {
      id: runId,
      workItemId: "simulate-thermal",
      inputFingerprint: fingerprint("1"),
      basis: {
        kind: "thread-snapshot",
        snapshotId: "thread.cm01",
        revision: 12,
        subjectId: "coffee-machine",
      },
    } as unknown as RegisteredRunPlanSealInput["run"],
    queueBasisProject: {
      snapshotId: "project.cm01:project:r17:abcdabcdabcdabcd",
      revision: 17,
      fingerprint: fingerprint("2"),
    },
  };
}

async function planFor(
  input: RegisteredRunPlanSealInput,
): Promise<ResolvedOperationPlanV2> {
  const run = input.run;
  const basis = run.basis;
  if (!run.inputFingerprint || !basis || basis.kind !== "thread-snapshot") {
    throw new Error("Test fixture requires a thread-snapshot candidate.");
  }
  const sourceFingerprint = fingerprint("3");
  return {
    schemaVersion: "resolved-operation-plan/2.0",
    id: run.id,
    run: {
      projectId: input.project.project.id,
      runId: run.id,
      workItemId: input.workItem.id,
      inputFingerprint: run.inputFingerprint,
      queueBasisProject: input.queueBasisProject,
    },
    workItem: {
      id: input.workItem.id,
      operation: {
        id: input.workItem.operation!.id,
        version: input.workItem.operation!.version,
      },
      operationFingerprint: await sha256Fingerprint(input.workItem.operation!),
    },
    authorization: {
      kind: "human-mrtr-and-qualified-method",
      mrtr: {
        decisionId: "decision.thermal",
        decisionInputFingerprint: fingerprint("5"),
        approvalId: "approval.thermal",
        approvalFingerprint: await sha256Fingerprint(mrtrApproval()),
      },
      methodQualification: {
        id: "qualified-modelica-thermal",
        version: "2.1",
        fingerprint: fingerprint("7"),
      },
    },
    basis: {
      kind: "thread-snapshot",
      snapshotId: basis.snapshotId,
      revision: basis.revision,
      subjectId: basis.subjectId,
      fingerprint: fingerprint("8"),
    },
    sources: [{
      bindingName: "modelSource",
      role: "model-source",
      threadRef: {
        snapshotId: basis.snapshotId,
        snapshotRevision: basis.revision,
        kind: "artifact",
        id: "artifact.modelica",
      },
      artifact: {
        fingerprint: sourceFingerprint,
        byteCount: 10,
        mediaType: "text/plain",
        casUri: `casys://modelica-source/sha256/${sourceFingerprint.digest}`,
      },
    }, {
      bindingName: "methodManifest",
      role: "provider-manifest",
      threadRef: {
        snapshotId: basis.snapshotId,
        snapshotRevision: basis.revision,
        kind: "artifact",
        id: "artifact.modelica-provider-manifest",
      },
      artifact: {
        fingerprint: fingerprint("b"),
        byteCount: 11,
        mediaType: "application/json",
        casUri: `casys://modelica-provider-manifest/sha256/${"b".repeat(64)}`,
      },
    }, {
      bindingName: "simulationCase",
      role: "simulation-case",
      threadRef: {
        snapshotId: basis.snapshotId,
        snapshotRevision: basis.revision,
        kind: "artifact",
        id: "artifact.simulation-case",
      },
      artifact: {
        fingerprint: fingerprint("9"),
        byteCount: 12,
        mediaType: "application/json",
        casUri: `casys://simulation-case-capture/sha256/${"9".repeat(64)}`,
      },
    }],
    action: {
      kind: "dynamic-system-simulation",
      provider: {
        id: "mcp-modelica",
        contract: { id: "resumable", version: "2.1" },
      },
      lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
      normalizer: {
        id: "modelica-run-normalizer",
        version: "2.1",
        authority: "exact-provider-manifest",
      },
      requestId: "request.modelica",
      input: {
        simulationCase: {
          id: "thermal-case",
          fingerprint: fingerprint("9"),
          sourceBinding: "simulationCase",
        },
        providerManifestFingerprint: fingerprint("a"),
        methodManifestSourceBinding: "methodManifest",
        scenarioStartTimeSeconds: 0,
        effectiveTimeoutMs: 30_000,
      },
    },
    expectedProviderResources: {
      ledgerSchema: "provider-resource-acquisition-ledger/1.0",
      captureManifestSchema: "provider-artifact-capture-manifest/1.0",
      resourceProfile: {
        id: "mcp-modelica.resumable-artifacts",
        version: "2.1",
      },
      parameterSchema: "required",
    },
    recovery: {
      policy: "mcp-modelica.resumable-recovery@2.1",
      requestId: "request.modelica",
      mode: "same-request-readback-no-blind-redispatch",
      ambiguousOutcome: "quarantine-for-human-review",
      capturedOutcome: "cas-only-recovery",
    },
  };
}

function mrtrDecision() {
  return {
    id: "decision.thermal",
    status: "approved" as const,
    inputFingerprint: fingerprint("5"),
    approvalIds: ["approval.thermal"],
  };
}

function mrtrApproval() {
  return {
    id: "approval.thermal",
    decisionId: "decision.thermal",
    status: "approved" as const,
    requestedAt: "2026-08-11T00:00:00.000Z",
    decidedAt: "2026-08-11T00:01:00.000Z",
    decidedBy: "human:thermal-reviewer",
    rationale: "The qualified Modelica method is approved for this recorded case.",
    decidedByOrigin: "human" as const,
    inputFingerprint: fingerprint("5"),
    inputEvidenceRefs: [],
  };
}
