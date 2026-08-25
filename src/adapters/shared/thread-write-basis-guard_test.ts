import { assertEquals, assertRejects } from "@std/assert";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../domain/architecture/renderer/architecture-proposal.ts";
import { MODEL_CAPTURE_PART_DEFINITIONS_OPERATION } from "../../domain/architecture/part-definitions/part-definitions-capture.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../domain/cad/canonical/geometry-proposal.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../domain/architecture/requirements/requirements-proposal.ts";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
} from "../../domain/project/engineering-project.ts";
import {
  assertThreadWriteBasisAvailable,
  TERMINAL_THREAD_WRITE_FAILURES,
  threadWriteBasisLeaseScope,
} from "./thread-write-basis-guard.ts";
import {
  UNCERTAIN_WRITER_BASIS_RELEASE_ACTION,
  UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME,
  uncertainWriterBasisReleaseIds,
  uncertainWriterBasisReleaseText,
} from "../../domain/record/uncertain-writer-basis-release.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "../../orchestration/operations/fea-isolated-static-proof.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "../../domain/compile/admission/technical-compilation-proposal.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../domain/cad/isolated/build123d-execution-proposal.ts";
import { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION } from "../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import { VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION } from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION } from "../../domain/modelica/qualified-kit/run-proposal.ts";
import { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION } from "../../domain/modelica/admitted/run-proposal.ts";
import { ARCHIVE_LINEAGE_OPERATION } from "../../domain/thread/thread-retirement.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/architecture/seed/syson-model-seed.ts";
import {
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
} from "../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import { VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION } from "../../domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts";
import { DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION } from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";

const BASIS = {
  kind: "thread-snapshot" as const,
  snapshotId: "thread:r4",
  revision: 4,
  subjectId: "subject-1",
};

Deno.test("all generic Thread writers share one lease for an exact basis", () => {
  const scopes = [
    run("architecture", "queued"),
    run("requirements", "queued"),
    run("geometry", "queued"),
    run("admission", "queued"),
    run("build123d-execution", "queued"),
    run("part-definitions", "queued"),
    run("assembly-integrity", "queued"),
    run("assembly-integrity-evaluation", "queued"),
  ].map(threadWriteBasisLeaseScope);

  assertEquals(new Set(scopes).size, 1);
});

Deno.test(
  "capture-part-definitions shares the thread-write basis lease with architecture and requirements writers",
  () => {
    assertEquals(
      threadWriteBasisLeaseScope(run("part-definitions", "queued")),
      threadWriteBasisLeaseScope(run("architecture", "queued")),
    );
    assertEquals(
      threadWriteBasisLeaseScope(run("part-definitions", "queued")),
      threadWriteBasisLeaseScope(run("requirements", "queued")),
    );
  },
);

Deno.test("a completed PartDefinitions capture blocks a same-basis sibling", async () => {
  const current = run("architecture", "queued");
  const sibling = run("part-definitions", "completed");
  await assertRejects(
    () => assertThreadWriteBasisAvailable(project([current, sibling]), current),
    EngineeringProjectCommandError,
    "sibling run",
  );
});

Deno.test("a completed assembly-integrity observation blocks a same-basis sibling", async () => {
  const current = run("architecture", "queued");
  const sibling = run("assembly-integrity", "completed");
  await assertRejects(
    () => assertThreadWriteBasisAvailable(project([current, sibling]), current),
    EngineeringProjectCommandError,
    "sibling run",
  );
});

Deno.test("a completed assembly-integrity L4 evaluation blocks a same-basis sibling", async () => {
  const current = run("architecture", "queued");
  const sibling = run("assembly-integrity-evaluation", "completed");
  await assertRejects(
    () => assertThreadWriteBasisAvailable(project([current, sibling]), current),
    EngineeringProjectCommandError,
    "sibling run",
  );
});

Deno.test("a queued sibling may wait for the shared basis lease", async () => {
  const current = run("architecture", "queued");
  const sibling = run("geometry", "queued");

  await assertThreadWriteBasisAvailable(project([current, sibling]), current);
});

