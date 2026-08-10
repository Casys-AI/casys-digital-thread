import { assertEquals, assertThrows } from "@std/assert";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../domain/platform/architecture-proposal.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../domain/platform/geometry-proposal.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../domain/platform/requirements-proposal.ts";
import { EngineeringProjectCommandError } from "../../domain/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
} from "../../domain/project/engineering-project.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "./thread-write-basis-guard.ts";

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
  ].map(threadWriteBasisLeaseScope);

  assertEquals(new Set(scopes).size, 1);
});

Deno.test("a queued sibling may wait for the shared basis lease", () => {
  const current = run("architecture", "queued");
  const sibling = run("geometry", "queued");

  assertThreadWriteBasisAvailable(project([current, sibling]), current);
});

Deno.test("a stale queued basis is refused before another Thread write", () => {
  const current = run("requirements", "queued");
  const initial = project([current]);
  const value: EngineeringProjectSnapshot = {
    ...initial,
    threadSnapshots: [
      ...initial.threadSnapshots,
      { snapshotId: "thread:r5", revision: 5, subjectId: BASIS.subjectId },
    ],
  };

  assertThrows(
    () => assertThreadWriteBasisAvailable(value, current),
    EngineeringProjectCommandError,
    "no longer the unique declared project Thread head",
  );
});

Deno.test("a Thread basis cannot be transplanted to another project subject", () => {
  const current = run("geometry", "queued");
  const initial = project([current]);
  const transplanted: EngineeringProjectSnapshot = {
    ...initial,
    project: { ...initial.project, subjectId: "foreign-subject" },
  };

  assertThrows(
    () => assertThreadWriteBasisAvailable(transplanted, current),
    EngineeringProjectCommandError,
    "basis is no longer the unique declared project Thread head",
  );
});

Deno.test("an active cross-operation sibling blocks the same Thread basis", () => {
  const current = run("geometry", "queued");
  const sibling = run("requirements", "publishing");

  assertThrows(
    () => assertThreadWriteBasisAvailable(project([current, sibling]), current),
    EngineeringProjectCommandError,
    "active, completed, or uncertain durable write",
  );
});

Deno.test("a terminal uncertain provider sibling blocks after its lease is released", () => {
  const current = run("geometry", "queued");
  const sibling = {
    ...run("architecture", "failed"),
    failure: {
      code: "model-write-architecture-provider-outcome-unknown",
      message: "Provider outcome is unknown.",
    },
  };

  assertThrows(
    () => assertThreadWriteBasisAvailable(project([current, sibling]), current),
    EngineeringProjectCommandError,
    "active, completed, or uncertain durable write",
  );
});

Deno.test("a reconciled terminal sibling does not block the thread write basis", () => {
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

  // A terminal uncertain sibling whose operator resolved the uncertainty must
  // NOT block a new queued run from the same basis.
  assertThreadWriteBasisAvailable(project([current, sibling]), current);
});

Deno.test("a reconciled geometry sibling does not block the thread write basis", () => {
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
  assertThreadWriteBasisAvailable(project([current, sibling]), current);
});

Deno.test("an ordinary pre-write failed sibling does not poison the basis", () => {
  const current = run("requirements", "queued");
  const sibling = {
    ...run("architecture", "failed"),
    failure: { code: "invalid-input", message: "No provider call occurred." },
  };

  assertThreadWriteBasisAvailable(project([current, sibling]), current);
});

Deno.test("a failed geometry sibling is conservatively treated as durable", () => {
  const current = run("architecture", "queued");
  const sibling = {
    ...run("geometry", "failed"),
    failure: { code: "geometry-failed", message: "Seal outcome is uncertain." },
  };

  assertThrows(
    () => assertThreadWriteBasisAvailable(project([current, sibling]), current),
    EngineeringProjectCommandError,
    "active, completed, or uncertain durable write",
  );
});

type OperationName = "architecture" | "requirements" | "geometry";

function operation(name: OperationName): EngineeringOperationRef {
  const identity = name === "architecture"
    ? MODEL_WRITE_ARCHITECTURE_OPERATION
    : name === "requirements"
    ? MODEL_WRITE_REQUIREMENTS_OPERATION
    : DESIGN_WRITE_GEOMETRY_OPERATION;
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
    schemaVersion: "3.0",
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
    phases: [],
    workItems: runs.map((candidate) => {
      const name = candidate.id.slice("run:".length) as OperationName;
      return {
        id: candidate.workItemId,
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
