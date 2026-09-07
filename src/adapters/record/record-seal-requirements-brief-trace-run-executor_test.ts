import { assertEquals, assertRejects } from "@std/assert";
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyRequirementsBriefTraceDocumentExtension,
  RecordSealRequirementsBriefTraceRunExecutor,
} from "./record-seal-requirements-brief-trace-run-executor.ts";

const COMMAND = {
  commandId: "trace-command",
  projectId: "project:trace",
  expectedRevision: 1,
  issuedAt: "2026-09-07T10:00:00.000Z",
  runId: "run:trace",
};

Deno.test("requirements brief trace executor refuses a human before reading project state", async () => {
  const executor = new RecordSealRequirementsBriefTraceRunExecutor({
    projects: { get: () => Promise.reject(new Error("must not read project")) },
    commands: {} as never,
    snapshots: {} as never,
    lease: {} as never,
    captures: {} as never,
    architectureCaptures: {} as never,
    sysmlSourceAnalysis: {} as never,
    traces: {} as never,
  } as never);
  await assertRejects(
    () => executor.execute({ kind: "human", actorId: "human:reviewer" }, COMMAND),
    EngineeringProjectCommandError,
    "Only an authenticated agent",
  );
});

Deno.test("requirements brief trace executor refuses a lookalike operation before snapshot access", async () => {
  let snapshotRead = false;
  const executor = new RecordSealRequirementsBriefTraceRunExecutor({
    projects: {
      get: () =>
        Promise.resolve({
          schemaVersion: "4.0",
          project: { id: COMMAND.projectId, subjectId: COMMAND.projectId },
          agentRuns: [{
            id: COMMAND.runId,
            workItemId: "work:trace",
            status: "queued",
            summary: "trace",
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
            id: "work:trace",
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
    architectureCaptures: {} as never,
    sysmlSourceAnalysis: {} as never,
    traces: {} as never,
  } as never);
  await assertRejects(
    () => executor.execute({ kind: "agent", actorId: "agent:trace" }, COMMAND),
    EngineeringProjectCommandError,
    "exact @1 operation",
  );
  if (snapshotRead) throw new Error("lookalike operation reached snapshot access");
});

Deno.test("requirements brief trace extension attests every reopened input and preserves prior documentary entities", () => {
  const requirements = artifact("requirements-capture", "a", []);
  const base = snapshot([artifact("model", "0", []), requirements]);
  const baseBefore = structuredClone(base);
  const first = applyRequirementsBriefTraceDocumentExtension({
    base,
    artifact: artifact("trace:first", "b", [requirements.id]),
    capturedAt: COMMAND.issuedAt,
  });
  assertEquals(base, baseBefore);
  assertEquals(first.consumptions, [{
    id: "consume-requirements-capture-by-trace:first",
    artifactId: "requirements-capture",
    consumer: first.artifacts.at(-1)!.producer,
    observedFingerprint: requirements.fingerprint,
    verifiedAt: COMMAND.issuedAt,
    status: "verified",
  }]);

  const firstBefore = structuredClone(first);
  const successor = applyRequirementsBriefTraceDocumentExtension({
    base: first,
    artifact: artifact("trace:successor", "c", [requirements.id, "trace:first"]),
    capturedAt: "2026-09-07T10:01:00.000Z",
  });
  assertEquals(first, firstBefore);
  assertEquals(successor.consumptions.slice(-2), [{
    id: "consume-requirements-capture-by-trace:successor",
    artifactId: "requirements-capture",
    consumer: successor.artifacts.at(-1)!.producer,
    observedFingerprint: requirements.fingerprint,
    verifiedAt: "2026-09-07T10:01:00.000Z",
    status: "verified",
  }, {
    id: "consume-trace:first-by-trace:successor",
    artifactId: "trace:first",
    consumer: successor.artifacts.at(-1)!.producer,
    observedFingerprint: first.artifacts.at(-1)!.fingerprint,
    verifiedAt: "2026-09-07T10:01:00.000Z",
    status: "verified",
  }]);
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