Deno.test("a stale queued basis is refused before another Thread write", async () => {
  const current = run("requirements", "queued");
  const initial = project([current]);
  const value: EngineeringProjectSnapshot = {
    ...initial,
    threadSnapshots: [
      ...initial.threadSnapshots,
      { snapshotId: "thread:r5", revision: 5, subjectId: BASIS.subjectId },
    ],
  };

  await assertRejects(
    () => assertThreadWriteBasisAvailable(value, current),
    EngineeringProjectCommandError,
    "no longer the unique declared project Thread head",
  );
});

Deno.test("a Thread basis cannot be transplanted to another project subject", async () => {
  const current = run("geometry", "queued");
  const initial = project([current]);
  const transplanted: EngineeringProjectSnapshot = {
    ...initial,
    project: { ...initial.project, subjectId: "foreign-subject" },
  };

  await assertRejects(
    () => assertThreadWriteBasisAvailable(transplanted, current),
    EngineeringProjectCommandError,
    "basis is no longer the unique declared project Thread head",
  );
});

Deno.test("an active cross-operation sibling blocks the same Thread basis", async () => {
  const current = run("geometry", "queued");
  const sibling = run("requirements", "publishing");

  await assertRejects(
    () => assertThreadWriteBasisAvailable(project([current, sibling]), current),
    EngineeringProjectCommandError,
    "active, completed, or uncertain durable write",
  );
});

Deno.test("recorded @2 writers participate in the same basis exclusion", async () => {
  const current = run("geometry", "queued");
  for (
    const [index, operation] of [
      VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
      VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
    ].entries()
  ) {
    const sibling = {
      ...run("geometry", "running"),
      id: `recorded-v2-${index}`,
      workItemId: `work-recorded-v2-${index}`,
    };
    const initial = project([current, sibling]);
    const value: EngineeringProjectSnapshot = {
      ...initial,
      workItems: initial.workItems.map((item) =>
        item.id === sibling.workItemId
          ? {
            ...item,
            operation: {
              ...operation,
              bindings: item.operation?.bindings ?? [],
            },
          }
          : item
      ),
    };
    await assertRejects(
      () => assertThreadWriteBasisAvailable(value, current),
      EngineeringProjectCommandError,
      "active, completed, or uncertain durable write",
    );
  }
});

Deno.test("local Modelica and CalculiX writers share the same Thread-basis exclusion", async () => {
  const current = run("geometry", "queued");
  for (
    const [index, operation] of [
      SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
      SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
      VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
    ].entries()
  ) {
    const sibling = {
      ...run("geometry", "running"),
      id: `local-isolated-writer-${index}`,
      workItemId: `work-local-isolated-writer-${index}`,
    };
    const initial = project([current, sibling]);
    const value: EngineeringProjectSnapshot = {
      ...initial,
      workItems: initial.workItems.map((item) =>
        item.id === sibling.workItemId
          ? {
            ...item,
            operation: {
              ...operation,
              bindings: item.operation?.bindings ?? [],
            },
          }
          : item
      ),
    };

    assertEquals(
      threadWriteBasisLeaseScope(current),
      threadWriteBasisLeaseScope(sibling),
    );
    await assertRejects(
      () => assertThreadWriteBasisAvailable(value, current),
      EngineeringProjectCommandError,
      "active, completed, or uncertain durable write",
    );
  }
});

Deno.test("SysON seed and generic architecture writers share the technical-compilation basis exclusion", async () => {
  const current = run("admission", "queued");
  for (
    const [index, operation] of [
      SYSON_MODEL_SEED_OPERATION,
      MODEL_WRITE_ARCHITECTURE_OPERATION,
      MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
    ].entries()
  ) {
    const sibling = {
      ...run("geometry", "running"),
      id: `provider-writer-${index}`,
      workItemId: `work-provider-writer-${index}`,
    };
    const initial = project([current, sibling]);
    const value: EngineeringProjectSnapshot = {
      ...initial,
      workItems: initial.workItems.map((item) =>
        item.id === sibling.workItemId
          ? {
            ...item,
            operation: {
              ...operation,
              bindings: item.operation?.bindings ?? [],
            },
          }
          : item
      ),
    };
    assertEquals(
      threadWriteBasisLeaseScope(current),
      threadWriteBasisLeaseScope(sibling),
    );
    await assertRejects(
      () => assertThreadWriteBasisAvailable(value, current),
      EngineeringProjectCommandError,
      "active, completed, or uncertain durable write",
    );
  }
});

