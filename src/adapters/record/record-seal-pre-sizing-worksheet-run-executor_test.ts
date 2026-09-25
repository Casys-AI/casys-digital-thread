import { assertEquals, assertRejects } from "@std/assert";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyPreSizingWorksheetDocumentExtension,
  RecordSealPreSizingWorksheetRunExecutor,
} from "./record-seal-pre-sizing-worksheet-run-executor.ts";

const COMMAND = {
  commandId: "worksheet-command",
  projectId: "project:worksheet",
  expectedRevision: 1,
  issuedAt: "2026-09-13T10:00:00.000Z",
  runId: "run:worksheet",
};

Deno.test("worksheet executor refuses a human before reading project state", async () => {
  const executor = new RecordSealPreSizingWorksheetRunExecutor({
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

Deno.test("worksheet executor refuses a lookalike operation before snapshot access", async () => {
  let snapshotRead = false;
  const executor = new RecordSealPreSizingWorksheetRunExecutor({
    projects: {
      get: () =>
        Promise.resolve({
          schemaVersion: "4.0",
          project: { id: COMMAND.projectId, subjectId: COMMAND.projectId },
          agentRuns: [{
            id: COMMAND.runId,
            workItemId: "work:worksheet",
            status: "queued",
            summary: "worksheet",
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
            id: "work:worksheet",
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
    () => executor.execute({ kind: "agent", actorId: "agent:worksheet" }, COMMAND),
    EngineeringProjectCommandError,
    "exact @1 operation",
  );
  if (snapshotRead) throw new Error("lookalike operation reached snapshot access");
});

Deno.test("worksheet extension consumes Thread sources and preserves prior documents", () => {
  const source = artifact("source-doc", "a", []);
  const base = snapshot([artifact("model", "0", []), source]);
  const baseBefore = structuredClone(base);
  const first = applyPreSizingWorksheetDocumentExtension({
    base,
    artifact: artifact("worksheet:first", "b", [source.id]),
    capturedAt: COMMAND.issuedAt,
  });
  assertEquals(base, baseBefore);
  assertEquals(first.consumptions, [{
    id: "consume-source-doc-by-worksheet:first",
    artifactId: "source-doc",
    consumer: first.artifacts.at(-1)!.producer,
    observedFingerprint: source.fingerprint,
    verifiedAt: COMMAND.issuedAt,
    status: "verified",
  }]);
  const successor = applyPreSizingWorksheetDocumentExtension({
    base: first,
    artifact: artifact("worksheet:successor", "c", [source.id, "worksheet:first"]),
    capturedAt: "2026-09-13T10:01:00.000Z",
  });
  assertEquals(successor.artifacts.some((item) => item.id === "worksheet:first"), true);
  assertEquals(
    successor.artifacts.some((item) => item.id === "worksheet:successor"),
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
