import { assertEquals, assertThrows } from "@std/assert";
import {
  EngineeringProjectCommandError,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function makeProject(
  opts: { id?: string; runs?: Array<{ id: string }> } = {},
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "4.0",
    id: "rev-1",
    revision: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    project: { id: opts.id ?? "test-project", subjectId: "test-subject" },
    threadSnapshots: [],
    phases: [],
    workItems: [],
    agentRuns: (opts.runs ?? []).map((r) => ({
      id: r.id,
      workItemId: "w1",
      status: "queued" as const,
      summary: "test",
      queuedAt: "2026-01-01T00:00:00.000Z",
      evidenceRefs: [],
    })),
    decisions: [],
    approvals: [],
  } as unknown as EngineeringProjectSnapshot;
}

function makeSnapshot(): ThreadSnapshot {
  return {
    id: "snap-1",
    revision: 3,
    subject: { id: "subject:test" },
    artifacts: [],
    observations: [],
    consumptions: [],
    evaluations: [],
    violations: [],
    freshness: { kind: "live" },
  } as unknown as ThreadSnapshot;
}

// ---------------------------------------------------------------------------
// requireRun
// ---------------------------------------------------------------------------

Deno.test("requireRun returns the run when the runId is present", () => {
  const project = makeProject({ runs: [{ id: "run-1" }] });
  const run = requireRun(project, "run-1");
  assertEquals(run.id, "run-1");
});

Deno.test("requireRun throws entity_not_found when the runId is absent", () => {
  const project = makeProject({ runs: [], id: "proj-x" });
  const err = assertThrows(
    () => requireRun(project, "missing-run"),
    EngineeringProjectCommandError,
    "does not exist",
  );
  assertEquals(err.code, "entity_not_found");
});

// ---------------------------------------------------------------------------
// requireBasis
// ---------------------------------------------------------------------------

Deno.test("requireBasis returns the basis when kind is thread-snapshot", () => {
  const run = {
    id: "run-1",
    workItemId: "w1",
    status: "running" as const,
    summary: "t",
    queuedAt: "2026-01-01T00:00:00.000Z",
    evidenceRefs: [],
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: "snap-1",
      revision: 1,
    },
  };
  const basis = requireBasis(run as unknown as Parameters<typeof requireBasis>[0]);
  assertEquals(basis.snapshotId, "snap-1");
});

Deno.test("requireBasis throws invalid_transition when kind is not thread-snapshot", () => {
  const run = {
    id: "run-2",
    workItemId: "w1",
    status: "queued" as const,
    summary: "t",
    queuedAt: "2026-01-01T00:00:00.000Z",
    evidenceRefs: [],
    basis: { kind: "approved-brief" },
  };
  const err = assertThrows(
    () => requireBasis(run as unknown as Parameters<typeof requireBasis>[0]),
    EngineeringProjectCommandError,
  );
  assertEquals(err.code, "invalid_transition");
});

Deno.test("requireBasis throws invalid_transition when basis is absent", () => {
  const run = {
    id: "run-3",
    workItemId: "w1",
    status: "queued" as const,
    summary: "t",
    queuedAt: "2026-01-01T00:00:00.000Z",
    evidenceRefs: [],
  };
  const err = assertThrows(
    () => requireBasis(run as unknown as Parameters<typeof requireBasis>[0]),
    EngineeringProjectCommandError,
  );
  assertEquals(err.code, "invalid_transition");
});

// ---------------------------------------------------------------------------
// requiredStart
// ---------------------------------------------------------------------------

Deno.test("requiredStart returns startedAt when present and valid", () => {
  const run = {
    id: "run-1",
    workItemId: "w1",
    status: "running" as const,
    summary: "t",
    queuedAt: "2026-01-01T00:00:00.000Z",
    evidenceRefs: [],
    startedAt: "2026-01-01T01:00:00.000Z",
  };
  const ts = requiredStart(run as unknown as Parameters<typeof requiredStart>[0]);
  assertEquals(ts, "2026-01-01T01:00:00.000Z");
});

Deno.test("requiredStart throws invalid_transition when startedAt is absent", () => {
  const run = {
    id: "run-2",
    workItemId: "w1",
    status: "queued" as const,
    summary: "t",
    queuedAt: "2026-01-01T00:00:00.000Z",
    evidenceRefs: [],
  };
  const err = assertThrows(
    () => requiredStart(run as unknown as Parameters<typeof requiredStart>[0]),
    EngineeringProjectCommandError,
  );
  assertEquals(err.code, "invalid_transition");
});

Deno.test("requiredStart throws invalid_transition when startedAt is not a valid timestamp", () => {
  const run = {
    id: "run-3",
    workItemId: "w1",
    status: "running" as const,
    summary: "t",
    queuedAt: "2026-01-01T00:00:00.000Z",
    evidenceRefs: [],
    startedAt: "not-a-date",
  };
  const err = assertThrows(
    () => requiredStart(run as unknown as Parameters<typeof requiredStart>[0]),
    EngineeringProjectCommandError,
  );
  assertEquals(err.code, "invalid_transition");
});

// ---------------------------------------------------------------------------
// snapshotRef
// ---------------------------------------------------------------------------

Deno.test("snapshotRef produces {snapshotId, revision, subjectId} from a snapshot", () => {
  const snapshot = makeSnapshot();
  const ref = snapshotRef(snapshot);
  assertEquals(ref.snapshotId, "snap-1");
  assertEquals(ref.revision, 3);
  assertEquals(ref.subjectId, "subject:test");
});

// ---------------------------------------------------------------------------
// unexpectedStatus
// ---------------------------------------------------------------------------

Deno.test("unexpectedStatus returns an EngineeringProjectCommandError with invalid_transition", () => {
  const run = {
    id: "run-x",
    workItemId: "w1",
    status: "queued" as const,
    summary: "t",
    queuedAt: "2026-01-01T00:00:00.000Z",
    evidenceRefs: [],
  };
  const err = unexpectedStatus(
    run as unknown as Parameters<typeof unexpectedStatus>[0],
    "running",
  );
  assertEquals(err instanceof EngineeringProjectCommandError, true);
  assertEquals(err.code, "invalid_transition");
});