Deno.test("a durable technical-compilation admission blocks every sibling on the same basis", async () => {
  for (const status of ["running", "publishing", "completed"] as const) {
    const current = run("geometry", "queued");
    const sibling = run("admission", status);

    await assertRejects(
      () => assertThreadWriteBasisAvailable(project([current, sibling]), current),
      EngineeringProjectCommandError,
      "active, completed, or uncertain durable write",
    );
  }
});

Deno.test("a running sensitivity writer blocks every sibling on the same Thread basis", async () => {
  const current = run("architecture", "queued");
  for (
    const operation of [
      ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
      ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
      MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
    ]
  ) {
    const sibling = {
      ...run("geometry", "running"),
      id: `run:${operation.id}`,
      workItemId: `work:${operation.id}`,
    };
    const initial = project([current, sibling]);
    const value: EngineeringProjectSnapshot = {
      ...initial,
      workItems: initial.workItems.map((item) =>
        item.id === sibling.workItemId
          ? {
            ...item,
            operation: {
              ...operation,
              bindings: item.operation?.bindings ?? [],
            },
          }
          : item
      ),
    };
    await assertRejects(
      () => assertThreadWriteBasisAvailable(value, current),
      EngineeringProjectCommandError,
      "active, completed, or uncertain durable write",
    );
  }
});

Deno.test("join writers share the same Thread-basis exclusion", async () => {
  const current = run("architecture", "queued");
  for (
    const operation of [
      VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
    ]
  ) {
    const sibling = {
      ...run("geometry", "running"),
      id: `run:${operation.id}`,
      workItemId: `work:${operation.id}`,
    };
    const initial = project([current, sibling]);
    const value: EngineeringProjectSnapshot = {
      ...initial,
      workItems: initial.workItems.map((item) =>
        item.id === sibling.workItemId
          ? {
            ...item,
            operation: {
              ...operation,
              bindings: item.operation?.bindings ?? [],
            },
          }
          : item
      ),
    };
    await assertRejects(
      () => assertThreadWriteBasisAvailable(value, current),
      EngineeringProjectCommandError,
      "active, completed, or uncertain durable write",
    );
  }
});

Deno.test("archive-lineage shares the basis exclusion with technical compilation", async () => {
  const current = run("admission", "queued");
  const sibling = {
    ...run("geometry", "publishing"),
    id: "run:archive",
    workItemId: "work:archive",
  };
  const initial = project([current, sibling]);
  const value: EngineeringProjectSnapshot = {
    ...initial,
    workItems: initial.workItems.map((item) =>
      item.id === sibling.workItemId
        ? {
          ...item,
          operation: {
            ...ARCHIVE_LINEAGE_OPERATION,
            bindings: item.operation?.bindings ?? [],
          },
        }
        : item
    ),
  };
  assertEquals(
    threadWriteBasisLeaseScope(current),
    threadWriteBasisLeaseScope(sibling),
  );
  await assertRejects(
    () => assertThreadWriteBasisAvailable(value, current),
    EngineeringProjectCommandError,
    "active, completed, or uncertain durable write",
  );
});

Deno.test("an uncertain technical-compilation Thread write remains quarantined after failure", async () => {
  const current = run("requirements", "queued");
  const sibling = {
    ...run("admission", "failed"),
    failure: {
      code: "compile-seal-admission-thread-write-outcome-unknown",
      message: "ThreadSnapshot publication outcome is unknown.",
    },
  };

  await assertRejects(
    () => assertThreadWriteBasisAvailable(project([current, sibling]), current),
    EngineeringProjectCommandError,
    "requires exact recovery attachment",
  );
  assertEquals(
    TERMINAL_THREAD_WRITE_FAILURES.has(sibling.failure.code),
    false,
    "a local ThreadSnapshot outcome must not enter generic provider reconciliation",
  );
});

