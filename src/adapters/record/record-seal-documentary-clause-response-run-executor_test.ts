import { assertEquals, assertRejects } from "@std/assert";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyDocumentaryClauseResponseDocumentExtension,
  RecordSealDocumentaryClauseResponseRunExecutor,
} from "./record-seal-documentary-clause-response-run-executor.ts";

const COMMAND = {
  commandId: "clause-command",
  projectId: "project:clause",
  expectedRevision: 1,
  issuedAt: "2026-09-13T10:00:00.000Z",
  runId: "run:clause",
};

Deno.test("clause-response executor refuses a human before reading project state", async () => {
  const executor = new RecordSealDocumentaryClauseResponseRunExecutor({
    projects: { get: () => Promise.reject(new Error("must not read project")) },
    commands: {} as never,
    snapshots: {} as never,
    lease: {} as never,
    captures: {} as never,
    resources: {} as never,
  } as never);
  await assertRejects(
    () => executor.execute({ kind: "human", actorId: "human:reviewer" }, COMMAND),
    EngineeringProjectCommandError,
    "Only an authenticated agent",
  );
});

Deno.test("clause-response executor refuses a lookalike operation before snapshot access", async () => {
  let snapshotRead = false;
  const executor = new RecordSealDocumentaryClauseResponseRunExecutor({
    projects: {
      get: () =>
        Promise.resolve({
          schemaVersion: "4.0",
          project: { id: COMMAND.projectId, subjectId: COMMAND.projectId },
          agentRuns: [{
            id: COMMAND.runId,
            workItemId: "work:clause",
            status: "queued",
            summary: "clause",
            queuedAt: COMMAND.issuedAt,
            basis: {
              kind: "thread-snapshot",
              snapshotId: "thread:r1",
              revision: 1,
              subjectId: COMMAND.projectId,
            },
            evidenceRefs: [],
          }],
          workItems: [{
            id: "work:clause",
            operation: { id: "record.lookalike", version: "1", bindings: [] },
            decisionIds: [],
          }],
        } as never),
    },
    commands: {} as never,
    snapshots: {
      get: () => {
        snapshotRead = true;
        return Promise.reject(new Error("must not read snapshots"));
      },
    } as never,
    lease: {} as never,
    captures: {} as never,
    resources: {} as never,
  } as never);
  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:clause" }, COMMAND),
    EngineeringProjectCommandError,
    "exact @1 operation",
  );
  if (snapshotRead) throw new Error("lookalike operation reached snapshot access");
});

Deno.test("clause-response extension consumes Thread sources and preserves prior documents", () => {
  const source = artifact("source-doc", "a", []);
  const base = snapshot([artifact("model", "0", []), source]);
  const baseBefore = structuredClone(base);
  const first = applyDocumentaryClauseResponseDocumentExtension({
    base,
    artifact: artifact("clause:first", "b", [source.id]),
    capturedAt: COMMAND.issuedAt,
  });
  assertEquals(base, baseBefore);
  assertEquals(first.consumptions, [{
    id: "consume-source-doc-by-clause:first",
    artifactId: "source-doc",
    consumer: first.artifacts.at(-1)!.producer,
    observedFingerprint: source.fingerprint,
    verifiedAt: COMMAND.issuedAt,
    status: "verified",
  }]);
  const successor = applyDocumentaryClauseResponseDocumentExtension({
    base: first,
    artifact: artifact("clause:successor", "c", [source.id, "clause:first"]),
    capturedAt: "2026-09-13T10:01:00.000Z",
  });
  assertEquals(successor.artifacts.some((item) => item.id === "clause:first"), true);
  assertEquals(
    successor.artifacts.some((item) => item.id === "clause:successor"),
    true,
  );
});

function artifact(
  id: string,
  digit: string,
  inputArtifactIds: readonly string[],
): ThreadArtifact {
  return {
    id,
    name: id,
    kind: id === "model" ? "sysml-model" : "document",
    version: "1",
    fingerprint: { algorithm: "sha256", digest: digit.repeat(64) },
    producer: { serverId: "digital-thread", tool: "test", runId: "run:test" },
    inputArtifactIds,
    freshness: {
      status: "fresh",
      changedAt: COMMAND.issuedAt,
      invalidatedByChangeIds: [],
    },
  };
}

function snapshot(artifacts: readonly ThreadArtifact[]): ThreadSnapshot {
  return {
    schemaVersion: "1.0",
    id: "thread:r1",
    revision: 1,
    generatedAt: COMMAND.issuedAt,
    subject: {
      id: COMMAND.projectId,
      name: "Test",
      kind: "system",
      version: "1",
      modelArtifactId: "model",
    },
    freshness: {
      status: "fresh",
      changedAt: COMMAND.issuedAt,
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "change:r1",
      name: "base",
      status: "applied",
      createdAt: COMMAND.issuedAt,
      appliedAt: COMMAND.issuedAt,
      changes: [],
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}
