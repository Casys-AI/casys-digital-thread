import { assertEquals, assertRejects } from "@std/assert";
import {
  canonicalResolvedOperationPlanV2Text,
  type ResolvedOperationPlanV2,
} from "../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import type { RegisteredRunPlanSealInput } from "../../../domain/project/resolved-run-plan-sealer.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
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
    }, {
      expected: "exact queue-resolved operational capability",
      apply(plan) {
        (plan.operationalCapability.bindings[0]!.profile as {
          fingerprint: ReturnType<typeof fingerprint>;
        }).fingerprint = fingerprint("f");
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
  const runId = "run:calculix-isolated";
  return {
    project: {
      id: "project.cm01:project:r17:abcdabcdabcdabcd",
      revision: 17,
      project: { id: "project.cm01" },
      decisions: [mrtrDecision()],
      approvals: [mrtrApproval()],
    } as unknown as RegisteredRunPlanSealInput["project"],
    workItem: {
      id: "verify-fea",
      operation: {
        id: "verify.run-fea-static-proof",
        version: "3",
        bindings: [],
      },
      decisionIds: ["decision.fea"],
    } as unknown as RegisteredRunPlanSealInput["workItem"],
    run: {
      id: runId,
      workItemId: "verify-fea",
      inputFingerprint: fingerprint("1"),
      basis: {
        kind: "thread-snapshot",
        snapshotId: "thread.cm01",
        revision: 12,
        subjectId: "coffee-machine",
      },
    } as unknown as RegisteredRunPlanSealInput["run"],
    operationalCapability: operationalCapabilityFor("project.cm01", "3"),
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
  const proofFingerprint = fingerprint("c");
  const profileFingerprint = fingerprint("e");
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
    operationalCapability: input.operationalCapability!,
    authorization: {
      kind: "human-mrtr-and-qualified-method",
      mrtr: {
        decisionId: "decision.fea",
        decisionInputFingerprint: fingerprint("5"),
        approvalId: "approval.fea",
        approvalFingerprint: await sha256Fingerprint(mrtrApproval()),
      },
      methodQualification: {
        id: "qualified-calculix-isolated-static-proof",
        version: "1.0",
        fingerprint: profileFingerprint,
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
      bindingName: "proofCase",
      role: "proof-case",
      threadRef: {
        snapshotId: basis.snapshotId,
        snapshotRevision: basis.revision,
        kind: "artifact",
        id: "artifact.fea-proof-case",
      },
      artifact: {
        fingerprint: proofFingerprint,
        byteCount: 127,
        mediaType: "application/json",
        casUri: `casys://fea-proof-case-capture/sha256/${proofFingerprint.digest}`,
      },
    }, {
      bindingName: "geometry",
      role: "geometry-source",
      threadRef: {
        snapshotId: basis.snapshotId,
        snapshotRevision: basis.revision,
        kind: "artifact",
        id: "artifact.geometry-step",
      },
      artifact: {
        fingerprint: fingerprint("d"),
        byteCount: 128,
        mediaType: "model/step",
        casUri: `casys://thread-asset/sha256/${"d".repeat(64)}`,
      },
    }],
    action: {
      kind: "isolated-static-structural-analysis",
      executor: {
        id: "casys-local-microsandbox",
        contract: { id: "calculix-static-proof-v1", version: "1.0.0" },
        profileFingerprint,
      },
      lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
      requestId: "request.calculix.local.1",
      input: {
        proofCase: {
          id: "drip-tray-static",
          fingerprint: proofFingerprint,
          sourceBinding: "proofCase",
        },
        geometrySourceBinding: "geometry",
        effectiveElementOrder: 2,
        effectiveTimeoutMs: 60_000,
      },
    },
    expectedProviderResources: {
      receiptSchema: "isolated-code-execution-receipt-record/1.0",
      evidenceSchema: "calculix-isolated-static-evidence/1.0",
      resourceProfile: {
        id: "calculix-isolated.static-artifacts",
        version: "1.0",
      },
    },
    recovery: {
      policy: "calculix-isolated-generation-recovery@1.0",
      requestId: "request.calculix.local.1",
      mode: "same-request-readback-no-blind-redispatch",
      ambiguousOutcome: "quarantine-for-human-review",
      capturedOutcome: "cas-only-recovery",
    },
  };
}

function operationalCapabilityFor(
  projectId: string,
  operationVersion: "2" | "3",
): NonNullable<RegisteredRunPlanSealInput["operationalCapability"]> {
  return {
    schemaVersion: "resolved-capability-runtime-operation/2.0",
    projectId,
    operation: { id: "verify.run-fea-static-proof", version: operationVersion },
    authorizationFingerprint: fingerprint("a"),
    demandFingerprint: fingerprint("b"),
    registryFingerprint: fingerprint("c"),
    bindings: [{
      capability: {
        id: "mechanics.solve-static-structural",
        version: "1",
        use: "execution",
        minimumQualification: "qualified",
      },
      binding: { id: "calculix-static-structural", version: "1" },
      effectiveQualification: "qualified",
      adapter: { id: "casys.calculix-worker", version: "1", source: "test" },
      profile: {
        id: "calculix-static",
        version: "1",
        fingerprint: fingerprint("d"),
      },
      materials: [{
        unitId: "casys.calculix-worker",
        materialId: "calculix-worker",
        imageDigest: "e".repeat(64),
      }],
      runtimeModes: [{
        material: {
          unitId: "casys.calculix-worker",
          materialId: "calculix-worker",
          imageDigest: "e".repeat(64),
        },
        targetPlatform: "linux/arm64",
        mode: "native",
        qualificationAttestationFingerprint: null,
      }],
      hostLifecycles: [{
        material: {
          unitId: "casys.calculix-worker",
          materialId: "calculix-worker",
          imageDigest: "e".repeat(64),
        },
        kind: "ephemeral-microsandbox",
        launchGroup: null,
      }],
    }],
  };
}

function mrtrDecision() {
  return {
    id: "decision.fea",
    status: "approved" as const,
    inputFingerprint: fingerprint("5"),
    approvalIds: ["approval.fea"],
  };
}

function mrtrApproval() {
  return {
    id: "approval.fea",
    decisionId: "decision.fea",
    status: "approved" as const,
    requestedAt: "2026-08-11T00:00:00.000Z",
    decidedAt: "2026-08-11T00:01:00.000Z",
    decidedBy: "human:fea-reviewer",
    rationale: "The qualified CalculiX method is approved for this recorded case.",
    decidedByOrigin: "human" as const,
    inputFingerprint: fingerprint("5"),
    inputEvidenceRefs: [],
  };
}