Deno.test("an uncertain assembly-integrity L5 write remains quarantined after failure", async () => {
  const current = run("requirements", "queued");
  const sibling = {
    ...run("assembly-integrity-closeout", "failed"),
    failure: {
      code: "decide-accept-assembly-integrity-evaluation-not-published",
      message: "The closeout successor publication outcome is unknown.",
    },
  };

  await assertRejects(
    () => assertThreadWriteBasisAvailable(project([current, sibling]), current),
    EngineeringProjectCommandError,
    "requires exact recovery attachment",
  );
  assertEquals(
    TERMINAL_THREAD_WRITE_FAILURES.has(sibling.failure.code),
    false,
    "a provider-free L5 ThreadSnapshot outcome must not enter generic provider reconciliation",
  );
});

Deno.test("a forged generic reconciliation cannot release an uncertain technical-compilation Thread write", async () => {
  const current = run("requirements", "queued");
  const sibling = {
    ...run("admission", "failed"),
    failure: {
      code: "compile-seal-admission-thread-write-outcome-unknown",
      message: "ThreadSnapshot publication outcome is unknown.",
    },
    uncertainWriterReconciliation: {
      kind: "uncertain-writer-resolved" as const,
      outcome: "provider-did-not-write" as const,
      reconciledAt: "2026-08-10T00:00:00.000Z",
      reconciledBy: { id: "op-1", origin: "human" as const },
      decisionId: "decision-reconcile-forged",
      providerInspectionAttestation: "No provider exists for this local Thread write.",
    },
  };

  await assertRejects(
    () => assertThreadWriteBasisAvailable(project([current, sibling]), current),
    EngineeringProjectCommandError,
    "requires exact recovery attachment",
  );
});

Deno.test("a terminal uncertain provider sibling blocks after its lease is released", async () => {
  const current = run("geometry", "queued");
  const sibling = {
    ...run("architecture", "failed"),
    failure: {
      code: "model-write-architecture-provider-outcome-unknown",
      message: "Provider outcome is unknown.",
    },
  };

  await assertRejects(
    () => assertThreadWriteBasisAvailable(project([current, sibling]), current),
    EngineeringProjectCommandError,
    "active, completed, or uncertain durable write",
  );
});

Deno.test("a reconciled did-not-write sibling does not block the thread write basis", async () => {
  const current = run("geometry", "queued");
  const sibling = {
    ...run("architecture", "failed"),
    failure: {
      code: "model-write-architecture-provider-outcome-unknown",
      message: "Provider outcome is unknown.",
    },
    uncertainWriterReconciliation: {
      kind: "uncertain-writer-resolved" as const,
      outcome: "provider-did-not-write" as const,
      reconciledAt: "2026-08-10T00:00:00.000Z",
      reconciledBy: { id: "op-1", origin: "human" as const },
      decisionId: "decision-reconcile-1",
      providerInspectionAttestation: "Inspected container logs; no file written.",
    },
  };

  const annotationOnly = project([current, sibling]);
  await assertRejects(
    () => assertThreadWriteBasisAvailable(annotationOnly, current),
    EngineeringProjectCommandError,
    "has no exact approved human reconciliation",
  );
  await assertThreadWriteBasisAvailable(
    await reconciledProject(annotationOnly, sibling),
    current,
  );
});

