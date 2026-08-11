import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  CALCULIX_RECORDED_STATIC_ATTEMPT_SCHEMA,
  type CalculixRecordedStaticResource,
  FileCalculixRecordedStaticAttemptStore,
  validateCalculixRecordedStaticAttempt,
} from "./file-calculix-recorded-static-attempt-store.ts";

const PROJECT = "project-recorded";
const RUN = "run-recorded";
const PROVIDER_RUN = "r-01234567-89ab-cdef-0123-456789abcdef";
const PLAN = "a".repeat(64);
const REQUEST = "calculix:run-recorded";
const NOW = "2026-08-12T00:00:00.000Z";

Deno.test("CalculiX recorded WAL closes the sole solve identity and durable CAS capture", async () => {
  const directory = await Deno.makeTempDir({ prefix: "calculix-wal-" });
  try {
    const store = new FileCalculixRecordedStaticAttemptStore(directory);
    const fresh = await store.begin({
      projectId: PROJECT,
      runId: RUN,
      planSha256: PLAN,
      requestId: REQUEST,
      preparedAt: NOW,
    });
    assertEquals(fresh.status, "pre-dispatch");
    const dispatched = await store.markDispatched({
      projectId: PROJECT,
      runId: RUN,
      dispatchedAt: NOW,
    });
    assertEquals(dispatched.status, "dispatched");
    const known = await store.recordProviderRun({
      projectId: PROJECT,
      runId: RUN,
      requestSha256: "b".repeat(64),
      providerRunId: PROVIDER_RUN,
      resources: resources(),
    });
    assertEquals(known.status, "provider-run-known");
    const captured = await store.recordResourcesCaptured({
      projectId: PROJECT,
      runId: RUN,
      captureManifest: {
        uri: `casys://calculix-capture/sha256/${"c".repeat(64)}`,
        byteCount: 123,
        sha256: "c".repeat(64),
      },
    });
    assertEquals(captured.status, "resources-captured");
    await assertRejects(
      () =>
        store.complete({
          projectId: PROJECT,
          runId: RUN,
          snapshot: { snapshotId: "subject-r2", revision: 2, subjectId: "subject" },
        }),
      Error,
      "SysON evaluation",
    );
    const evaluationDispatched = await store.markEvaluationDispatched({
      projectId: PROJECT,
      runId: RUN,
      evaluationDispatchedAt: NOW,
    });
    assertEquals(evaluationDispatched.status, "evaluation-dispatched");
    const evaluationCaptured = await store.recordEvaluationCaptured({
      projectId: PROJECT,
      runId: RUN,
      evaluationCapture: {
        uri: `casys://syson-evaluation/sha256/${"e".repeat(64)}`,
        byteCount: 456,
        sha256: "e".repeat(64),
      },
    });
    assertEquals(evaluationCaptured.status, "evaluation-captured");
    const completed = await store.complete({
      projectId: PROJECT,
      runId: RUN,
      snapshot: { snapshotId: "subject-r2", revision: 2, subjectId: "subject" },
    });
    assertEquals(completed.status, "completed");
    assertEquals((await store.read(PROJECT, RUN))?.status, "completed");

    const replay = await store.begin({
      projectId: PROJECT,
      runId: RUN,
      planSha256: PLAN,
      requestId: REQUEST,
      preparedAt: NOW,
    });
    assertEquals(replay, completed);
    await assertRejects(
      () =>
        store.begin({
          projectId: PROJECT,
          runId: RUN,
          planSha256: "d".repeat(64),
          requestId: REQUEST,
          preparedAt: NOW,
        }),
      Error,
      "different sealed request",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CalculiX recorded WAL rejects a profile alias before it can become recovery state", () => {
  const invalid = {
    schemaVersion: CALCULIX_RECORDED_STATIC_ATTEMPT_SCHEMA,
    projectId: PROJECT,
    runId: RUN,
    planSha256: PLAN,
    requestId: REQUEST,
    preparedAt: NOW,
    status: "provider-run-known",
    dispatchedAt: NOW,
    requestSha256: "b".repeat(64),
    providerRunId: PROVIDER_RUN,
    resources: resources().map((resource, index) =>
      index === 0 ? { ...resource, role: "result.json" } : resource
    ),
  };
  assertThrows(
    () => validateCalculixRecordedStaticAttempt(invalid, PROJECT, RUN),
    Error,
    "resource profile",
  );
});

function resources(): readonly CalculixRecordedStaticResource[] {
  return [
    ["input.step", "model/step"],
    ["request.json", "application/json"],
    ["mesh.geo", "text/plain"],
    ["mesh.inp", "text/plain"],
    ["gmsh.log", "text/plain"],
    ["job.inp", "text/plain"],
    ["ccx.log", "text/plain"],
    ["job.dat", "text/plain"],
    ["result.json", "application/json"],
  ].map(([role, mediaType], index) => ({
    role,
    uri: `casys://calculix/runs/${PROVIDER_RUN}/${role}`,
    mediaType,
    byteCount: index + 1,
    sha256: `${index + 1}`.repeat(64),
  }));
}