Deno.test("an accepted uncertain write rejects a homonymous resolved blocker and releases only after the exact human ceremony", async () => {
  const current = run("geometry", "queued");
  const sibling = {
    ...run("architecture", "failed"),
    failure: {
      code: "model-write-architecture-provider-outcome-unknown",
      message: "Provider outcome is unknown.",
    },
    uncertainWriterReconciliation: {
      kind: "uncertain-writer-resolved" as const,
      outcome: "write-effect-accepted" as const,
      reconciledAt: "2026-08-10T00:00:00.000Z",
      reconciledBy: { id: "op-1", origin: "human" as const },
      decisionId: "decision-reconcile-1",
      providerInspectionAttestation: "Provider history shows a write.",
    },
  };
  const blocked = await reconciledProject(project([current, sibling]), sibling);
  const forgedReconciliation: EngineeringProjectSnapshot = {
    ...blocked,
    decisions: blocked.decisions.map((decision) =>
      decision.id === sibling.uncertainWriterReconciliation.decisionId &&
        decision.proposal
        ? {
          ...decision,
          proposal: {
            ...decision.proposal,
            summary: "Mutated after the fingerprint was sealed.",
          },
        }
        : decision
    ),
  };
  await assertRejects(
    () => assertThreadWriteBasisAvailable(forgedReconciliation, current),
    EngineeringProjectCommandError,
    "has no exact approved human reconciliation",
  );
  const forgedReceipt: EngineeringProjectSnapshot = {
    ...blocked,
    commandReceipts: blocked.commandReceipts?.map((receipt) =>
      receipt.type === "agent-run.reconcile-annotation"
        ? {
          ...receipt,
          requestFingerprint: {
            algorithm: "sha256",
            digest: "f".repeat(64),
          },
        }
        : receipt
    ),
  };
  await assertRejects(
    () => assertThreadWriteBasisAvailable(forgedReceipt, current),
    EngineeringProjectCommandError,
    "has no exact approved human reconciliation",
  );
  await assertRejects(
    () => assertThreadWriteBasisAvailable(blocked, current),
    EngineeringProjectCommandError,
    "requires an approved human basis release",
  );
  const fakeResolved: EngineeringProjectSnapshot = {
    ...blocked,
    blockers: [{
      id: "blocker:uncertain-write-accepted:run:architecture",
      phaseId: "phase",
      title: "Uncertain provider write accepted — review before re-run",
      description: "Human release was approved.",
      kind: "tool-failure",
      status: "resolved",
      openedAt: "2026-08-10T00:00:00.000Z",
      resolvedAt: "2026-08-10T00:01:00.000Z",
      resolution: "Resolved by approved decision.",
      workItemIds: [sibling.workItemId],
      decisionIds: ["decision:uncertain-write-release:run:architecture"],
    }],
  };
  await assertRejects(
    () => assertThreadWriteBasisAvailable(fakeResolved, current),
    EngineeringProjectCommandError,
    "requires an approved human basis release",
  );

  const released = await releasedProject(blocked, sibling);
  await assertThreadWriteBasisAvailable(released, current);
  const forgedRelease: EngineeringProjectSnapshot = {
    ...released,
    decisions: released.decisions.map((decision) =>
      decision.id.startsWith("decision:uncertain-write-release:") &&
        decision.proposal
        ? {
          ...decision,
          proposal: {
            ...decision.proposal,
            summary: "Coordinated digest equality cannot hide this mutation.",
          },
        }
        : decision
    ),
  };
  await assertRejects(
    () => assertThreadWriteBasisAvailable(forgedRelease, current),
    EngineeringProjectCommandError,
    "requires an approved human basis release",
  );
  const forgedReleaseEvidence: EngineeringProjectSnapshot = {
    ...released,
    approvals: released.approvals.map((approval) =>
      approval.decisionId.startsWith("decision:uncertain-write-release:")
        ? {
          ...approval,
          inputEvidenceRefs: [{
            snapshotId: BASIS.snapshotId,
            snapshotRevision: BASIS.revision,
            kind: "artifact",
            id: "forged-release-input",
          }],
        }
        : approval
    ),
  };
  await assertRejects(
    () => assertThreadWriteBasisAvailable(forgedReleaseEvidence, current),
    EngineeringProjectCommandError,
    "requires an approved human basis release",
  );
});

Deno.test("a reconciled geometry sibling does not block the thread write basis", async () => {
  const current = run("architecture", "queued");
  const sibling = {
    ...run("geometry", "failed"),
    failure: { code: "geometry-failed", message: "Seal outcome is uncertain." },
    uncertainWriterReconciliation: {
      kind: "uncertain-writer-resolved" as const,
      outcome: "provider-did-not-write" as const,
      reconciledAt: "2026-08-10T00:00:00.000Z",
      reconciledBy: { id: "op-1", origin: "human" as const },
      decisionId: "decision-reconcile-2",
      providerInspectionAttestation: "No STEP file written to the exports volume.",
    },
  };

  // A reconciled geometry sibling must also be unblocked.
  await assertThreadWriteBasisAvailable(
    await reconciledProject(project([current, sibling]), sibling),
    current,
  );
});

Deno.test("an ordinary pre-write failed sibling does not poison the basis", async () => {
  const current = run("requirements", "queued");
  const sibling = {
    ...run("architecture", "failed"),
    failure: { code: "invalid-input", message: "No provider call occurred." },
  };

  await assertThreadWriteBasisAvailable(project([current, sibling]), current);
});

Deno.test("a failed geometry sibling is conservatively treated as durable", async () => {
  const current = run("architecture", "queued");
  const sibling = {
    ...run("geometry", "failed"),
    failure: { code: "geometry-failed", message: "Seal outcome is uncertain." },
  };

  await assertRejects(
    () => assertThreadWriteBasisAvailable(project([current, sibling]), current),
    EngineeringProjectCommandError,
    "active, completed, or uncertain durable write",
  );
});

type OperationName =
  | "architecture"
  | "requirements"
  | "geometry"
  | "admission"
  | "build123d-execution"
  | "part-definitions"
  | "assembly-integrity"
  | "assembly-integrity-evaluation"
  | "assembly-integrity-closeout";

function operation(name: OperationName): EngineeringOperationRef {
  const identity = name === "architecture"
    ? MODEL_WRITE_ARCHITECTURE_OPERATION
    : name === "requirements"
    ? MODEL_WRITE_REQUIREMENTS_OPERATION
    : name === "geometry"
    ? DESIGN_WRITE_GEOMETRY_OPERATION
    : name === "admission"
    ? COMPILE_SEAL_ADMISSION_OPERATION
    : name === "part-definitions"
    ? MODEL_CAPTURE_PART_DEFINITIONS_OPERATION
    : name === "assembly-integrity"
    ? VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION
    : name === "assembly-integrity-evaluation"
    ? VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION
    : name === "assembly-integrity-closeout"
    ? DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION
    : DESIGN_EXECUTE_BUILD123D_OPERATION;
  return { ...identity, bindings: [] };
}

function run(
  name: OperationName,
  status: EngineeringAgentRun["status"],
): EngineeringAgentRun {
  return {
    id: `run:${name}`,
    workItemId: `work:${name}`,
    status,
    summary: `${name} run`,
    queuedAt: "2026-08-09T00:00:00.000Z",
    basis: BASIS,
    evidenceRefs: [],
  };
}

function project(runs: readonly EngineeringAgentRun[]): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: "project:r8",
    revision: 8,
    generatedAt: "2026-08-09T00:00:00.000Z",
    project: {
      id: "project",
      name: "Project",
      subjectId: BASIS.subjectId,
      objective: { title: "Objective", statement: "Test linear Thread writes." },
    },
    threadSnapshots: [{
      snapshotId: BASIS.snapshotId,
      revision: BASIS.revision,
      subjectId: BASIS.subjectId,
    }],
    phases: [{
      id: "phase",
      name: "Phase",
      order: 1,
      description: "Test phase.",
      workItemIds: runs.map((candidate) => candidate.workItemId),
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: runs.map((candidate) => {
      const name = candidate.id.slice("run:".length) as OperationName;
      return {
        id: candidate.workItemId,
        activityId: `activity:${candidate.workItemId}`,
        phaseId: "phase",
        title: name,
        description: `${name} work`,
        kind: "design" as const,
        operation: operation(name),
        status: "ready" as const,
        owner: "agent" as const,
        dependsOnWorkItemIds: [],
        evidenceRefs: [],
        decisionIds: [],
        blockerIds: [],
      };
    }),
    agentRuns: runs,
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

async function releasedProject(
  value: EngineeringProjectSnapshot,
  failedRun: EngineeringAgentRun,
): Promise<EngineeringProjectSnapshot> {
  const ids = uncertainWriterBasisReleaseIds(failedRun.id);
  const text = uncertainWriterBasisReleaseText(failedRun.id);
  const reconciliation = failedRun.uncertainWriterReconciliation!;
  const failure = failedRun.failure!;
  const parameters = [
    {
      key: "releaseAction",
      label: "Release action",
      value: UNCERTAIN_WRITER_BASIS_RELEASE_ACTION,
    },
    {
      key: "releaseOutcome",
      label: "Release outcome",
      value: UNCERTAIN_WRITER_BASIS_RELEASE_OUTCOME,
    },
    { key: "failedRunId", label: "Failed run", value: failedRun.id },
    { key: "failureCode", label: "Failure code", value: failure.code },
    { key: "subjectId", label: "Thread subject", value: BASIS.subjectId },
    { key: "snapshotId", label: "Basis snapshot", value: BASIS.snapshotId },
    { key: "revision", label: "Basis revision", value: BASIS.revision },
    { key: "blockerId", label: "Blocker", value: ids.blockerId },
    {
      key: "reconciliationDecisionId",
      label: "Reconciliation decision",
      value: reconciliation.decisionId,
    },
    {
      key: "reconciliationOutcome",
      label: "Reconciliation outcome",
      value: "write-effect-accepted",
    },
    {
      key: "releaseAttestation",
      label: "Release attestation",
      value: "Provider state and the uncaptured effect were reviewed.",
    },
  ];
  const proposalInput = {
    summary: "Release the exact basis after human review.",
    parameters,
  };
  const fingerprint = await sha256Fingerprint({
    baseSnapshot: BASIS,
    inputEvidenceRefs: [],
    proposal: proposalInput,
  });
  const workItems = value.workItems.map((item) =>
    item.id === failedRun.workItemId
      ? { ...item, blockerIds: [...item.blockerIds, ids.blockerId] }
      : item
  );
  return {
    ...value,
    phases: value.phases.map((phase) => ({
      ...phase,
      requiredDecisionIds: [...phase.requiredDecisionIds, ids.decisionId],
    })),
    workItems,
    decisions: [...value.decisions, {
      id: ids.decisionId,
      phaseId: "phase",
      title: text.decisionTitle,
      question: text.decisionQuestion,
      status: "approved",
      requestedAt: "2026-08-10T00:00:00.000Z",
      baseSnapshot: BASIS,
      inputFingerprint: fingerprint,
      inputEvidenceRefs: [],
      approvalIds: [`approval:${ids.decisionId}`],
      proposal: {
        ...proposalInput,
        proposedAt: "2026-08-10T00:00:10.000Z",
        proposedBy: { id: "agent-1", origin: "agent" },
      },
    }],
    approvals: [...value.approvals, {
      id: `approval:${ids.decisionId}`,
      decisionId: ids.decisionId,
      status: "approved",
      requestedAt: "2026-08-10T00:00:10.000Z",
      decidedAt: "2026-08-10T00:01:00.000Z",
      decidedBy: "operator-1",
      decidedByOrigin: "human",
      rationale: "Reviewed the provider and accepted release of this exact basis.",
      baseSnapshot: BASIS,
      inputFingerprint: fingerprint,
      inputEvidenceRefs: [],
    }],
    blockers: [{
      id: ids.blockerId,
      phaseId: "phase",
      title: text.blockerTitle,
      description: text.blockerDescription,
      kind: "tool-failure",
      status: "resolved",
      openedAt: "2026-08-10T00:00:00.000Z",
      resolvedAt: "2026-08-10T00:01:00.000Z",
      resolution: `Resolved by approved decision: ${ids.decisionId}.`,
      workItemIds: [failedRun.workItemId],
      decisionIds: [ids.decisionId],
    }],
  };
}

async function reconciledProject(
  value: EngineeringProjectSnapshot,
  failedRun: EngineeringAgentRun,
): Promise<EngineeringProjectSnapshot> {
  const reconciliation = failedRun.uncertainWriterReconciliation!;
  const decisionId = reconciliation.decisionId;
  const reconciliationWorkItemId = `work:reconcile:${failedRun.id}`;
  const reconciliationRunId = `run:reconcile:${failedRun.id}`;
  const reconciliationCommandId = `command:reconcile:${failedRun.id}`;
  const authoritativeAt = new Date(
    Date.parse(reconciliation.reconciledAt) + 4,
  ).toISOString();
  const parameters = [
    {
      key: "reconcileAction",
      label: "Action",
      value: "resolve-uncertain-writer",
    },
    {
      key: "reconcileOperation",
      label: "Operation",
      value: "record.reconcile-uncertain-writer@1",
    },
    { key: "reconcileRunId", label: "Run", value: failedRun.id },
    {
      key: "reconcileFailureCode",
      label: "Failure",
      value: failedRun.failure!.code,
    },
    {
      key: "reconcileBasisSnapshotId",
      label: "Basis",
      value: BASIS.snapshotId,
    },
    {
      key: "reconcileOutcome",
      label: "Outcome",
      value: reconciliation.outcome,
    },
    {
      key: "reconcileAttestation",
      label: "Attestation",
      value: reconciliation.providerInspectionAttestation,
    },
  ];
  const proposalInput = {
    summary: "Record the exact inspected provider outcome.",
    parameters,
  };
  const fingerprint = await sha256Fingerprint({
    baseSnapshot: BASIS,
    inputEvidenceRefs: [],
    proposal: proposalInput,
  });
  const receiptIssuedAt = "2026-08-09T23:59:59.000Z";
  const resultingRevision = value.revision - 1;
  const requestFingerprint = await sha256Fingerprint({
    type: "agent-run.reconcile-annotation",
    origin: {
      kind: reconciliation.reconciledBy.origin,
      actorId: reconciliation.reconciledBy.id,
    },
    command: {
      commandId: reconciliationCommandId,
      projectId: value.project.id,
      expectedRevision: resultingRevision - 1,
      issuedAt: receiptIssuedAt,
      reconciliationRunId,
      failedRunId: failedRun.id,
      reconciliation,
    },
  });
  return {
    ...value,
    phases: value.phases.map((phase) => ({
      ...phase,
      workItemIds: [...phase.workItemIds, reconciliationWorkItemId],
      requiredDecisionIds: [...phase.requiredDecisionIds, decisionId],
    })),
    workItems: [...value.workItems, {
      id: reconciliationWorkItemId,
      activityId: `activity:${reconciliationWorkItemId}`,
      phaseId: "phase",
      title: "Reconcile uncertain writer",
      description: "Record the exact inspected provider outcome.",
      kind: "review",
      operation: {
        id: "record.reconcile-uncertain-writer",
        version: "1",
        bindings: [],
      },
      status: "completed",
      owner: "human",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [decisionId],
      blockerIds: [],
    }],
    agentRuns: [...value.agentRuns, {
      id: reconciliationRunId,
      workItemId: reconciliationWorkItemId,
      status: "completed",
      summary: "Uncertain-writer reconciliation completed by human operator.",
      queuedAt: "2026-08-09T23:59:00.000Z",
      completedAt: authoritativeAt,
      basis: BASIS,
      evidenceRefs: [],
      annotationOnly: true,
      statusHistory: [{
        commandId: reconciliationCommandId,
        status: "completed",
        at: authoritativeAt,
        actor: reconciliation.reconciledBy,
        summary: "Uncertain-writer reconciliation completed by human operator.",
      }],
    }],
    decisions: [...value.decisions, {
      id: decisionId,
      phaseId: "phase",
      title: "Reconcile uncertain writer",
      question: "What exact effect did the provider produce?",
      status: "approved",
      requestedAt: "2026-08-10T00:00:00.000Z",
      baseSnapshot: BASIS,
      inputFingerprint: fingerprint,
      inputEvidenceRefs: [],
      approvalIds: [`approval:${decisionId}`],
      proposal: {
        ...proposalInput,
        proposedAt: "2026-08-10T00:00:00.000Z",
        proposedBy: { id: "agent-1", origin: "agent" },
      },
    }],
    approvals: [...value.approvals, {
      id: `approval:${decisionId}`,
      decisionId,
      status: "approved",
      requestedAt: "2026-08-10T00:00:00.000Z",
      decidedAt: "2026-08-10T00:00:01.000Z",
      decidedBy: reconciliation.reconciledBy.id,
      decidedByOrigin: "human",
      rationale: "Inspected provider state.",
      baseSnapshot: BASIS,
      inputFingerprint: fingerprint,
      inputEvidenceRefs: [],
    }],
    commandReceipts: [...(value.commandReceipts ?? []), {
      commandId: reconciliationCommandId,
      type: "agent-run.reconcile-annotation",
      actor: reconciliation.reconciledBy,
      issuedAt: receiptIssuedAt,
      appliedAt: authoritativeAt,
      requestFingerprint,
      resultingSnapshot: {
        snapshotId: `${value.project.id}:project:r${resultingRevision}:${
          requestFingerprint.digest.slice(0, 16)
        }`,
        revision: resultingRevision,
      },
    }],
  };
}
